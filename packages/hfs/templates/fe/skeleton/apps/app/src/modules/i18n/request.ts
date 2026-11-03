import { appI18n } from "./index"
import type { AppI18n } from "@{{project}}/i18n"

/** The request config next-intl's plugin loads (next.config.ts): the product stack over this app's catalogs. */
const requestConfig: AppI18n["requestConfig"] = appI18n.requestConfig

export default requestConfig
