import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { EventBusOptions } from "./event-bus.options"

const built = new ConfigurableModuleBuilder<EventBusOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<EventBusOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module class the module extends. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
