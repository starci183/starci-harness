import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { SystemHealthHttpOptions } from "./system-health-http.options"

const built = new ConfigurableModuleBuilder<SystemHealthHttpOptions>().setClassMethodName("register").build()
type Host = ConfigurableModuleHost<SystemHealthHttpOptions, "register", "create", {}>

/** The configurable-module base of the system-health-http module. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
