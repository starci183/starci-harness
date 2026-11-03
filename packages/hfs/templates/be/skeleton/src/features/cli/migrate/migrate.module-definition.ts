import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { MigrateOptions } from "./migrate.options"

const built = new ConfigurableModuleBuilder<MigrateOptions>().setClassMethodName("register").build()
type Host = ConfigurableModuleHost<MigrateOptions, "register", "create", {}>

/** The configurable-module base of the migrate module. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
