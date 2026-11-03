import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Saga@@MessageOptions } from "./@@saga@@-message.options"

/** The configurable-module base of the @@saga@@-message module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Saga@@MessageOptions>()
