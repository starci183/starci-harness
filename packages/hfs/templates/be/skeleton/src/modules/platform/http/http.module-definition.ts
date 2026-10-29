import { ConfigurableModuleBuilder } from "@nestjs/common"
import { HTTP_OPTIONS } from "./http.decorators"
import type { HttpOptions } from "./http.options"

/** The configurable-module base of the http capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } =
    new ConfigurableModuleBuilder<HttpOptions>({ optionsInjectionToken: HTTP_OPTIONS })
        .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
        .build()
