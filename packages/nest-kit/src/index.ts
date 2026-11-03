import { ConfigurableModuleBuilder } from "@nestjs/common"
import type { ConfigurableModuleHost } from "@nestjs/common"

/** The extras a capability registration takes beside its options: global visibility, which the app root decides. */
export interface CapabilityExtras {
    readonly isGlobal: boolean
}

/** What a plain module definition exports: the module base class, the options token and the options types of `register` and `registerAsync`. */
export type ModuleDefinition<Options> = ConfigurableModuleHost<Options, "register", "create">

/** What a capability's representative module definition exports: a plain definition whose registrations also take `isGlobal`. */
export type CapabilityModuleDefinition<Options> = ConfigurableModuleHost<Options, "register", "create", { isGlobal: boolean }>

/** The settings of a capability definition: the token its options are provided under, when the capability names it instead of taking the generated one. */
export interface CapabilitySettings {
    readonly optionsInjectionToken?: string | symbol
}

/**
 * The module definition of a sub-module, a feature, a transport or a cli group: `register` and `registerAsync`, never global.
 * Write it as the one export of `<x>.module-definition.ts`:
 * `export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = defineConfigurableModule<XOptions>()`.
 * The result type is written here, so the definition states its surface without a line of its own.
 */
export const defineConfigurableModule = <Options>(): ModuleDefinition<Options> => new ConfigurableModuleBuilder<Options>().setClassMethodName("register").build()

/**
 * The module definition of a capability's representative module: `register` and `registerAsync` with the `isGlobal` extra defaulting to
 * `false`, so globality stays a decision of the app root. `settings.optionsInjectionToken` names the token the options are provided under.
 */
export const defineCapabilityModule = <Options>(settings: CapabilitySettings = {}): CapabilityModuleDefinition<Options> =>
    new ConfigurableModuleBuilder<Options>(settings)
        .setClassMethodName("register")
        .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
        .build()
