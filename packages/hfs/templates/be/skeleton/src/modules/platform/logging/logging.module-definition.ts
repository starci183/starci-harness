import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { LoggingOptions } from "./logging.options"

const built = new ConfigurableModuleBuilder<LoggingOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<LoggingOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the logging capability; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
