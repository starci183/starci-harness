import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Channel@@SseOptions } from "./@@channel@@-sse.options"

/** The configurable-module base of the @@channel@@-sse module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Channel@@SseOptions>()
