import { defineCapabilityModule } from "@starci/nest-kit"
import { QUEUE_OPTIONS } from "./queue.decorators"
import type { QueueRegistrationOptions } from "./queue.options"

/** The configurable-module base of the queues; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<QueueRegistrationOptions>({
    optionsInjectionToken: QUEUE_OPTIONS,
})
