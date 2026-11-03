import { defineCapabilityModule } from "@starci/nest-kit"
import type { CqrsOptions } from "./cqrs.options"

/** The configurable-module base of the cqrs capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<CqrsOptions>()
