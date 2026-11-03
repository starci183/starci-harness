import { ConfigurableModuleBuilder, Module } from "@nestjs/common"
import type { DynamicModule, InjectionToken, Provider } from "@nestjs/common"
import { AuthDoors } from "./doors.ts"
import { RefreshCookie } from "./cookie.ts"
import { AuthFlows } from "./flows.ts"
import { GoogleStateClient } from "./google-state.ts"
import type { AuthOptions } from "./options.ts"
import { AuthPasswords } from "./passwords.ts"
import type { AuthAuthenticator } from "./ports.ts"
import { randomIds, systemClock } from "./runtime.ts"
import { AuthSessions } from "./sessions.ts"
import { PassportGoogleStrategy, PassportLocalStrategy } from "./strategies.ts"
import { AuthTokens } from "./tokens.ts"
import { AuthPrincipalVerifier } from "./verifier.ts"
import { SignInBudget } from "./budget.ts"
import {
    AUTH_AUTHENTICATOR,
    AUTH_DOORS_SERVICE,
    AUTH_FLOWS,
    AUTH_GOOGLE_STATE,
    AUTH_GOOGLE_STRATEGY,
    AUTH_LOCAL_STRATEGY,
    AUTH_PASSWORDS,
    AUTH_PRINCIPAL_VERIFIER,
    AUTH_REFRESH_COOKIE,
    AUTH_SESSIONS,
    AUTH_SIGN_IN_BUDGET,
    AUTH_TOKENS,
} from "./auth.tokens.ts"

/** The extras every registration sets beside the options. */
export interface AuthModuleExtras {
    /** Whether the module is global. */
    readonly isGlobal: boolean
    /**
     * The provider token of the app's `AuthAuthenticator` (its password and Google decisions). The app's authenticator uses
     * `AuthPasswords` and `SignInBudget` of this module, so it is resolved by token here, never passed as a built instance.
     */
    readonly authenticator: InjectionToken | undefined
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<AuthOptions>({ moduleName: "Auth" })
    .setClassMethodName("register")
    .setFactoryMethodName("createAuthOptions")
    .setExtras<AuthModuleExtras>({ isGlobal: false, authenticator: undefined }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()

/** What `AuthModule.register` takes: the options, plus `isGlobal` and the `authenticator` token. */
export type AuthRegisterOptions = typeof OPTIONS_TYPE

/** What `AuthModule.registerAsync` takes: `imports`, `inject` and one of `useFactory`, `useClass`, `useExisting`, plus `isGlobal` and the `authenticator` token. */
export type AuthRegisterAsyncOptions = typeof ASYNC_OPTIONS_TYPE

/** The token a registration without an authenticator resolves to: no provider answers it, so the boot fails loudly. */
const AUTH_AUTHENTICATOR_MISSING = Symbol.for("@starci/auth/authenticator-missing")

const providers = (authenticator: InjectionToken | undefined): Provider[] => [
    { provide: AUTH_AUTHENTICATOR, useExisting: authenticator ?? AUTH_AUTHENTICATOR_MISSING },
    { provide: AUTH_TOKENS, inject: [MODULE_OPTIONS_TOKEN], useFactory: (options: AuthOptions): AuthTokens => new AuthTokens(options) },
    { provide: AUTH_PASSWORDS, inject: [MODULE_OPTIONS_TOKEN], useFactory: (options: AuthOptions): AuthPasswords => new AuthPasswords(options) },
    {
        provide: AUTH_SIGN_IN_BUDGET,
        inject: [MODULE_OPTIONS_TOKEN],
        useFactory: (options: AuthOptions): SignInBudget => new SignInBudget(options.budget, options.rate),
    },
    {
        provide: AUTH_SESSIONS,
        inject: [MODULE_OPTIONS_TOKEN, AUTH_TOKENS],
        useFactory: (options: AuthOptions, tokens: AuthTokens): AuthSessions =>
            new AuthSessions({ options, tokens, clock: options.clock ?? systemClock, ids: options.ids ?? randomIds, logger: options.logger }),
    },
    { provide: AUTH_REFRESH_COOKIE, inject: [MODULE_OPTIONS_TOKEN], useFactory: (options: AuthOptions): RefreshCookie => new RefreshCookie(options.cookie) },
    {
        provide: AUTH_GOOGLE_STATE,
        inject: [MODULE_OPTIONS_TOKEN, AUTH_TOKENS],
        useFactory: (options: AuthOptions, tokens: AuthTokens): GoogleStateClient =>
            new GoogleStateClient({ tokens, clock: options.clock ?? systemClock, ids: options.ids ?? randomIds, options }),
    },
    { provide: AUTH_FLOWS, inject: [MODULE_OPTIONS_TOKEN], useFactory: (options: AuthOptions): AuthFlows => new AuthFlows(options) },
    {
        provide: AUTH_LOCAL_STRATEGY,
        inject: [AUTH_AUTHENTICATOR],
        useFactory: (authenticator: AuthAuthenticator): PassportLocalStrategy => new PassportLocalStrategy(authenticator),
    },
    {
        provide: AUTH_GOOGLE_STRATEGY,
        inject: [MODULE_OPTIONS_TOKEN, AUTH_AUTHENTICATOR, AUTH_GOOGLE_STATE],
        useFactory: (options: AuthOptions, authenticator: AuthAuthenticator, state: GoogleStateClient): PassportGoogleStrategy | null =>
            options.google === null ? null : new PassportGoogleStrategy(options.google, authenticator, state),
    },
    {
        provide: AUTH_DOORS_SERVICE,
        inject: [MODULE_OPTIONS_TOKEN, AUTH_FLOWS, AUTH_SESSIONS, AUTH_REFRESH_COOKIE],
        useFactory: (options: AuthOptions, flows: AuthFlows, sessions: AuthSessions, cookie: RefreshCookie): AuthDoors =>
            new AuthDoors({ flows, sessions, cookie, returnOrigin: options.returnOrigin, logger: options.logger }),
    },
    {
        provide: AUTH_PRINCIPAL_VERIFIER,
        inject: [MODULE_OPTIONS_TOKEN, AUTH_TOKENS],
        useFactory: (options: AuthOptions, tokens: AuthTokens): AuthPrincipalVerifier =>
            new AuthPrincipalVerifier(tokens, options.clock ?? systemClock),
    },
]

const EXPORTED = [AUTH_TOKENS, AUTH_PASSWORDS, AUTH_SIGN_IN_BUDGET, AUTH_SESSIONS, AUTH_REFRESH_COOKIE, AUTH_FLOWS, AUTH_DOORS_SERVICE, AUTH_PRINCIPAL_VERIFIER]

const withProviders = (base: DynamicModule, authenticator: InjectionToken | undefined): DynamicModule => ({
    ...base,
    providers: [...(base.providers ?? []), ...providers(authenticator)],
    exports: [...(base.exports ?? []), ...EXPORTED],
})

/**
 * The sign-in of a lite app as one Nest capability: the token signer and verifier, the passwords, the sign-in budget, the
 * rotating sessions, the refresh cookie, the passport flows (local and Google with state and PKCE) and the doors that run them.
 * Registered once at the api root; the app implements the stores (`SessionStore`, `AccountDirectory`, `RateCounter`) and the
 * `AuthAuthenticator` over its own tables.
 */
export class AuthModule extends ConfigurableModuleClass {
    /** Registers the module from options known now. */
    static override register(options: AuthRegisterOptions): DynamicModule {
        return withProviders(super.register(options), options.authenticator)
    }

    /** Registers the module from options a factory, class or existing provider supplies. */
    static override registerAsync(options: AuthRegisterAsyncOptions): DynamicModule {
        return withProviders(super.registerAsync(options), options.authenticator)
    }
}

Module({})(AuthModule)
