import { defineConfigurableModule } from "@starci/nest-kit"
import type { {{Name}}ApiOptions } from "./{{name}}.options"

/** The configurable-module base of the {{name}} module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<{{Name}}ApiOptions>()
