import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Group@@Options } from "./@@group@@.options"

/** The configurable-module base of the @@group@@ module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<@@Group@@Options>()
