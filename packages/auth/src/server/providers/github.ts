import { PassportStrategy } from "@nestjs/passport"
import { isPlainRecord } from "@starci/common"
import OAuth2Strategy from "passport-oauth2"
import { AUTH_ERROR_CODES } from "../../contracts/index.ts"
import { AuthError } from "../errors.ts"
import type { AuthAuthenticator, AuthSubject, ProviderProfile } from "../ports.ts"
import { revealed } from "../primitives.ts"
import type { SecretInput } from "../primitives.ts"
import type { OAuthStateClient } from "./oauth-state.ts"
import { defineProvider, signInWithProvider } from "./provider.ts"
import type { SignInProvider } from "./provider.ts"

/** The id of the GitHub provider: its passport strategy, its state purpose and its doors (`/auth/github`, `/auth/github/callback`). */
export const GITHUB_PROVIDER_ID = "github"

/** The GitHub endpoints the provider speaks to (github.com OAuth apps and the REST API). */
export const GITHUB_ENDPOINTS = {
    authorization: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    user: "https://api.github.com/user",
    emails: "https://api.github.com/user/emails",
} as const

/** The scopes the provider asks for: the profile and the addresses with their verification. */
export const GITHUB_SCOPES: readonly string[] = ["read:user", "user:email"]

/** The GitHub OAuth app and where GitHub sends the browser back. */
export interface GitHubOptions {
    /** The OAuth app's client id. */
    readonly clientId: string
    /** The OAuth app's client secret. */
    readonly clientSecret: SecretInput
    /** The registered callback address (`<api>/auth/github/callback`). */
    readonly callbackUrl: string
    /** The name of the cookie that carries one GitHub round trip (`auth_github_state`). */
    readonly stateCookie?: string | undefined
    /** The `User-Agent` the REST API requires (`starci-auth`). */
    readonly userAgent?: string | undefined
}

/** What the GitHub REST API answered for one person: `GET /user` and `GET /user/emails`. */
export interface GitHubRawProfile {
    readonly user: unknown
    readonly emails: unknown
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)

/** The address to trust: the primary verified one, else any verified one, else the public profile address (unverified). */
const addressOf = (user: Readonly<Record<string, unknown>>, emails: unknown): { readonly email: string | null; readonly verified: boolean } => {
    const listed = Array.isArray(emails) ? emails.filter(isPlainRecord) : []
    const verified = listed.filter((entry) => entry.verified === true && text(entry.email) !== null)
    const chosen = verified.find((entry) => entry.primary === true) ?? verified[0]
    if (chosen !== undefined) return { email: text(chosen.email), verified: true }
    return { email: text(user.email), verified: false }
}

/** The facts the app needs from GitHub: the numeric account id is the subject (a login can be renamed and reused), the primary verified address, the name and the avatar. */
export const githubProfileOf = (raw: GitHubRawProfile): ProviderProfile => {
    const user = raw.user
    if (!isPlainRecord(user) || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) throw new AuthError(AUTH_ERROR_CODES.ProviderRejected, { context: { provider: GITHUB_PROVIDER_ID } })
    const address = addressOf(user, raw.emails)
    return {
        provider: GITHUB_PROVIDER_ID,
        subject: String(user.id),
        email: address.email,
        emailVerified: address.verified,
        name: text(user.name) ?? text(user.login),
        picture: text(user.avatar_url),
    }
}

type ProfileDone = (error?: unknown, profile?: unknown) => void

const parsed = (body: string | Buffer | undefined): unknown => {
    try {
        return JSON.parse(typeof body === "string" ? body : (body?.toString("utf8") ?? "")) as unknown
    } catch {
        return undefined
    }
}

/** passport-oauth2 against GitHub, with the profile read from the REST API (`/user`, `/user/emails`) under the access token. */
class GitHubOAuth2Strategy extends OAuth2Strategy {
    constructor(options: GitHubOptions, verify: OAuth2Strategy.VerifyFunction) {
        super(
            {
                authorizationURL: GITHUB_ENDPOINTS.authorization,
                tokenURL: GITHUB_ENDPOINTS.token,
                clientID: options.clientId,
                clientSecret: revealed(options.clientSecret),
                callbackURL: options.callbackUrl,
                scope: [...GITHUB_SCOPES],
                customHeaders: { "User-Agent": options.userAgent ?? "starci-auth", Accept: "application/json" },
                state: true,
                pkce: true,
            },
            verify,
        )
        this.name = GITHUB_PROVIDER_ID
        this._oauth2.useAuthorizationHeaderforGET(true)
    }

    /**
     * Called by passport-oauth2 once the code is exchanged: the person and their addresses, raw, for `githubProfileOf`. passport runs it on an
     * `Object.create` of the registered strategy, so it reaches the client through the prototype (`this._oauth2`), never a private member.
     */
    override userProfile(accessToken: string, done: ProfileDone): void {
        const read = (url: string): Promise<unknown> =>
            new Promise((resolve, reject) => {
                // node-oauth types the error as always present; it is null on success.
                this._oauth2.get(url, accessToken, (error: unknown, body?: string | Buffer) => {
                    if (error === null || error === undefined) resolve(parsed(body))
                    else reject(new AuthError(AUTH_ERROR_CODES.ProviderRejected, { context: { provider: GITHUB_PROVIDER_ID, status: isPlainRecord(error) ? error.statusCode : undefined } }))
                })
            })
        Promise.all([read(GITHUB_ENDPOINTS.user), read(GITHUB_ENDPOINTS.emails)]).then(
            ([user, emails]) => {
                done(null, { user, emails } satisfies GitHubRawProfile)
            },
            (error: unknown) => {
                done(error)
            },
        )
    }
}

/** The GitHub OAuth strategy: authorization code with `state` and PKCE (S256), the round trip held in a signed cookie. */
export class PassportGitHubStrategy extends PassportStrategy(GitHubOAuth2Strategy, GITHUB_PROVIDER_ID) {
    readonly #authenticator: AuthAuthenticator

    constructor(options: GitHubOptions, authenticator: AuthAuthenticator, state: OAuthStateClient) {
        super(options)
        this.#authenticator = authenticator
        // passport-oauth2 types describe only its session stores; the stateless PKCE store replaces the one it built.
        Object.assign(this, { _stateStore: state })
    }

    /** Called by passport with what GitHub answered; answers the person the app stands it for. */
    validate(_accessToken: string, _refreshToken: string, raw: GitHubRawProfile): Promise<AuthSubject> {
        return signInWithProvider(this.#authenticator, githubProfileOf(raw))
    }
}

/** The GitHub provider: `AuthModule.register({ providers: [github({ clientId, clientSecret, callbackUrl })] })`; the app implements `signInWithProvider`. */
export const github = (options: GitHubOptions): SignInProvider<GitHubOptions, GitHubRawProfile> =>
    defineProvider({
        id: GITHUB_PROVIDER_ID,
        options,
        stateCookie: options.stateCookie,
        profileOf: githubProfileOf,
        strategy: ({ authenticator, state }) => new PassportGitHubStrategy(options, authenticator, state),
    })
