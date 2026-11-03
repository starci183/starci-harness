import { defineConfigurableModule } from "@starci/nest-kit"
import type { @@Feature@@GraphqlOptions } from "./@@feature@@-graphql.options"

/** The configurable-module base of the @@feature@@-graphql module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineConfigurableModule<@@Feature@@GraphqlOptions>()
