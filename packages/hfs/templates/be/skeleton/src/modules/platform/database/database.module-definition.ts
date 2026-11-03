import { defineCapabilityModule } from "@starci/nest-kit"
import { DATABASE_OPTIONS } from "./database.port"
import type { DatabaseOptions } from "./database.options"

/** The configurable-module base of the database capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<DatabaseOptions>({
    optionsInjectionToken: DATABASE_OPTIONS,
})
