import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Reactor@@Options } from "./@@reactor@@.options"

/** The configurable-module base of the @@reactor@@ module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<@@Reactor@@Options>()
