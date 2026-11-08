import { OIDC_ERROR_CODES } from "../contracts/index.ts"
import type { OidcDiscovery } from "./discovery.ts"
import { OidcError } from "./errors.ts"
import type { OidcHttpResponse, ResolvedOidcOptions } from "./options.ts"
import { isRecord, revealed } from "./primitives.ts"
import { send } from "./transport.ts"

/** The account a sign-up creates. */
export interface OidcNewUser {
    readonly email: string
    readonly username: string
    /** The first password; it is set permanent (not temporary) and is sent once. */
    readonly password: string
}

/** The account a sign-up created. */
export interface OidcCreatedUser {
    /** The provider's id of the account: the `sub` of its tokens. */
    readonly subject: string
}

/** The account an email belongs to. */
export interface OidcFoundUser {
    readonly subject: string
    readonly username: string
}

interface HeldToken {
    readonly token: string
    readonly expiresAt: number
}

interface ListedUser {
    readonly id: string
    readonly username: string
    readonly email?: string
}

/** A service-account token is renewed this long before it expires, so a request never carries one that dies in flight. */
const TOKEN_MARGIN_MS = 10_000
const SECOND_MS = 1000

const rejected = (): OidcError => new OidcError(OIDC_ERROR_CODES.Rejected)

/** True when an answer's error text speaks of the password (the provider's policy refusing it), not of another field. */
const speaksOfPassword = (body: unknown): boolean => {
    if (!isRecord(body)) return false
    return [body.error, body.errorMessage, body.error_description].some((field) => typeof field === "string" && /password/iu.test(field))
}

/** The last path segment of a `Location` address: the id the provider gave a created account. */
const idOfLocation = (location: string | undefined): string | undefined => {
    if (location === undefined || !URL.canParse(location)) return undefined
    const segment = new URL(location).pathname
        .split("/")
        .filter((part) => part !== "")
        .pop()
    return segment === undefined ? undefined : decodeURIComponent(segment)
}

/** The realm admin base, `<origin>/admin/realms/<realm>`, derived from a Keycloak issuer `<origin>[/<prefix>]/realms/<realm>`. */
export const adminBaseOf = (issuer: string): string => {
    const url = new URL(issuer)
    const path = url.pathname.replace(/\/$/u, "")
    const at = path.lastIndexOf("/realms/")
    const realm = at < 0 ? "" : path.slice(at + "/realms/".length)
    if (realm === "" || realm.includes("/")) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "issuer" } })
    return `${url.origin}${path.slice(0, at)}/admin/realms/${realm}`
}

/**
 * The provider's admin API as the registered client's service account (the client credentials grant, the token cached until it is about
 * to expire): create an account, find one by email, set a password, end every session. The realm admin base is derived from the issuer.
 * The service account needs the realm-management roles for users; a request it cannot make is `Rejected`. Nothing here logs a
 * password or a token.
 */
export class OidcAdminClient {
    readonly #options: ResolvedOidcOptions
    readonly #discovery: OidcDiscovery
    #held: HeldToken | undefined
    #pending: Promise<string> | undefined

    constructor(options: ResolvedOidcOptions, discovery: OidcDiscovery) {
        this.#options = options
        this.#discovery = discovery
    }

    /**
     * Creates an enabled account with a permanent password. A taken email or username throws `EmailRegistered`; a password the realm's policy
     * refuses throws `PasswordInvalid`.
     */
    async createUser(input: OidcNewUser): Promise<OidcCreatedUser> {
        const response = await this.#call("POST", "/users", {
            username: input.username,
            email: input.email,
            enabled: true,
            emailVerified: false,
            credentials: [{ type: "password", value: input.password, temporary: false }],
        })
        if (response.status === 409) throw new OidcError(OIDC_ERROR_CODES.EmailRegistered)
        if (response.status === 400 && speaksOfPassword(response.body)) throw new OidcError(OIDC_ERROR_CODES.PasswordInvalid)
        if (response.status !== 201) throw rejected()
        const subject = idOfLocation(response.location) ?? (await this.#byUsername(input.username))
        if (subject === undefined) throw rejected()
        return { subject }
    }

    /** The account whose email is exactly this one (case-insensitive), or null. */
    async findUserByEmail(email: string): Promise<OidcFoundUser | null> {
        const users = await this.#search({ email, exact: "true" })
        const wanted = email.toLowerCase()
        const found = users.find((user) => user.email?.toLowerCase() === wanted)
        return found === undefined ? null : { subject: found.id, username: found.username }
    }

    /** Sets a permanent password. A password the policy refuses throws `PasswordInvalid`. */
    async resetPassword(subject: string, password: string): Promise<void> {
        const response = await this.#call("PUT", `/users/${encodeURIComponent(subject)}/reset-password`, { type: "password", value: password, temporary: false })
        if (response.status === 400) throw new OidcError(OIDC_ERROR_CODES.PasswordInvalid)
        if (response.status !== 204 && response.status !== 200) throw rejected()
    }

    /** Ends every session of the account at the provider, which also ends their refresh tokens. */
    async logoutAll(subject: string): Promise<void> {
        const response = await this.#call("POST", `/users/${encodeURIComponent(subject)}/logout`)
        if (response.status !== 204 && response.status !== 200) throw rejected()
    }

    async #byUsername(username: string): Promise<string | undefined> {
        const users = await this.#search({ username, exact: "true" })
        return users.find((user) => user.username.toLowerCase() === username.toLowerCase())?.id
    }

    async #search(query: Readonly<Record<string, string>>): Promise<readonly ListedUser[]> {
        const response = await this.#call("GET", `/users?${new URLSearchParams(query).toString()}`)
        if (response.status !== 200 || !Array.isArray(response.body)) throw rejected()
        const list: unknown[] = response.body
        return list.flatMap((entry): ListedUser[] =>
            isRecord(entry) && typeof entry.id === "string" && entry.id !== "" && typeof entry.username === "string"
                ? [{ id: entry.id, username: entry.username, ...(typeof entry.email === "string" ? { email: entry.email } : {}) }]
                : [],
        )
    }

    /** One admin request with the service-account token; a 401 means the token died early, so it is renewed and the request is repeated once. */
    async #call(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<OidcHttpResponse> {
        const url = `${adminBaseOf(this.#options.issuer)}${path}`
        const attempt = async (renew: boolean): Promise<OidcHttpResponse> =>
            send(this.#options, { method, url, headers: { authorization: `Bearer ${await this.#token(renew)}` }, ...(body === undefined ? {} : { body }) })
        const first = await attempt(false)
        return first.status === 401 ? attempt(true) : first
    }

    #token(renew: boolean): Promise<string> {
        const now = this.#options.clock.now().getTime()
        if (!renew && this.#held !== undefined && this.#held.expiresAt - TOKEN_MARGIN_MS > now) return Promise.resolve(this.#held.token)
        this.#pending ??= this.#fetch().finally(() => {
            this.#pending = undefined
        })
        return this.#pending
    }

    async #fetch(): Promise<string> {
        const client = this.#options.client
        if (client?.clientSecret === undefined) throw new OidcError(OIDC_ERROR_CODES.ConfigurationInvalid, { params: { key: "client.clientSecret" } })
        const { tokenEndpoint } = await this.#discovery.get()
        const response = await send(this.#options, {
            method: "POST",
            url: tokenEndpoint,
            form: { grant_type: "client_credentials", client_id: client.clientId, client_secret: revealed(client.clientSecret) },
        })
        const answer = response.body
        if (response.status !== 200 || !isRecord(answer) || typeof answer.access_token !== "string" || typeof answer.expires_in !== "number" || !(answer.expires_in > 0)) throw rejected()
        this.#held = { token: answer.access_token, expiresAt: this.#options.clock.now().getTime() + answer.expires_in * SECOND_MS }
        return answer.access_token
    }
}
