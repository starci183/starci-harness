import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import { EVENT_BUS_OPTIONS } from "./event-bus.decorators"
import type { EventBusOptions } from "./event-bus.options"

const built = new ConfigurableModuleBuilder<EventBusOptions>({
    optionsInjectionToken: EVENT_BUS_OPTIONS,
})
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<EventBusOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the event bus; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
