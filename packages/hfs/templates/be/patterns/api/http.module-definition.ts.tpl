import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Feature@@HttpOptions } from "./@@feature@@-http.options"

/** The configurable-module base of the @@feature@@-http module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Feature@@HttpOptions>()
