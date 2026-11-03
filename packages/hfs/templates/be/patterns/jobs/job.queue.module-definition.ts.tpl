import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { @@Job@@QueueOptions } from "./@@job@@-queue.options"

const built = new ConfigurableModuleBuilder<@@Job@@QueueOptions>().setClassMethodName("register").build()
type Host = ConfigurableModuleHost<@@Job@@QueueOptions, "register", "create", {}>

/** The configurable-module base of the @@job@@-queue module. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
