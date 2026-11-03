import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import type { {{Name}}Options } from "./{{name}}.options"

const built = new ConfigurableModuleBuilder<{{Name}}Options>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<{{Name}}Options, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the {{name}} capability. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
