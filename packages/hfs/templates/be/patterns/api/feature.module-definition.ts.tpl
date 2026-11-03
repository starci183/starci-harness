import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Feature@@ApiOptions } from "./@@feature@@.options"

/** The configurable-module base of the @@feature@@ module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Feature@@ApiOptions>()
