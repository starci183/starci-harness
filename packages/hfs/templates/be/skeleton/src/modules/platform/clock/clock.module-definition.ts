import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { ClockOptions } from "./clock.options"

const built = new ConfigurableModuleBuilder<ClockOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<ClockOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the clock capability; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
