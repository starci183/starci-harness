import { defineConfigurableModule } from "@starci/nest-kit"
import type { MigrateOptions } from "./migrate.options"

/** The configurable-module base of the migrate module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<MigrateOptions>()
