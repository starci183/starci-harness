import { defineRouting } from "next-intl/routing"
import type { RoutingConfig } from "next-intl/routing"

/** How the locale shows in the address: `always` prefixes every path, `as-needed` leaves the default locale bare, `never` keeps it in the cookie only. */
export type LocalePrefix = "always" | "as-needed" | "never"

/** The cookie that remembers the reader's choice when an app names none: next-intl's own. */
export const DEFAULT_LOCALE_COOKIE = "NEXT_LOCALE"

/** The locale cookie of an app: its name and how long it lives, in seconds. */
export interface LocaleCookieOptions {
    readonly name: string
    readonly maxAge?: number
    readonly sameSite?: "lax" | "strict" | "none"
}

/** What an app states about its languages; everything else (the proxy, the navigation, the request config) is derived from it. */
export interface I18nOptions<Locales extends readonly string[], Prefix extends LocalePrefix> {
    /** The locales the app serves, in the order of preference. */
    readonly locales: Locales
    /** The locale served at the bare path and used when the reader chose none; one of `locales`. */
    readonly defaultLocale: Locales[number]
    /** The product time zone: fixed, so the server and the hydrated client format the same instant the same way. */
    readonly timeZone: string
    /** How the locale shows in the address; `as-needed` when omitted. */
    readonly localePrefix?: Prefix
    /** The locale cookie; next-intl's `NEXT_LOCALE` when omitted. */
    readonly localeCookie?: LocaleCookieOptions
    /** The BCP 47 tag the UI kit's date and number parts take for a locale; the locale itself when omitted. */
    readonly intlTags?: Readonly<Record<Locales[number], string>>
}

/** The routing table next-intl reads: the locales, the default, the prefix mode and the cookie; no localized pathnames or domains. */
export type I18nRouting<Locales extends readonly string[], Prefix extends LocalePrefix> = RoutingConfig<Locales, Prefix, never, never>

/** The one description of an app's languages, read by the proxy, the navigation, the request config and the layout. */
export interface I18n<Locales extends readonly string[], Prefix extends LocalePrefix = "as-needed"> {
    readonly locales: Locales
    readonly defaultLocale: Locales[number]
    readonly timeZone: string
    readonly localePrefix: Prefix
    /** The name of the cookie that remembers the reader's locale. */
    readonly localeCookieName: string
    readonly routing: I18nRouting<Locales, Prefix>
    /** Whether the value is one of the served locales. */
    readonly isLocale: (value: unknown) => value is Locales[number]
    /** The value when it is a served locale, else the default (a stale cookie, an unknown option). */
    readonly localeOf: (value: unknown) => Locales[number]
    /** The BCP 47 tag of a served locale. */
    readonly intlTagOf: (locale: Locales[number]) => string
}

/**
 * Describes the languages of an app once: the typed routing next-intl reads, the locale narrowing and the Intl tags.
 * The result is client-safe (it imports no server module), so the app's `modules/i18n` exports it to the proxy, the layout and
 * client components alike.
 */
export const defineI18n = <const Locales extends readonly [string, ...string[]], const Prefix extends LocalePrefix = "as-needed">(
    options: I18nOptions<Locales, Prefix>,
): I18n<Locales, Prefix> => {
    const localePrefix = options.localePrefix ?? ("as-needed" as Prefix)
    const cookie = options.localeCookie
    const localeCookieName = cookie?.name ?? DEFAULT_LOCALE_COOKIE
    const isLocale = (value: unknown): value is Locales[number] => typeof value === "string" && options.locales.includes(value)
    const routing = defineRouting({
        locales: options.locales,
        defaultLocale: options.defaultLocale,
        localePrefix,
        ...(cookie === undefined
            ? {}
            : { localeCookie: { name: cookie.name, path: "/", ...(cookie.maxAge === undefined ? {} : { maxAge: cookie.maxAge }), sameSite: cookie.sameSite ?? "lax" } }),
    })
    return {
        locales: options.locales,
        defaultLocale: options.defaultLocale,
        timeZone: options.timeZone,
        localePrefix,
        localeCookieName,
        routing,
        isLocale,
        localeOf: (value) => (isLocale(value) ? value : options.defaultLocale),
        intlTagOf: (locale) => options.intlTags?.[locale] ?? locale,
    }
}
