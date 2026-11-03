import { landingI18n } from "./index"
import type { AppI18n } from "@{{project}}/i18n"

/** The request config next-intl's plugin loads (next.config.ts): the product stack over the landing's catalogs. */
const requestConfig: AppI18n["requestConfig"] = landingI18n.requestConfig

export default requestConfig
