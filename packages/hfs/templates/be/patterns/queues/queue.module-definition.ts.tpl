import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Queue@@Options } from "./@@queue@@.options"

/** The configurable-module base of the @@queue@@ module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<@@Queue@@Options>()
