import { defineCapabilityModule } from "@starci/nest-kit"
import type { SeedOptions } from "./seed.options"

/** The configurable-module base of the data standard glue; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<SeedOptions>()
