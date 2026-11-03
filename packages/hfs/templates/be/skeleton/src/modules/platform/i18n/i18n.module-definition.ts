import { defineCapabilityModule } from "@starci/nest-kit"
import { I18N_OPTIONS } from "./i18n.decorators"
import type { I18nOptions } from "./i18n.options"

/** The configurable-module base of the i18n capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineCapabilityModule<I18nOptions>({
    optionsInjectionToken: I18N_OPTIONS,
})
