const LOCALES = ["vi", "en"] as const

/** The locale served at the unprefixed path. */
export const DEFAULT_LOCALE = "vi" as const

/** The fixed product time zone used by the server and hydrated client. */
export const PRODUCT_TIME_ZONE = "Asia/Ho_Chi_Minh"

/** The one locale-routing table of the web app. */
export const routing: {
    readonly locales: typeof LOCALES
    readonly defaultLocale: typeof DEFAULT_LOCALE
    readonly localePrefix: "as-needed"
} = {
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    localePrefix: "as-needed" as const,
}
