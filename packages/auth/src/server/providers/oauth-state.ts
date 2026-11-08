import type { HttpRequest } from "../http.ts"
import type { AuthClock, AuthIds } from "../ports.ts"
import { cookieValue, sameSitePath, sameValue } from "../primitives.ts"
import type { AuthTokens } from "../tokens.ts"

/** How long one provider round trip may take, in milliseconds. */
export const OAUTH_STATE_TTL_MS = 600_000

/** The state cookie of a provider when its options name none: `auth_<id>_state` (Google's is `auth_google_state`). */
export const oauthStateCookie = (provider: string): string => `auth_${provider}_state`

/** Where one provider's round trip is kept. */
export interface OAuthStateOptions {
    /** The provider id, signed into the state as its purpose (`p`), so a state of one provider never passes another's callback. */
    readonly provider: string
    /** The cookie that carries the round trip. */
    readonly cookie: string
    /** The only path the cookie is sent to: the provider's door (`/auth/<id>`), which its callback sits under. */
    readonly path: string
    /** The origin of the web app: an absolute return address is kept only on it. */
    readonly returnOrigin: string
}

/** What a state store needs. */
export interface OAuthStateDeps {
    readonly tokens: AuthTokens
    readonly clock: AuthClock
    readonly ids: AuthIds
    readonly state: OAuthStateOptions
}

type StoreDone = (error: Error | null, handle?: string) => void
type VerifyDone = (error: Error | null, verifier?: unknown, context?: unknown) => void

/**
 * The state store passport-oauth2 calls for `state` and PKCE without a server session, for any provider: the handle (echoed as
 * `state`), the code verifier and the landing path travel in a signed, httpOnly cookie that only the provider's door path receives,
 * and the handle is compared on return. The landing path is a same-site path only, so the callback can never redirect off the web
 * origin. The signed value is `{ w: handle, u: verifier, r: landing, e: expiry, p: provider }` under the HMAC key `AuthTokens.signState`
 * derives, so Google's cookie is the one 0.5.0 wrote, byte for byte in shape.
 */
export class OAuthStateClient {
    readonly #tokens: AuthTokens
    readonly #clock: AuthClock
    readonly #ids: AuthIds
    readonly #state: OAuthStateOptions

    constructor(deps: OAuthStateDeps) {
        this.#tokens = deps.tokens
        this.#clock = deps.clock
        this.#ids = deps.ids
        this.#state = deps.state
    }

    /** The name of the state cookie. */
    get cookieName(): string {
        return this.#state.cookie
    }

    /** The provider this store keeps round trips of. */
    get provider(): string {
        return this.#state.provider
    }

    /** Called by passport-oauth2 on the outbound leg (the five-argument PKCE form). */
    store(req: HttpRequest, verifier: string, _state: unknown, _meta: unknown, done: StoreDone): void {
        const handle = this.#ids.next()
        const signed = this.#tokens.signState({
            w: handle,
            u: verifier,
            r: this.#landingOf(req),
            e: this.#clock.now().getTime() + OAUTH_STATE_TTL_MS,
            p: this.#state.provider,
        })
        req.res?.cookie(this.#state.cookie, signed, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: this.#state.path,
            maxAge: OAUTH_STATE_TTL_MS,
        })
        done(null, handle)
    }

    /** The same-site path to land on: the requested return address when it is a path, or an absolute address on the web origin; else the root. */
    #landingOf(req: HttpRequest): string {
        const { returnTo, next } = req.query ?? {}
        const wanted = typeof returnTo === "string" ? returnTo : next
        if (typeof wanted !== "string") return "/"
        if (!URL.canParse(wanted)) return sameSitePath(wanted, "/")
        const url = new URL(wanted)
        return url.origin === this.#state.returnOrigin ? sameSitePath(`${url.pathname}${url.search}`, "/") : "/"
    }

    /** Called by passport-oauth2 on the return leg (the meta form, since this method takes four arguments): the cookie must be ours, unexpired, of this provider and carry the same handle as `state`. */
    verify(req: HttpRequest, providedState: string, _meta: unknown, done: VerifyDone): void {
        const header = req.headers.cookie
        const raw = cookieValue(Array.isArray(header) ? header.join("; ") : (header ?? ""), this.#state.cookie)
        req.res?.clearCookie(this.#state.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: this.#state.path })
        const state = raw === "" ? null : this.#tokens.verifyState(raw, this.#clock.now())
        if (state?.p !== this.#state.provider || typeof providedState !== "string" || !sameValue(state.w, providedState)) {
            done(null, false, { message: "state" })
            return
        }
        done(null, state.u, { next: sameSitePath(state.r, "/") })
    }
}
