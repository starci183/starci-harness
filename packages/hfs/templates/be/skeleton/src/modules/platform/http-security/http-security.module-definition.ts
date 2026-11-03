import { defineCapabilityModule } from "@starci/nest-kit"
import { HTTP_SECURITY_OPTIONS } from "./http-security.decorators"
import type { HttpSecurityOptions } from "./http-security.options"

/** The configurable-module base of the http-security capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    defineCapabilityModule<HttpSecurityOptions>({
        optionsInjectionToken: HTTP_SECURITY_OPTIONS,
    })
