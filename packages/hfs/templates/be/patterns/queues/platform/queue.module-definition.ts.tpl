import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import { QUEUE_OPTIONS } from "./queue.decorators"
import type { QueueRegistrationOptions } from "./queue.options"

const built = new ConfigurableModuleBuilder<QueueRegistrationOptions>({
    optionsInjectionToken: QUEUE_OPTIONS,
})
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<QueueRegistrationOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the queues; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
