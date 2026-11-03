import { defineConfigurableModule } from "@starci/nest-kit"
import type { CliOptions } from "./cli.options"

/** The configurable-module base of the cli module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<CliOptions>()
