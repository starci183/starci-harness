import { defineConfigurableModule } from "@starci/nest-kit"
import type { {{Name}}GraphqlOptions } from "./{{name}}-graphql.options"

/** The configurable-module base of the {{name}}-graphql module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<{{Name}}GraphqlOptions>()
