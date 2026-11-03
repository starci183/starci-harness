import { createSessionStore, createSingleFlight } from "@starci/auth/client"
import type { SessionEvent, SessionListener, SessionSnapshot } from "@starci/auth/client"
import { OIDC_CLIENT_CODES } from "../contracts/index.ts"
import type { OidcClientOutcome, OidcFailureKind, OidcSessionUser } from "../contracts/index.ts"
import { challengeOf, claimsOf, randomText, sameSitePath, textOf } from "./pkce.ts"

/** The event a listener hears: the same four as `AuthEvent` of `@starci/auth/client`. */
export type OidcEvent = SessionEvent

/** Called on every sign-in, sign-out and token refresh with the id of the person (null when signed out). */
export type OidcListener = SessionListener

/** What a view reads: loading until the first answer, then signed in or out. The object changes only when the session does. */
export type OidcSnapshot = SessionSnapshot<OidcSessionUser>

/** The small part of `Storage` the client needs: the transaction of one redirect lives here (and a sign-in hint), never a token. */
export interface OidcStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** The options of the client. */
export interface OidcClientOptions {
    /** The issuer (the realm address). */
    readonly issuer: string | (() => string)
    /** The registered public client. */
    readonly clientId: string
    /** The exact registered redirect address, the page that calls `completeSignIn`. */
    readonly redirectUri: string | (() => string)
    /** The exact registered address the provider returns to after logout; without it sign-out only forgets the session here. */
    readonly postLogoutRedirectUri?: string | (() => string) | undefined
    /** The requested scope (`openid`). */
    readonly scope?: string | undefined
    /** The fetch to use (the global one when absent). */
    readonly fetch?: typeof fetch | undefined
    /** Where the transaction of a redirect is kept: `sessionStorage` when the platform has it, else memory. */
    readonly storage?: OidcStorage | undefined
    /** Takes the browser to an address (`location.assign`). */
    readonly navigate?: ((url: string) => void) | undefined
    /** Refresh this long before the token really expires, so a request never carries a dying one (15 seconds). */
    readonly refreshAheadMs?: number | undefined
    /** Tries a refresh makes before it gives up on a busy or unreachable provider (4). */
    readonly retryAttempts?: number | undefined
    /** The base of the linear backoff between tries, in milliseconds (400). */
    readonly retryBaseMs?: number | undefined
    /** The clock in milliseconds (`Date.now`). */
    readonly now?: (() => number) | undefined
    /** The pause between tries (a timer). */
    readonly sleep?: ((ms: number) => Promise<void>) | undefined
}

/** What a finished sign-in answers: the person and where the page was going. */
export interface OidcSignedIn {
    readonly user: OidcSessionUser
    /** The same-site path `signIn` was asked to return to, or `/`. */
    readonly returnTo: string
}

/** The OIDC client of a front end: the access token lives in this closure's memory only, never in storage or a cookie. */
export interface OidcAuthClient {
    /** Takes the browser to the provider's login page (authorization code flow, PKCE S256, state, nonce). `prompt: "none"` asks without showing a page. */
    signIn(options?: { readonly returnTo?: string; readonly prompt?: "none" | "login" }): Promise<OidcClientOutcome<true>>
    /** Finishes the flow on the redirect page: checks the state and the issuer, exchanges the code once and keeps the grant. */
    completeSignIn(callbackUrl: string): Promise<OidcClientOutcome<OidcSignedIn>>
    /** Signs in again without a page when this browser signed in before and holds no session now (a reload): a `prompt=none` redirect, tried once. */
    restore(): Promise<OidcClientOutcome<"redirected" | "skipped">>
    /** Forgets the session and takes the browser to the provider's logout address. */
    signOut(): Promise<void>
    /** Refreshes with the refresh token held in memory. Overlapping calls share one refresh. `undefined` when it cannot be refreshed. */
    renew(): Promise<string | undefined>
    /** The access token of the current session, refreshed when missing or about to expire; `undefined` when signed out. */
    accessToken(): Promise<string | undefined>
    /** The held access token without any request. */
    peek(): string | undefined
    /** The signed-in person, or null when signed out. */
    user(): Promise<OidcSessionUser | null>
    /** The `Authorization` header of the current session (an empty object when signed out). */
    headers(): Promise<Record<string, string>>
    /** Forgets the session. */
    drop(): void
    /** Listens to auth events; the first answer comes from a refresh. Answers the function that stops listening. */
    subscribe(listener: OidcListener): () => void
    /** The current snapshot (stable between changes). */
    getSnapshot: () => OidcSnapshot
    /** The snapshot for server rendering: always loading. */
    getServerSnapshot: () => OidcSnapshot
    /** Calls `onChange` when the snapshot changes (the shape `useSyncExternalStore` takes). */
    watch: (onChange: () => void) => () => void
}

interface Grant {
    readonly accessToken: string
    readonly expiresIn: number
    readonly refreshToken: string | undefined
    readonly idToken: string | undefined
}

interface Transaction {
    readonly verifier: string
    readonly nonce: string
    readonly returnTo: string
    readonly at: number
}

interface Discovery {
    readonly authorization: string
    readonly token: string
    readonly endSession: string | undefined
}

const TRANSACTION_KEY = "starci.oidc.tx."
const HINT_KEY = "starci.oidc.hint"
const SILENT_KEY = "starci.oidc.silent"
const TRANSACTION_TTL_MS = 600_000
const MILLISECONDS = 1000
/** The answers of a prompt-less request that mean "sign in on a page", not a failure. */
const SILENT_ANSWERS: readonly string[] = ["login_required", "interaction_required", "consent_required", "account_selection_required"]

const failure = <T>(kind: OidcFailureKind, code: string): OidcClientOutcome<T> => ({ success: false, message: kind, error: code })
const success = <T>(data: T): OidcClientOutcome<T> => ({ success: true, message: "ok", data })

const recordOf = (value: unknown): Readonly<Record<string, unknown>> => (typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {})

const grantOf = (body: unknown): Grant | undefined => {
    const fields = recordOf(body)
    const { access_token: accessToken, expires_in: expiresIn, refresh_token: refreshToken, id_token: idToken, token_type: type } = fields
    if (typeof accessToken !== "string" || accessToken === "" || typeof expiresIn !== "number" || typeof type !== "string" || type.toLowerCase() !== "bearer") return undefined
    return { accessToken, expiresIn, refreshToken: textOf(refreshToken), idToken: textOf(idToken) }
}

const memoryStorage = (): OidcStorage => {
    const held = new Map<string, string>()
    return {
        getItem: (key) => held.get(key) ?? null,
        setItem: (key, value) => {
            held.set(key, value)
        },
        removeItem: (key) => {
            held.delete(key)
        },
    }
}

const isStorage = (value: unknown): value is OidcStorage =>
    typeof value === "object" && value !== null && "getItem" in value && "setItem" in value && "removeItem" in value

const platformStorage = (): OidcStorage => {
    try {
        const candidate: unknown = Reflect.get(globalThis, "sessionStorage")
        return isStorage(candidate) ? candidate : memoryStorage()
    } catch {
        return memoryStorage()
    }
}

const platformNavigate = (url: string): void => {
    const location: unknown = Reflect.get(globalThis, "location")
    const assign: unknown = typeof location === "object" && location !== null ? Reflect.get(location, "assign") : undefined
    if (typeof assign === "function" && typeof location === "object") Reflect.apply(assign, location, [url])
}

const timerPause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        const timer = setTimeout(() => {
            clearTimeout(timer)
            resolve()
        }, ms)
    })

const parseTransaction = (raw: string | null): Transaction | undefined => {
    if (raw === null) return undefined
    try {
        const fields = recordOf(JSON.parse(raw))
        const { verifier, nonce, returnTo, at } = fields
        return typeof verifier === "string" && typeof nonce === "string" && typeof returnTo === "string" && typeof at === "number" ? { verifier, nonce, returnTo, at } : undefined
    } catch {
        return undefined
    }
}

/** Creates the one OIDC client of a front end (one instance, like the event stream). */
export const createOidcClient = (options: OidcClientOptions): OidcAuthClient => {
    const fetcher = options.fetch ?? ((input, init) => fetch(input, init))
    const storage = options.storage ?? platformStorage()
    const navigate = options.navigate ?? platformNavigate
    const refreshAheadMs = options.refreshAheadMs ?? 15_000
    const attemptsMax = options.retryAttempts ?? 4
    const retryBaseMs = options.retryBaseMs ?? 400
    const now = options.now ?? Date.now
    const pause = options.sleep ?? timerPause
    const scope = options.scope ?? "openid"
    const valueOf = (value: string | (() => string)): string => (typeof value === "string" ? value : value())

    let token: string | undefined
    let refreshToken: string | undefined
    let idToken: string | undefined
    let expiresAt = 0
    let announced = false
    let user: OidcSessionUser | null = null
    let discovered: Promise<Discovery> | undefined
    // The snapshot, the listeners and the watchers are the session store of @starci/auth/client, the one every provider's client shares.
    const store = createSessionStore<OidcSessionUser>({
        announced: () => announced,
        announce: () => {
            announced = true
        },
        held: () => token !== undefined,
        userId: () => user?.id ?? null,
        renew: () => renew(),
        refreshing: () => flight.running(),
    })

    const userOf = (grant: Grant): OidcSessionUser | null => {
        const { sub, email } = claimsOf(grant.idToken ?? grant.accessToken)
        return typeof sub === "string" ? { id: sub, email: typeof email === "string" ? email : "" } : null
    }

    const keep = (grant: Grant, event: OidcEvent): void => {
        token = grant.accessToken
        // A refresh answers a new refresh token when the provider rotates; one that does not leaves the held one valid.
        refreshToken = grant.refreshToken ?? refreshToken
        idToken = grant.idToken ?? idToken
        expiresAt = now() + grant.expiresIn * MILLISECONDS
        announced = true
        user = userOf(grant)
        storage.setItem(HINT_KEY, "1")
        store.signedIn(user)
        store.emit(event, user?.id ?? null)
    }

    const drop = (): void => {
        const had = token !== undefined
        token = undefined
        refreshToken = undefined
        idToken = undefined
        expiresAt = 0
        announced = true
        user = null
        store.signedOut()
        if (had) store.emit("SIGNED_OUT", null)
    }

    function refreshEvent(): OidcEvent {
        if (!announced) return "INITIAL_SESSION"
        return token === undefined ? "SIGNED_IN" : "TOKEN_REFRESHED"
    }

    const discover = (): Promise<Discovery> => {
        discovered ??= (async (): Promise<Discovery> => {
            const response = await fetcher(`${valueOf(options.issuer).replace(/\/$/u, "")}/.well-known/openid-configuration`, { headers: { accept: "application/json" } })
            const document = recordOf(await response.json().catch(() => undefined))
            const { authorization_endpoint: authorization, token_endpoint: tokenEndpoint, end_session_endpoint: endSession, issuer } = document
            if (!response.ok || issuer !== valueOf(options.issuer) || typeof authorization !== "string" || typeof tokenEndpoint !== "string") throw new Error(OIDC_CLIENT_CODES.Provider)
            return { authorization, token: tokenEndpoint, endSession: typeof endSession === "string" ? endSession : undefined }
        })().catch((cause: unknown) => {
            discovered = undefined
            throw cause
        })
        return discovered
    }

    const tokenRequest = async (form: Record<string, string>): Promise<{ readonly status: number; readonly body: unknown }> => {
        const { token: endpoint } = await discover()
        const response = await fetcher(endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({ client_id: options.clientId, ...form }).toString(),
        })
        return { status: response.status, body: await response.json().catch(() => undefined) }
    }

    /** True when the answer to a refresh says the session is over: the provider refused the refresh token (401, 403, or 400 `invalid_grant`). A 429, a 5xx or a lost connection never ends a session. */
    const endsSession = (status: number, body: unknown): boolean => status === 401 || status === 403 || (status === 400 && recordOf(body).error === "invalid_grant")

    const requestRefresh = async (attempt = 1): Promise<string | undefined> => {
        const retry = async (): Promise<string | undefined> => {
            await pause(retryBaseMs * attempt)
            return requestRefresh(attempt + 1)
        }
        const held = refreshToken
        if (held === undefined) {
            drop()
            return undefined
        }
        try {
            const answer = await tokenRequest({ grant_type: "refresh_token", refresh_token: held })
            if (answer.status === 200) {
                const grant = grantOf(answer.body)
                if (grant === undefined) return undefined
                keep(grant, refreshEvent())
                return grant.accessToken
            }
            if (endsSession(answer.status, answer.body)) {
                storage.removeItem(HINT_KEY)
                drop()
                return undefined
            }
            if ((answer.status === 429 || answer.status >= 500) && attempt < attemptsMax) return await retry()
            return undefined
        } catch {
            return attempt < attemptsMax ? retry() : undefined
        }
    }

    // Many requests answered 401 together refresh once: the others await the one in flight.
    const flight = createSingleFlight(() => requestRefresh())
    const renew = (): Promise<string | undefined> => flight.run()

    const accessToken = async (): Promise<string | undefined> => (token !== undefined && expiresAt - refreshAheadMs > now() ? token : renew())

    const signIn: OidcAuthClient["signIn"] = async (input = {}) => {
        try {
            const { authorization } = await discover()
            const state = randomText()
            const nonce = randomText()
            const verifier = randomText()
            const transaction: Transaction = { verifier, nonce, returnTo: sameSitePath(input.returnTo, "/"), at: now() }
            storage.setItem(TRANSACTION_KEY + state, JSON.stringify(transaction))
            const url = new URL(authorization)
            url.search = new URLSearchParams({
                response_type: "code",
                client_id: options.clientId,
                redirect_uri: valueOf(options.redirectUri),
                scope,
                state,
                nonce,
                code_challenge: await challengeOf(verifier),
                code_challenge_method: "S256",
                ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
            }).toString()
            navigate(url.toString())
            return success(true)
        } catch {
            return failure("unavailable", OIDC_CLIENT_CODES.Transport)
        }
    }

    const completeSignIn: OidcAuthClient["completeSignIn"] = async (callbackUrl) => {
        const query = new URL(callbackUrl).searchParams
        const state = query.get("state") ?? ""
        const key = TRANSACTION_KEY + state
        const transaction = state === "" ? undefined : parseTransaction(storage.getItem(key))
        storage.removeItem(key)
        storage.removeItem(SILENT_KEY)
        if (transaction === undefined || now() - transaction.at > TRANSACTION_TTL_MS) return failure("invalid", OIDC_CLIENT_CODES.State)
        const refusal = query.get("error")
        if (refusal !== null) {
            if (SILENT_ANSWERS.includes(refusal)) storage.removeItem(HINT_KEY)
            drop()
            return failure("refused", refusal)
        }
        const issuer = query.get("iss")
        if (issuer !== null && issuer !== valueOf(options.issuer)) return failure("invalid", OIDC_CLIENT_CODES.Issuer)
        const code = query.get("code")
        if (code === null || code === "") return failure("invalid", OIDC_CLIENT_CODES.Token)
        try {
            const answer = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: valueOf(options.redirectUri), code_verifier: transaction.verifier })
            const grant = answer.status === 200 ? grantOf(answer.body) : undefined
            if (grant === undefined) return failure(answer.status >= 500 ? "unavailable" : "refused", answer.status >= 500 ? OIDC_CLIENT_CODES.Transport : OIDC_CLIENT_CODES.Provider)
            if (grant.idToken !== undefined && claimsOf(grant.idToken).nonce !== transaction.nonce) return failure("invalid", OIDC_CLIENT_CODES.Nonce)
            keep(grant, "SIGNED_IN")
            return user === null ? failure("invalid", OIDC_CLIENT_CODES.Token) : success({ user, returnTo: transaction.returnTo })
        } catch {
            return failure("unavailable", OIDC_CLIENT_CODES.Transport)
        }
    }

    const restore: OidcAuthClient["restore"] = async () => {
        if (token !== undefined || storage.getItem(HINT_KEY) !== "1" || storage.getItem(SILENT_KEY) === "1") return success("skipped")
        storage.setItem(SILENT_KEY, "1")
        const started = await signIn({ prompt: "none", returnTo: currentPath() })
        if (started.success) return success("redirected")
        storage.removeItem(SILENT_KEY)
        return started
    }

    const currentPath = (): string => {
        const location: unknown = Reflect.get(globalThis, "location")
        const pathname: unknown = typeof location === "object" && location !== null ? Reflect.get(location, "pathname") : undefined
        return typeof pathname === "string" ? pathname : "/"
    }

    const signOut: OidcAuthClient["signOut"] = async () => {
        const hint = idToken
        const target = options.postLogoutRedirectUri
        storage.removeItem(HINT_KEY)
        const endpoint = await discover().then(
            (found) => found.endSession,
            () => undefined,
        )
        drop()
        if (endpoint === undefined || target === undefined) return
        const url = new URL(endpoint)
        url.search = new URLSearchParams({
            client_id: options.clientId,
            post_logout_redirect_uri: valueOf(target),
            ...(hint === undefined ? {} : { id_token_hint: hint }),
        }).toString()
        navigate(url.toString())
    }

    return {
        signIn,
        completeSignIn,
        restore,
        signOut,
        renew,
        accessToken,
        peek: () => token,
        user: async () => ((await accessToken()) === undefined ? null : user),
        headers: async () => {
            const held = await accessToken()
            return held === undefined ? {} : { authorization: `Bearer ${held}` }
        },
        drop,
        subscribe: store.subscribe,
        getSnapshot: store.getSnapshot,
        getServerSnapshot: store.getServerSnapshot,
        watch: store.watch,
    }
}
