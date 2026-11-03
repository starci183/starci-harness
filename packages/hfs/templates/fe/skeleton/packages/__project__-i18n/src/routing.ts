import { defineI18n } from "@starci/next-i18n"
import type { I18n } from "@starci/next-i18n"

/** The locales every app of the product serves; every catalog of an app has the same keys in each. */
const LOCALES = ["vi", "en"] as const

/** The description of the product's languages: the locales and the `as-needed` prefix mode that `defineI18n` types. */
export type ProductI18n = I18n<typeof LOCALES, "as-needed">

/** The locale served at the unprefixed path, and the language of a document no locale reached (the global error boundary). */
export const DEFAULT_LOCALE: ProductI18n["defaultLocale"] = "vi"

/**
 * The one description of the product's languages, for the proxy, the navigation and the request config of every app: vi default,
 * a prefix only when the locale is not the default, and a fixed time zone so the server and the hydrated client format the same
 * instant the same way. The stack that reads it is `@starci/next-i18n`'s; this package only states the languages (FE-I18N-1).
 */
export const i18n: ProductI18n = defineI18n({ locales: LOCALES, defaultLocale: DEFAULT_LOCALE, timeZone: "Asia/Ho_Chi_Minh" })
