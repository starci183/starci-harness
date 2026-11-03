import { createNavigation } from "next-intl/navigation"
import type { I18n, LocalePrefix } from "./config.ts"

/** The locale-aware `Link`, `redirect`, `usePathname`, `useRouter` and `getPathname` of an app's routing. */
export type I18nNavigation<Locales extends readonly [string, ...string[]], Prefix extends LocalePrefix> = ReturnType<typeof createNavigation<Locales, Prefix>>

/**
 * The navigation helpers of the app's routing. They live apart from the proxy entry: next-intl's navigation selects React runtime
 * exports that the proxy does not have, so the proxy must never evaluate this module.
 */
export const createI18nNavigation = <const Locales extends readonly [string, ...string[]], const Prefix extends LocalePrefix>(
    i18n: I18n<Locales, Prefix>,
): I18nNavigation<Locales, Prefix> => createNavigation<Locales, Prefix>(i18n.routing)
