import { defineConfigurableModule } from "@starci/nest-kit"
import type { SeedOptions } from "./seed.options"

/** The configurable-module base of the seed module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<SeedOptions>()
