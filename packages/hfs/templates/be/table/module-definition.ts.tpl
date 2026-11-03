import { defineCapabilityModule } from "@starci/nest-kit"
import type { {{Name}}Options } from "./{{name}}.options"

/** The configurable-module base of the {{name}} capability. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<{{Name}}Options>()
