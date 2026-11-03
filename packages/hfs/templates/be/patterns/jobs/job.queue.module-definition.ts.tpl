import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Job@@QueueOptions } from "./@@job@@-queue.options"

/** The configurable-module base of the @@job@@-queue module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Job@@QueueOptions>()
