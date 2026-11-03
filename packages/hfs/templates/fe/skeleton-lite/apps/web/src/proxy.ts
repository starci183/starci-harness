import { createProxy } from "@starci/next-i18n/proxy"
import type { LocaleProxy } from "@starci/next-i18n/proxy"
import { i18n } from "@/modules/i18n"

/**
 * Locale routing only. The session lives in the browser (modules/auth) and the back end verifies the access token of
 * every call, so the proxy neither reads nor refreshes it.
 */
export const proxy: LocaleProxy = createProxy(i18n)

/** Routes that pass through locale negotiation. */
export const config = {
    matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
}
