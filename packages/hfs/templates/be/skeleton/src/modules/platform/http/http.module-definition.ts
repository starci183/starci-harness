import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import { HTTP_OPTIONS } from "./http.decorators"
import type { HttpOptions } from "./http.options"

const built = new ConfigurableModuleBuilder<HttpOptions>({ optionsInjectionToken: HTTP_OPTIONS })
        .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
        .build()
type Host = ConfigurableModuleHost<HttpOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the http capability; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
