import { ConfigurableModuleBuilder, type ConfigurableModuleHost } from "@nestjs/common"
import { JOBS_OPTIONS } from "./jobs.decorators"
import type { JobsOptions } from "./jobs.options"

const built = new ConfigurableModuleBuilder<JobsOptions>({
    optionsInjectionToken: JOBS_OPTIONS,
})
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
type Host = ConfigurableModuleHost<JobsOptions, "register", "create", { isGlobal: boolean }>

/** The configurable-module base of the jobs; `isGlobal` is decided by the app root. */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The options of a synchronous registration, for the register signature. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
