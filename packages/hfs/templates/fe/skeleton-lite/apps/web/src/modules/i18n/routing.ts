import { defineI18n } from "@starci/next-i18n"
import type { I18n } from "@starci/next-i18n"

const LOCALES = ["vi", "en"] as const

/** The description of the web app's languages: the locales and the `as-needed` prefix mode that `defineI18n` types. */
export type WebI18n = I18n<typeof LOCALES, "as-needed">

/** The locale served at the unprefixed path. */
export const DEFAULT_LOCALE: WebI18n["defaultLocale"] = "vi"

/**
 * The one description of the web app's languages, read by the proxy, the request config and the locale layout: vi default, a prefix
 * only when the locale is not the default, and a fixed time zone so the server and the hydrated client format the same instant the
 * same way. The stack that reads it is `@starci/next-i18n`'s (FE-I18N-1).
 */
export const i18n: WebI18n = defineI18n({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    timeZone: "Asia/Ho_Chi_Minh",
})
