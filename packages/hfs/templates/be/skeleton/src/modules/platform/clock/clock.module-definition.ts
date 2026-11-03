import { defineCapabilityModule } from "@starci/nest-kit"
import type { ClockOptions } from "./clock.options"

/** The configurable-module base of the clock capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<ClockOptions>()
