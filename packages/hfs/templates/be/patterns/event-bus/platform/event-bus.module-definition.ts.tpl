import { defineCapabilityModule } from "@starci/nest-kit"
import { EVENT_BUS_OPTIONS } from "./event-bus.decorators"
import type { EventBusOptions } from "./event-bus.options"

/** The configurable-module base of the event bus; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<EventBusOptions>({
    optionsInjectionToken: EVENT_BUS_OPTIONS,
})
