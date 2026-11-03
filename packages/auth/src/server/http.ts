/** The cookie attributes a response writes. */
export interface CookieWrite {
    readonly httpOnly: boolean
    readonly secure: boolean
    readonly sameSite: "lax" | "strict"
    readonly path: string
    readonly maxAge?: number
    readonly domain?: string
}

/** The part of a request the package reads. */
export interface HttpRequest {
    readonly headers: Readonly<Record<string, string | string[] | undefined>>
    readonly ip?: string | undefined
    readonly query?: Readonly<Record<string, unknown>> | undefined
    readonly res?: HttpResponse | undefined
}

/** The part of a response the package writes. */
export interface HttpResponse {
    cookie(name: string, value: string, options: CookieWrite): unknown
    clearCookie(name: string, options: Omit<CookieWrite, "maxAge">): unknown
    once(event: "finish", listener: () => void): unknown
}

/** The two halves of an HTTP exchange the flows work on (an Express request and response satisfy it). */
export interface HttpExchange {
    readonly req: HttpRequest
    readonly res: HttpResponse
}
