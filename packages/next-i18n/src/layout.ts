import "server-only"
import type { AbstractIntlMessages } from "next-intl"
import { getMessages } from "next-intl/server"
import { notFound } from "next/navigation.js"
import type { I18n, LocalePrefix } from "./config.ts"

/** The language the address states, its catalog and the product time zone: what a `[locale]` layout resolves before it mounts the shell. */
export interface LocaleSegment<Locale extends string> {
    readonly locale: Locale
    readonly messages: AbstractIntlMessages
    readonly timeZone: string
}

/** The route params of a `[locale]` layout. */
export type LocaleParams = Promise<{ readonly locale: string }>

/** The reader a `[locale]` layout calls with its `params`. */
export type ReadLocaleSegment<Locale extends string> = (params: LocaleParams) => Promise<LocaleSegment<Locale>>

/**
 * The `readLocaleSegment` of an app: an unknown segment is a route that does not exist, not a request to fall back silently.
 */
export const createReadLocaleSegment = <const Locales extends readonly [string, ...string[]], const Prefix extends LocalePrefix>(
    i18n: I18n<Locales, Prefix>,
): ReadLocaleSegment<Locales[number]> =>
    async (params) => {
        const { locale } = await params
        if (!i18n.isLocale(locale)) notFound()
        return { locale, messages: await getMessages({ locale }), timeZone: i18n.timeZone }
    }
