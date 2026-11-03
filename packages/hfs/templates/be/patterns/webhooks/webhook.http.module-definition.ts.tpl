import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Provider@@HttpOptions } from "./@@provider@@-http.options"

/** The configurable-module base of the @@provider@@-http module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Provider@@HttpOptions>()
