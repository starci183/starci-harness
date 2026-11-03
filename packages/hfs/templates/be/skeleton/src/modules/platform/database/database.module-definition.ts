import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import { DATABASE_OPTIONS } from "./database.port"
import type { DatabaseOptions } from "./database.options"

const built = new ConfigurableModuleBuilder<DatabaseOptions>({
    optionsInjectionToken: DATABASE_OPTIONS,
})
    .setExtras({ isGlobal: false }, (definition, extras) => ({
        ...definition,
        global: extras.isGlobal,
    }))
    .build()
type Host = ConfigurableModuleHost<DatabaseOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the database capability; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
