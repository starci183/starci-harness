import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { @@Queue@@Options } from "./@@queue@@.options"

const built = new ConfigurableModuleBuilder<@@Queue@@Options>().setClassMethodName("register").build()
type Host = ConfigurableModuleHost<@@Queue@@Options, "register", "create", {}>

/** The configurable-module base of the @@queue@@ module. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
