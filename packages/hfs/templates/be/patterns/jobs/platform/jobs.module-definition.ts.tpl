import { defineCapabilityModule } from "@starci/nest-kit"
import { JOBS_OPTIONS } from "./jobs.decorators"
import type { JobsOptions } from "./jobs.options"

/** The configurable-module base of the jobs; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<JobsOptions>({
    optionsInjectionToken: JOBS_OPTIONS,
})
