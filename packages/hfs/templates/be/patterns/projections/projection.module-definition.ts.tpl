import { defineCapabilityModule } from "@starci/nest-kit"
import type { @@Name@@Options } from "./@@name@@.options"

/** The configurable-module base of the @@name@@ projection; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<@@Name@@Options>()
