import { defineConfigurableModule } from "@starci/nest-kit"
import type { SystemHealthHttpOptions } from "./system-health-http.options"

/** The configurable-module base of the system-health-http module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<SystemHealthHttpOptions>()
