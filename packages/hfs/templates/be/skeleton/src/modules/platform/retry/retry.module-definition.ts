import { defineCapabilityModule } from "@starci/nest-kit"
import type { RetryOptions } from "./retry.options"

/** The configurable-module base of the retry capability; the app root decides its global scope. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<RetryOptions>()
