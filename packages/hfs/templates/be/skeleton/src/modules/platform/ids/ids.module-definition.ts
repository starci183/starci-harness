import { defineCapabilityModule } from "@starci/nest-kit"
import type { IdsOptions } from "./ids.options"

/** The configurable-module base of the ids capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<IdsOptions>()
