import "server-only"
import { getRequestConfig } from "next-intl/server"
import { cookies, headers } from "next/headers.js"
import { fallbackText, messagesOf } from "./catalog.ts"
import type { LoadCatalog, MissingMessage } from "./catalog.ts"
import type { I18n, LocalePrefix } from "./config.ts"
import { readRequestLocale } from "./locale.ts"

/** What an app tells its request config. */
export interface RequestConfigOptions<Locale extends string> {
    /** The app's name, written into the text of a message its catalog lacks. */
    readonly app: string
    /** Loads the app's own catalog for a served locale. */
    readonly loadMessages: LoadCatalog<Locale>
    /**
     * Reads the locale the route states (Next root params: `() => locale()` from `next/root-params`, enabled by `experimental.rootParams`
     * in the app's next.config.ts). Without it the locale is the one the proxy negotiated.
     */
    readonly readRouteLocale?: () => Promise<unknown>
}

/** The request config next-intl's plugin loads. */
export type I18nRequestConfig = ReturnType<typeof getRequestConfig>

/**
 * The request config the app's `modules/i18n/request.ts` default-exports and next-intl's plugin loads: the locale of the request
 * (an unknown one resolves to the default before the loader runs, so a missing catalog file is never imported), the product time
 * zone, the app's own catalog and the fallback text of a missing key.
 */
export const createRequestConfig = <const Locales extends readonly [string, ...string[]], const Prefix extends LocalePrefix>(
    i18n: I18n<Locales, Prefix>,
    options: RequestConfigOptions<Locales[number]>,
): I18nRequestConfig =>
    getRequestConfig(async () => {
        const locale = await readRequestLocale(i18n, {
            route: options.readRouteLocale,
            header: async (name) => (await headers()).get(name),
            cookie: async (name) => (await cookies()).get(name)?.value,
        })
        return {
            locale,
            timeZone: i18n.timeZone,
            messages: messagesOf(await options.loadMessages(locale)),
            getMessageFallback: (missing: MissingMessage) => fallbackText(options.app, missing),
        }
    })
