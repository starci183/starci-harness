import type { HttpRequest, HttpResponse } from "./http.ts"
import type { RefreshCookieOptions } from "./options.ts"
import type { DeviceMeta, SessionTokens } from "./ports.ts"
import { cookieValue } from "./primitives.ts"

const MAX_AGENT_LENGTH = 512
const MILLISECONDS = 1000

/**
 * The refresh cookie: httpOnly and Secure on every write and clear, SameSite lax (or strict), on the configured domain so the web
 * app and the API both see it. The token only ever leaves the back end through this cookie, never in a body or a URL.
 */
export class RefreshCookie {
    readonly #options: RefreshCookieOptions

    constructor(options: RefreshCookieOptions) {
        this.#options = options
    }

    /** The refresh token the browser sent (empty text when there is none). */
    read(request: HttpRequest): string {
        const header = request.headers.cookie
        return cookieValue(Array.isArray(header) ? header.join("; ") : (header ?? ""), this.#options.name)
    }

    /** The device a request comes from: its user agent (bounded) and caller address. */
    deviceOf(request: HttpRequest): DeviceMeta {
        const agent = request.headers["user-agent"]
        const text = Array.isArray(agent) ? agent[0] : agent
        return { userAgent: text?.slice(0, MAX_AGENT_LENGTH) ?? null, ip: request.ip ?? null }
    }

    /** Sets the cookie to the refresh token of a session, clearing the copies older sessions kept under their paths. */
    issue(response: HttpResponse, tokens: SessionTokens): void {
        for (const path of this.#legacyPaths()) response.clearCookie(this.#options.name, this.#flags(path))
        response.cookie(this.#options.name, tokens.cookieToken, {
            ...this.#flags(this.#path()),
            maxAge: tokens.refreshMaxAgeSeconds * MILLISECONDS,
        })
    }

    /** Clears the cookie on its path and on the paths older sessions used. */
    clear(response: HttpResponse): void {
        for (const path of [this.#path(), ...this.#legacyPaths()]) response.clearCookie(this.#options.name, this.#flags(path))
    }

    #path(): string {
        return this.#options.path ?? "/"
    }

    #legacyPaths(): readonly string[] {
        return (this.#options.legacyPaths ?? ["/auth"]).filter((path) => path !== this.#path())
    }

    #flags(path: string): {
        readonly httpOnly: true
        readonly secure: true
        readonly sameSite: "lax" | "strict"
        readonly path: string
        readonly domain?: string
    } {
        const domain = this.#options.domain
        return {
            httpOnly: true,
            secure: true,
            sameSite: this.#options.sameSite ?? "lax",
            path,
            ...(domain === undefined ? {} : { domain }),
        }
    }
}
