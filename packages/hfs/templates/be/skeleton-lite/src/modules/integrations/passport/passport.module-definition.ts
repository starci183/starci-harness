import { defineCapabilityModule } from "@starci/nest-kit"
import type { InjectionToken } from "@nestjs/common"
import type { PassportOptions } from "./passport.options"

/** The options a registration takes: the typed settings and the provider token of the app's sign-in decisions. */
export interface PassportRegistration extends PassportOptions {
    /** The provider token of the app's sign-in decisions (its password and Google checks). */
    readonly authenticator: InjectionToken
}

/** The configurable-module base of the passport integration; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<PassportRegistration>()
