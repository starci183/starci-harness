import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { InboxOptions } from "./inbox.options"

const built = new ConfigurableModuleBuilder<InboxOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<InboxOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module class the module extends. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
