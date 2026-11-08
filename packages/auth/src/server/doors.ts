import type { AccessGrant, GoogleRedirect, ProviderRedirect } from "../contracts/index.ts"
import type { RefreshCookie } from "./cookie.ts"
import type { AuthFlows } from "./flows.ts"
import type { HttpExchange } from "./http.ts"
import type { AuthLogger, SessionTokens } from "./ports.ts"
import { GOOGLE_PROVIDER_ID } from "./providers/google.ts"
import type { AuthSessions } from "./sessions.ts"

/** The status of a provider's callback redirect. */
export const SEE_OTHER = 303

/** The log event of a failed sign-in through one provider (`auth.github-sign-in-failed`). */
export const providerSignInFailedEvent = (provider: string): string => `auth.${provider}-sign-in-failed`

/** The log event of a failed Google sign-in. */
export const GOOGLE_SIGN_IN_FAILED_EVENT = providerSignInFailedEvent(GOOGLE_PROVIDER_ID)

/** The body a sign-in, refresh or session door answers. */
export const accessOf = (tokens: SessionTokens): AccessGrant => ({
    accessToken: tokens.accessToken,
    expiresIn: tokens.accessExpiresIn,
    expiresAt: tokens.accessExpiresAt,
    user: tokens.user,
})

/** What the doors need. */
export interface DoorsDeps {
    readonly flows: AuthFlows
    readonly sessions: AuthSessions
    readonly cookie: RefreshCookie
    readonly returnOrigin: string
    readonly logger?: AuthLogger | undefined
}

/**
 * The cookie doors of sign-in over the flows, the sessions and the cookie: what a controller calls. The refresh token only goes
 * into the cookie; every refresh rotates and sets its successor (a racing one included), and a refresh that cannot be used clears it.
 */
export class AuthDoors {
    readonly #deps: DoorsDeps

    constructor(deps: DoorsDeps) {
        this.#deps = deps
    }

    /** Email and password through the local strategy; the refresh token goes into the cookie. */
    async login(exchange: HttpExchange): Promise<AccessGrant> {
        const subject = await this.#deps.flows.authenticateLocal(exchange)
        const tokens = await this.#deps.sessions.start(subject, this.#deps.cookie.deviceOf(exchange.req))
        this.#deps.cookie.issue(exchange.res, tokens, exchange.req)
        return accessOf(tokens)
    }

    /** Rotates the cookie token and sets the successor (every refresh rotates, a racing one included); a cookie that cannot be used is cleared and the refusal rethrown. */
    async refresh(exchange: HttpExchange): Promise<AccessGrant> {
        try {
            const tokens = await this.#deps.sessions.refresh(this.#deps.cookie.read(exchange.req))
            this.#deps.cookie.issue(exchange.res, tokens, exchange.req)
            return accessOf(tokens)
        } catch (cause) {
            this.#deps.cookie.clear(exchange.res, exchange.req)
            throw cause
        }
    }

    /** Answers a fresh access token for the cookie session without rotating the cookie. */
    async session(exchange: HttpExchange): Promise<AccessGrant> {
        return accessOf(await this.#deps.sessions.access(this.#deps.cookie.read(exchange.req)))
    }

    /** Ends the session of the cookie and clears it. */
    async logout(exchange: HttpExchange): Promise<void> {
        await this.#deps.sessions.end(this.#deps.cookie.read(exchange.req))
        this.#deps.cookie.clear(exchange.res, exchange.req)
    }

    /** Sends the browser to the consent screen of a registered provider (`/auth/<id>`); an unregistered one is refused. */
    beginProvider(provider: string, exchange: HttpExchange): Promise<void> {
        return this.#deps.flows.begin(provider, exchange)
    }

    /**
     * Finishes a provider's round trip (`/auth/<id>/callback`): state, PKCE and profile are verified, the account found, linked or
     * created, its session opened and its cookie set. A failure never throws: the browser is sent back to the sign-in page, because a
     * redirect-only door has nowhere to show an error body.
     */
    async completeProvider(provider: string, exchange: HttpExchange): Promise<ProviderRedirect> {
        try {
            const completion = await this.#deps.flows.complete(provider, exchange)
            const tokens = await this.#deps.sessions.start(completion.subject, this.#deps.cookie.deviceOf(exchange.req))
            this.#deps.cookie.issue(exchange.res, tokens, exchange.req)
            return { url: `${this.#deps.returnOrigin}${completion.next}`, statusCode: SEE_OTHER }
        } catch (cause) {
            this.#deps.cookie.clear(exchange.res, exchange.req)
            this.#deps.logger?.warn(providerSignInFailedEvent(provider), { cause: String(cause) })
            return { url: `${this.#deps.returnOrigin}/sign-in?auth=error`, statusCode: SEE_OTHER }
        }
    }

    /** Sends the browser to the Google consent screen. */
    beginGoogle(exchange: HttpExchange): Promise<void> {
        return this.beginProvider(GOOGLE_PROVIDER_ID, exchange)
    }

    /** Finishes the Google round trip, as `completeProvider("google", ...)`. */
    completeGoogle(exchange: HttpExchange): Promise<GoogleRedirect> {
        return this.completeProvider(GOOGLE_PROVIDER_ID, exchange)
    }
}
