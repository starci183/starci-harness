import { defineConfigurableModule } from "@starci/nest-kit"
import type { SystemHealthOptions } from "./system-health.options"

/** The configurable-module base of the system-health module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<SystemHealthOptions>()
