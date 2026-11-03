import { defineCapabilityModule } from "@starci/nest-kit"
import type { InboxOptions } from "./inbox.options"

/** The configurable-module base of the inbox capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<InboxOptions>()
