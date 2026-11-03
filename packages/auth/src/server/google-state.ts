import { AUTH_DOORS } from "../contracts/index.ts"
import type { HttpRequest } from "./http.ts"
import type { AuthOptions } from "./options.ts"
import type { AuthClock, AuthIds } from "./ports.ts"
import { cookieValue, sameSitePath, sameValue } from "./primitives.ts"
import type { AuthTokens } from "./tokens.ts"

/** The cookie that carries one Google round trip, when the options name none. */
export const DEFAULT_GOOGLE_STATE_COOKIE = "auth_google_state"
/** The only path the state cookie is sent to. */
export const GOOGLE_STATE_PATH = AUTH_DOORS.google
/** How long a Google round trip may take, in milliseconds. */
export const GOOGLE_STATE_TTL_MS = 600_000

type StoreDone = (error: Error | null, handle?: string) => void
type VerifyDone = (error: Error | null, verifier?: unknown, context?: unknown) => void

/**
 * The state store passport-oauth2 calls for `state` and PKCE without a server session: the handle (echoed as `state`), the code
 * verifier and the landing path travel in a signed, httpOnly cookie that only the callback path receives, and the handle is
 * compared on return. The landing path is a same-site path only, so the callback can never redirect off the web origin.
 */
export class GoogleStateClient {
    readonly #tokens: AuthTokens
    readonly #clock: AuthClock
    readonly #ids: AuthIds
    readonly #returnOrigin: string
    readonly #cookie: string

    constructor(deps: {
        readonly tokens: AuthTokens
        readonly clock: AuthClock
        readonly ids: AuthIds
        readonly options: Pick<AuthOptions, "returnOrigin" | "google">
    }) {
        this.#tokens = deps.tokens
        this.#clock = deps.clock
        this.#ids = deps.ids
        this.#returnOrigin = deps.options.returnOrigin
        this.#cookie = deps.options.google?.stateCookie ?? DEFAULT_GOOGLE_STATE_COOKIE
    }

    /** The name of the state cookie. */
    get cookieName(): string {
        return this.#cookie
    }

    /** Called by passport-oauth2 on the outbound leg (the five-argument PKCE form). */
    store(req: HttpRequest, verifier: string, _state: unknown, _meta: unknown, done: StoreDone): void {
        const handle = this.#ids.next()
        const signed = this.#tokens.signState({
            w: handle,
            u: verifier,
            r: this.#landingOf(req),
            e: this.#clock.now().getTime() + GOOGLE_STATE_TTL_MS,
            p: "google",
        })
        req.res?.cookie(this.#cookie, signed, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: GOOGLE_STATE_PATH,
            maxAge: GOOGLE_STATE_TTL_MS,
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
        return url.origin === this.#returnOrigin ? sameSitePath(`${url.pathname}${url.search}`, "/") : "/"
    }

    /** Called by passport-oauth2 on the return leg (the meta form, since this method takes four arguments): the cookie must be ours, unexpired and carry the same handle as `state`. */
    verify(req: HttpRequest, providedState: string, _meta: unknown, done: VerifyDone): void {
        const header = req.headers.cookie
        const raw = cookieValue(Array.isArray(header) ? header.join("; ") : (header ?? ""), this.#cookie)
        req.res?.clearCookie(this.#cookie, { httpOnly: true, secure: true, sameSite: "lax", path: GOOGLE_STATE_PATH })
        const state = raw === "" ? null : this.#tokens.verifyState(raw, this.#clock.now())
        if (state?.p !== "google" || typeof providedState !== "string" || !sameValue(state.w, providedState)) {
            done(null, false, { message: "state" })
            return
        }
        done(null, state.u, { next: sameSitePath(state.r, "/") })
    }
}
