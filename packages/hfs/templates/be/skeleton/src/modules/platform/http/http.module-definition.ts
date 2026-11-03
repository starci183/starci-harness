import { defineCapabilityModule } from "@starci/nest-kit"
import { HTTP_OPTIONS } from "./http.decorators"
import type { HttpOptions } from "./http.options"

/** The configurable-module base of the http capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<HttpOptions>({
    optionsInjectionToken: HTTP_OPTIONS,
})
