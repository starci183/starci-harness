import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import { ERRORS_OPTIONS } from "./errors.decorators"
import type { ErrorsOptions } from "./errors.options"

const built = new ConfigurableModuleBuilder<ErrorsOptions>({ optionsInjectionToken: ERRORS_OPTIONS })
        .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
        .build()
type Host = ConfigurableModuleHost<ErrorsOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the errors capability; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the registered options. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
