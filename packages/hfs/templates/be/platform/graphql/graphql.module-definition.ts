import { defineCapabilityModule } from "@starci/nest-kit"
import type { GraphqlOptions } from "./graphql.options"

/** The configurable-module base of the graphql capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<GraphqlOptions>()
