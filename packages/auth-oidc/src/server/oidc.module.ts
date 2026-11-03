import { ConfigurableModuleBuilder, Module } from "@nestjs/common"
import type { ConfigurableModuleHost, DynamicModule, Provider } from "@nestjs/common"
import type { OidcClient } from "./client.ts"
import type { OidcDiscovery } from "./discovery.ts"
import type { OidcKeys } from "./jwks.ts"
import { createOidc } from "./oidc.ts"
import type { Oidc } from "./oidc.ts"
import { OIDC_CLIENT, OIDC_DISCOVERY, OIDC_KEYS, OIDC_PRINCIPAL_VERIFIER, OIDC_REGISTRATION, OIDC_TOKEN_VERIFIER } from "./oidc.tokens.ts"
import type { OidcOptions } from "./options.ts"
import type { OidcTokenVerifier } from "./tokens.ts"
import type { OidcPrincipalVerifier } from "./verifier.ts"

/** The extras every registration sets beside the options. */
export interface OidcModuleExtras {
    /** Whether the module is global. */
    readonly isGlobal: boolean
}

const built = new ConfigurableModuleBuilder<OidcOptions>({ moduleName: "Oidc" })
    .setClassMethodName("register")
    .setFactoryMethodName("createOidcOptions")
    .setExtras<OidcModuleExtras>({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()

type Host = ConfigurableModuleHost<OidcOptions, "register", "createOidcOptions", OidcModuleExtras>

/** The generated base class of the module (its `register` and `registerAsync`). */
export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass
/** The injection token of the options the registration supplied. */
export const MODULE_OPTIONS_TOKEN: Host["MODULE_OPTIONS_TOKEN"] = built.MODULE_OPTIONS_TOKEN
/** Carries the type of the synchronous registration. */
export const OPTIONS_TYPE: Host["OPTIONS_TYPE"] = built.OPTIONS_TYPE
/** Carries the type of the asynchronous registration. */
export const ASYNC_OPTIONS_TYPE: Host["ASYNC_OPTIONS_TYPE"] = built.ASYNC_OPTIONS_TYPE

/** What `OidcModule.register` takes: the options, plus `isGlobal`. */
export type OidcRegisterOptions = typeof OPTIONS_TYPE

/** What `OidcModule.registerAsync` takes: `imports`, `inject` and one of `useFactory`, `useClass`, `useExisting`, plus `isGlobal`. */
export type OidcRegisterAsyncOptions = typeof ASYNC_OPTIONS_TYPE

const providers: Provider[] = [
    { provide: OIDC_REGISTRATION, inject: [MODULE_OPTIONS_TOKEN], useFactory: (options: OidcOptions): Oidc => createOidc(options) },
    { provide: OIDC_DISCOVERY, inject: [OIDC_REGISTRATION], useFactory: (oidc: Oidc): OidcDiscovery => oidc.discovery },
    { provide: OIDC_KEYS, inject: [OIDC_REGISTRATION], useFactory: (oidc: Oidc): OidcKeys => oidc.keys },
    { provide: OIDC_TOKEN_VERIFIER, inject: [OIDC_REGISTRATION], useFactory: (oidc: Oidc): OidcTokenVerifier => oidc.tokens },
    { provide: OIDC_CLIENT, inject: [OIDC_REGISTRATION], useFactory: (oidc: Oidc): OidcClient | null => oidc.client },
    { provide: OIDC_PRINCIPAL_VERIFIER, inject: [OIDC_REGISTRATION], useFactory: (oidc: Oidc): OidcPrincipalVerifier => oidc.verifier },
]

const EXPORTED = [OIDC_DISCOVERY, OIDC_KEYS, OIDC_TOKEN_VERIFIER, OIDC_CLIENT, OIDC_PRINCIPAL_VERIFIER]

const withProviders = (base: DynamicModule): DynamicModule => ({
    ...base,
    providers: [...(base.providers ?? []), ...providers],
    exports: [...(base.exports ?? []), ...EXPORTED],
})

/**
 * The OIDC client of a full app as one Nest capability: the discovery document, the provider's signing keys, the token verifier, the
 * `PrincipalVerifier` guards inject and, when the registration declares a client, the authorization code flow. Registered once at the api
 * root; the app parses its settings (the package reads no environment) and passes them as typed options. A registration whose options do
 * not meet the contract fails the boot with a `ConfigurationInvalid` error.
 */
export class OidcModule extends ConfigurableModuleClass {
    /** Registers the module from options known now. */
    static override register(options: OidcRegisterOptions): DynamicModule {
        return withProviders(super.register(options))
    }

    /** Registers the module from options a factory, class or existing provider supplies. */
    static override registerAsync(options: OidcRegisterAsyncOptions): DynamicModule {
        return withProviders(super.registerAsync(options))
    }
}

Module({})(OidcModule)
