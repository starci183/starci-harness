import { defineCapabilityModule } from "@starci/nest-kit"
import type { EventBusOptions } from "./event-bus.options"

/** The configurable-module class the module extends. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineCapabilityModule<EventBusOptions>()
