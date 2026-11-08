import { createRequestConfig, type I18nRequestConfig } from "@starci/next-i18n/request"
import { i18n } from "./routing"

/**
 * The request config next-intl's plugin loads: the app's own catalogs over the shared stack. The locale is the one the proxy
 * negotiated (a route the proxy does not negotiate reads the cookie, then the default); `next/root-params` can only be imported
 * inside the app directory, so no route reader is passed.
 */
const requestConfig: I18nRequestConfig = createRequestConfig(i18n, { app: "web", loadMessages: (locale) => import(`./messages/${locale}.json`) })

export default requestConfig
