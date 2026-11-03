import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Reactor@@MessageOptions } from "./@@reactor@@-message.options"

/** The configurable-module base of the @@reactor@@-message module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Reactor@@MessageOptions>()
