import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { CqrsOptions } from "./cqrs.options"

const built = new ConfigurableModuleBuilder<CqrsOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<CqrsOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the cqrs capability; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
