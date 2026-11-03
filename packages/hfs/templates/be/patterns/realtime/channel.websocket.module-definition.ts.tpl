import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { @@Channel@@WebsocketOptions } from "./@@channel@@-websocket.options"

const built = new ConfigurableModuleBuilder<@@Channel@@WebsocketOptions>().setClassMethodName("register").build()
type Host = ConfigurableModuleHost<@@Channel@@WebsocketOptions, "register", "create", {}>

/** The configurable-module base of the @@channel@@-websocket module. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
