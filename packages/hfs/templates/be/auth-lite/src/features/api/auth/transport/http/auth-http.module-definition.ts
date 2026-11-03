// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { AuthHttpOptions } from "./auth-http.options"

const built = new ConfigurableModuleBuilder<AuthHttpOptions>().setClassMethodName("register").build()
type Host = ConfigurableModuleHost<AuthHttpOptions, "register", "create", {}>

/** The configurable-module base of the auth-http module. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
