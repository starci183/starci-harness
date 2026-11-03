import { AUTH_DOORS } from "../contracts/index.ts"
import type { AccessGrant, AuthDoorName, AuthOutcome, SessionUser } from "../contracts/index.ts"
import { authFailure, authOk, failureOfStatus, isSignedOutStatus, isTransientStatus } from "./outcome.ts"
import type { StatusCodes } from "./outcome.ts"
import { createSessionStore, createSingleFlight } from "./session.ts"
import type { SessionEvent, SessionListener, SessionSnapshot } from "./session.ts"

/** What a door answered. A refusal is an answer, not a throw: the status says what happened. */
export interface AuthDoorAnswer {
    readonly status: number
    readonly body: unknown
}

/** The event a listener hears. */
export type AuthEvent = SessionEvent

/** Called on every sign-in, sign-out and token refresh with the id of the person the session belongs to (null when signed out). */
export type AuthListener = SessionListener

/** What a view reads: loading until the first answer, then signed in or out. The object changes only when the session does. */
export type AuthSnapshot = SessionSnapshot<SessionUser>

/** The options of the client. */
export interface AuthClientOptions {
    /** The API origin the doors live on. */
    readonly apiOrigin: string | (() => string)
    /** The fetch to use (the global one when absent). */
    readonly fetch?: typeof fetch | undefined
    /** Refresh this long before the token really expires, so a request never carries a dying one (15 seconds). */
    readonly refreshAheadMs?: number | undefined
    /** Tries a refresh makes before it gives up on a busy or unreachable back end (4). */
    readonly retryAttempts?: number | undefined
    /** The base of the linear backoff between tries, in milliseconds (400). */
    readonly retryBaseMs?: number | undefined
    /** The clock in milliseconds (`Date.now`). */
    readonly now?: (() => number) | undefined
    /** The pause between tries (a timer). */
    readonly sleep?: ((ms: number) => Promise<void>) | undefined
}

/** The front-end client of the auth doors: the access token lives in this closure's memory only, never in storage or a cookie. */
export interface AuthClient {
    /** Calls a door with the credentials of the browser; a transport failure rejects, any answer resolves. `cookie` is the header a server forwards. */
    door(name: AuthDoorName, body?: object, cookie?: string): Promise<AuthDoorAnswer>
    /** Signs in with email and password and keeps the grant; a refusal is an outcome. */
    signIn(body: object): Promise<AuthOutcome<SessionUser>>
    /** Calls a door that returns no grant (signup, resend, confirm, forgot, reset) and maps its answer to an outcome. */
    send(name: AuthDoorName, body: object, fallbacks?: StatusCodes): Promise<AuthOutcome<unknown>>
    /** Ends the session of the cookie and forgets the token; the token is forgotten even when the door cannot be reached. */
    signOut(): Promise<void>
    /** Refreshes through the httpOnly cookie. Overlapping calls share one refresh. `undefined` when it cannot be refreshed. */
    renew(): Promise<string | undefined>
    /** The access token of the current session, refreshed when missing or about to expire; `undefined` when signed out. */
    accessToken(): Promise<string | undefined>
    /** The held access token without any request. */
    peek(): string | undefined
    /** The signed-in person (id, email and the full name when the account has one), or null when signed out. */
    user(): Promise<SessionUser | null>
    /** The `Authorization` header of the current session (an empty object when signed out). */
    headers(): Promise<Record<string, string>>
    /** Keeps a grant a door answered (an OAuth landing, a sign-in the app ran itself) and announces it. */
    keep(grant: AccessGrant, event?: AuthEvent): void
    /** Forgets the token (sign-out, or a refresh the back end refused). */
    drop(): void
    /** Listens to auth events; the first answer comes from a refresh. Answers the function that stops listening. */
    subscribe(listener: AuthListener): () => void
    /** The current snapshot (stable between changes). */
    getSnapshot: () => AuthSnapshot
    /** The snapshot for server rendering: always loading. */
    getServerSnapshot: () => AuthSnapshot
    /** Calls `onChange` when the snapshot changes (the shape `useSyncExternalStore` takes). */
    watch: (onChange: () => void) => () => void
    /** Asks the back end whether the given `Cookie` header holds a live session (server side); the door does not rotate the cookie. */
    checkSession(cookie: string | null): Promise<AuthOutcome<true>>
}

const isGrant = (value: unknown): value is AccessGrant =>
    typeof value === "object" &&
    value !== null &&
    "accessToken" in value &&
    typeof value.accessToken === "string" &&
    "expiresIn" in value &&
    typeof value.expiresIn === "number"

const fieldOf = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null ? Object.entries(value).find(([name]) => name === key)?.[1] : undefined

const claimsOf = (token: string): { readonly sub?: unknown; readonly email?: unknown; readonly name?: unknown } => {
    const payload = token.split(".")[1]
    if (payload === undefined) return {}
    try {
        const parsed: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")))
        return typeof parsed === "object" && parsed !== null ? parsed : {}
    } catch {
        return {}
    }
}

/** The full name of a person, when a grant or a token names one. */
const nameOf = (name: unknown): { readonly name?: string } => (typeof name === "string" ? { name } : {})

const userOf = (grant: AccessGrant): SessionUser | null => {
    if (typeof grant.user === "object" && typeof grant.user.id === "string") {
        return { id: grant.user.id, email: typeof grant.user.email === "string" ? grant.user.email : "", ...nameOf(fieldOf(grant.user, "name")) }
    }
    const { sub, email, name } = claimsOf(grant.accessToken)
    return typeof sub === "string" ? { id: sub, email: typeof email === "string" ? email : "", ...nameOf(name) } : null
}

const MILLISECONDS = 1000

const timerPause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        const timer = setTimeout(() => {
            clearTimeout(timer)
            resolve()
        }, ms)
    })

/** Creates the one auth client of a front end (one instance, like the event stream). */
export const createAuthClient = (options: AuthClientOptions): AuthClient => {
    const fetcher = options.fetch ?? ((input, init) => fetch(input, init))
    const refreshAheadMs = options.refreshAheadMs ?? 15_000
    const attemptsMax = options.retryAttempts ?? 4
    const retryBaseMs = options.retryBaseMs ?? 400
    const now = options.now ?? Date.now
    const pause = options.sleep ?? timerPause
    const originOf = (): string => (typeof options.apiOrigin === "string" ? options.apiOrigin : options.apiOrigin())

    let token: string | undefined
    let expiresAt = 0
    let announced = false
    let user: SessionUser | null = null
    // The snapshot, the listeners and the watchers are the session store shared with every provider's client (./session.ts); the first
    // answer of a subscription reads this client's facts at call time.
    const store = createSessionStore<SessionUser>({
        announced: () => announced,
        announce: () => {
            announced = true
        },
        held: () => token !== undefined,
        userId: () => user?.id ?? null,
        renew: () => renew(),
        refreshing: () => flight.running(),
    })

    const keep = (grant: AccessGrant, event: AuthEvent = "TOKEN_REFRESHED"): void => {
        token = grant.accessToken
        expiresAt = now() + grant.expiresIn * MILLISECONDS
        announced = true
        user = userOf(grant)
        store.signedIn(user)
        store.emit(event, user?.id ?? null)
    }

    const drop = (): void => {
        const had = token !== undefined
        token = undefined
        expiresAt = 0
        announced = true
        user = null
        store.signedOut()
        if (had) store.emit("SIGNED_OUT", null)
    }

    const door = async (name: AuthDoorName, body?: object, cookie?: string): Promise<AuthDoorAnswer> => {
        const get = name === "session" || name === "jwks"
        const response = await fetcher(`${originOf()}${AUTH_DOORS[name]}`, {
            method: get ? "GET" : "POST",
            credentials: "include",
            headers: {
                ...(get ? {} : { "content-type": "application/json" }),
                ...(cookie === undefined ? {} : { cookie }),
            },
            ...(get ? {} : { body: JSON.stringify(body ?? {}) }),
        })
        const parsed: unknown = await response.json().catch(() => undefined)
        return { status: response.status, body: parsed }
    }

    const refreshEvent = (): AuthEvent => {
        if (!announced) return "INITIAL_SESSION"
        return token === undefined ? "SIGNED_IN" : "TOKEN_REFRESHED"
    }

    const requestRefresh = async (attempt = 1): Promise<string | undefined> => {
        const retry = async (): Promise<string | undefined> => {
            await pause(retryBaseMs * attempt)
            return requestRefresh(attempt + 1)
        }
        try {
            const answer = await door("refresh")
            if (answer.status < 200 || answer.status >= 300) {
                if (isSignedOutStatus(answer.status)) drop()
                else if (isTransientStatus(answer.status) && attempt < attemptsMax) return await retry()
                return undefined
            }
            if (!isGrant(answer.body)) return undefined
            keep(answer.body, refreshEvent())
            return answer.body.accessToken
        } catch {
            return attempt < attemptsMax ? retry() : undefined
        }
    }

    // Many requests answered 401 together refresh once: the others await the one in flight.
    const flight = createSingleFlight(() => requestRefresh())
    const renew = (): Promise<string | undefined> => flight.run()

    const accessToken = async (): Promise<string | undefined> =>
        token !== undefined && expiresAt - refreshAheadMs > now() ? token : renew()

    const outcomeOfAnswer = (answer: AuthDoorAnswer, fallbacks?: StatusCodes): AuthOutcome<unknown> => {
        if (answer.status >= 200 && answer.status < 300) return authOk(answer.body)
        const code = fieldOf(answer.body, "code")
        return failureOfStatus(answer.status, typeof code === "string" ? code : undefined, fallbacks)
    }

    const send: AuthClient["send"] = async (name, body, fallbacks) => {
        try {
            return outcomeOfAnswer(await door(name, body), fallbacks)
        } catch {
            return authFailure("unavailable", "transport")
        }
    }

    const signIn: AuthClient["signIn"] = async (body) => {
        const outcome = await send("login", body)
        if (!outcome.success) return outcome
        if (!isGrant(outcome.data)) return authFailure("unavailable", "grant")
        keep(outcome.data, "SIGNED_IN")
        const person = userOf(outcome.data)
        return person === null ? authFailure("unavailable", "grant") : authOk(person)
    }

    const signOut: AuthClient["signOut"] = async () => {
        try {
            await door("logout")
        } catch {
            // The token is forgotten below even when the door cannot be reached; the cookie then lapses with its session.
        }
        drop()
    }

    const checkSession: AuthClient["checkSession"] = async (cookie) => {
        if (cookie === null || cookie === "") return authFailure("refused", "no-session")
        try {
            const answer = await door("session", undefined, cookie)
            if (answer.status >= 200 && answer.status < 300) return authOk(true)
            return authFailure(isSignedOutStatus(answer.status) ? "refused" : "unavailable", String(answer.status))
        } catch {
            return authFailure("unavailable", "transport")
        }
    }

    return {
        door,
        signIn,
        send,
        signOut,
        renew,
        accessToken,
        peek: () => token,
        user: async () => ((await accessToken()) === undefined ? null : user),
        headers: async () => {
            const held = await accessToken()
            return held === undefined ? {} : { authorization: `Bearer ${held}` }
        },
        keep,
        drop,
        subscribe: store.subscribe,
        getSnapshot: store.getSnapshot,
        getServerSnapshot: store.getServerSnapshot,
        watch: store.watch,
        checkSession,
    }
}
