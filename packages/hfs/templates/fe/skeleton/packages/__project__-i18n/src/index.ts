import "server-only"
import { createReadLocaleSegment, type ReadLocaleSegment } from "@starci/next-i18n/layout"
import { createI18nNavigation, type I18nNavigation } from "@starci/next-i18n/navigation"
import { createRequestConfig, type I18nRequestConfig } from "@starci/next-i18n/request"
import type { LoadCatalog } from "@starci/next-i18n"
import { locale as routeLocale } from "next/root-params"
import { i18n, type ProductI18n } from "./routing"

/** The locales the product serves, as the catalog loader of an app receives them. */
type ProductLocale = ProductI18n["locales"][number]

/** What one app of the product reads of its next-intl stack. */
export interface AppI18n {
    readonly navigation: I18nNavigation<ProductI18n["locales"], ProductI18n["localePrefix"]>
    readonly requestConfig: I18nRequestConfig
    readonly readLocaleSegment: ReadLocaleSegment<ProductLocale>
}

/** `next/root-params` is typed only after Next generates its types, so the reader is checked before it is called. */
const isLocaleReader = (value: unknown): value is () => Promise<unknown> => typeof value === "function"

/**
 * The `[locale]` route param, read through `next/root-params` (`experimental.rootParams` in the app's next.config.ts), never the
 * deprecated `requestLocale`. `next/root-params` is importable only where Next bundles it, which is why this workspace package, not
 * `@starci/next-i18n`, reads it.
 */
const readRouteLocale = async (): Promise<unknown> => (isLocaleReader(routeLocale) ? routeLocale() : undefined)

/**
 * What one app of the product calls from its `modules/i18n` (R59): the locale-aware navigation, the request config next-intl's
 * plugin loads (the app's `modules/i18n/request.ts` default-exports it) and what the app's `[locale]` layout resolves before it
 * mounts the shell, all built by `@starci/next-i18n` over the product's one description of its languages. `app` names the app in the
 * text of a message its catalog lacks (`<app>:<namespace>.<key>`); `loadMessages` loads its own catalogs. A server module: a client
 * component reads the default locale from `./routing`.
 */
export const createAppI18n = (app: string, loadMessages: LoadCatalog<ProductLocale>): AppI18n => ({
    navigation: createI18nNavigation(i18n),
    requestConfig: createRequestConfig(i18n, { app, loadMessages, readRouteLocale }),
    readLocaleSegment: createReadLocaleSegment(i18n),
})
