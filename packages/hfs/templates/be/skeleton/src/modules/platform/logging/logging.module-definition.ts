import { defineCapabilityModule } from "@starci/nest-kit"
import type { LoggingOptions } from "./logging.options"

/** The configurable-module base of the logging capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<LoggingOptions>()
