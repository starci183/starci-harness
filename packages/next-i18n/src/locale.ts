/** The header the next-intl middleware sets on the request with the locale it negotiated. */
export const LOCALE_HEADER = "x-next-intl-locale"

/** Where a request's locale can be read from, tried in this order until one names a served locale. */
export interface LocaleReaders {
    /** The `[locale]` route param, when the app reads it (Next root params). */
    readonly route?: (() => Promise<unknown>) | undefined
    /** The value of a request header. */
    readonly header: (name: string) => Promise<string | null | undefined>
    /** The value of a cookie. */
    readonly cookie: (name: string) => Promise<string | undefined>
}

/** The part of an app's languages a locale read needs. */
export interface LocaleSource<Locale extends string> {
    readonly localeCookieName: string
    readonly isLocale: (value: unknown) => value is Locale
    readonly localeOf: (value: unknown) => Locale
}

/**
 * The locale of one request: the route's own, else the one the proxy negotiated, else the reader's cookie (a route the proxy does
 * not negotiate, such as an API handler), else the default. Each source is read only when the ones before it named none, so a
 * route that states its locale never reads a header and stays static.
 */
export const readRequestLocale = async <Locale extends string>(source: LocaleSource<Locale>, readers: LocaleReaders): Promise<Locale> => {
    const fromRoute = await readers.route?.()
    if (source.isLocale(fromRoute)) return fromRoute
    const fromHeader = await readers.header(LOCALE_HEADER)
    if (source.isLocale(fromHeader)) return fromHeader
    return source.localeOf(await readers.cookie(source.localeCookieName))
}
