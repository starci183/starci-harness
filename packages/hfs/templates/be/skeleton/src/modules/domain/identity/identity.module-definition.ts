import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { IdentityOptions } from "./identity.options"

const built = new ConfigurableModuleBuilder<IdentityOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<IdentityOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the identity capability; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
