import { defineCapabilityModule } from "@starci/nest-kit"
import type { InboxOptions } from "./inbox.options"

/** The configurable-module class the module extends. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<InboxOptions>()
