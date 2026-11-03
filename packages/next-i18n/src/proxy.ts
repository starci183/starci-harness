import createMiddleware from "next-intl/middleware"
import { NextResponse } from "next/server.js"
import type { NextRequest } from "next/server.js"
import type { I18n, LocalePrefix } from "./config.ts"

/** The first path segments that never carry a locale: the API, the health probe and the framework. */
export const DEFAULT_UNNEGOTIATED_ROOTS: readonly string[] = ["api", "health", "_next", "_vercel"]

/** What the proxy may be told beyond the app's languages. */
export interface ProxyOptions {
    /** The first path segments no locale is negotiated for; `DEFAULT_UNNEGOTIATED_ROOTS` when omitted. A file with an extension is never negotiated. */
    readonly unnegotiatedRoots?: readonly string[]
}

/** The proxy a Next app mounts as `src/proxy.ts`. */
export type LocaleProxy = (request: NextRequest) => NextResponse

/** Whether the path belongs to one of the roots no locale is negotiated for, or is a file with an extension. */
export const isUnnegotiated = (pathname: string, roots: readonly string[]): boolean => {
    const segments = pathname.split("/")
    const last = segments.at(-1) ?? ""
    return roots.includes(segments[1] ?? "") || (last.includes(".") && !last.endsWith("."))
}

/**
 * The one thing that runs before a route exists: which language it is in. next-intl's middleware reads the cookie, falls back to
 * the default and prefixes the path as the app's routing says; the roots the app lists and any file with an extension pass through.
 * It imports the routing only, never the navigation: the proxy and the rendered navigation run under different React export
 * conditions.
 */
export const createProxy = <const Locales extends readonly [string, ...string[]], const Prefix extends LocalePrefix>(
    i18n: I18n<Locales, Prefix>,
    options: ProxyOptions = {},
): LocaleProxy => {
    const roots = options.unnegotiatedRoots ?? DEFAULT_UNNEGOTIATED_ROOTS
    const negotiate = createMiddleware(i18n.routing)
    return (request) => (isUnnegotiated(request.nextUrl.pathname, roots) ? NextResponse.next() : negotiate(request))
}
