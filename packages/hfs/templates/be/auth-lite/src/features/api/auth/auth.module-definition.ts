import { defineConfigurableModule } from "@starci/nest-kit"
import type { AuthApiOptions } from "./auth.options"

/** The configurable-module base of the auth feature module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<AuthApiOptions>()
