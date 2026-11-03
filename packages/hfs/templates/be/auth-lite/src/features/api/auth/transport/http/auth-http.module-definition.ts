import { defineConfigurableModule } from "@starci/nest-kit"
import type { AuthHttpOptions } from "./auth-http.options"

/** The configurable-module base of the auth-http module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<AuthHttpOptions>()
