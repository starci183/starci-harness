import { Module } from "@nestjs/common"
import type { DynamicModule, Provider } from "@nestjs/common"
import { PASSPORT_ACCOUNTS, PASSPORT_AUTHENTICATOR, PASSPORT_RATE_COUNTER, PASSPORT_SESSION_STORE } from "@modules/integrations/passport"
import { IdentityAccountDirectoryAdapter } from "./account-directory.adapter"
import { AuthGuard } from "./auth.guard"
import { IdentityAuthenticatorService } from "./authenticator.service"
import { CredentialGuard } from "./credential.guard"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { ACCESS_TOKEN_VERIFIER, CREDENTIAL_AUTHENTICATOR } from "./identity.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./identity.module-definition"
import { IdentityRateCounterAdapter } from "./rate-counter.adapter"
import { IdentitySessionStoreAdapter } from "./session-store.adapter"
import { IdentitySignInService } from "./sign-in.service"

const refusingAuthenticator: Provider = {
    provide: CREDENTIAL_AUTHENTICATOR,
    useValue: {
        authenticate: () => Promise.reject(new IdentityError({ code: IdentityErrorCode.Unauthenticated })),
    },
}

@Module({})
/** The identity capability: the app registers its credential and default-deny guards after the throttler and origin guard. */
export class IdentityModule extends ConfigurableModuleClass {
    /** Registers identity once per app with the verifier parsed at the composition root. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        const authenticator: Provider =
            options.credentialAuthenticator === undefined
                ? refusingAuthenticator
                : { provide: CREDENTIAL_AUTHENTICATOR, useClass: options.credentialAuthenticator }
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                {
                    provide: ACCESS_TOKEN_VERIFIER,
                    useValue: options.verifyAccessToken,
                },
                authenticator,
                CredentialGuard,
                AuthGuard,
                IdentitySessionStoreAdapter,
                IdentityAccountDirectoryAdapter,
                IdentityRateCounterAdapter,
                IdentityAuthenticatorService,
                IdentitySignInService,
                { provide: PASSPORT_SESSION_STORE, useExisting: IdentitySessionStoreAdapter },
                { provide: PASSPORT_ACCOUNTS, useExisting: IdentityAccountDirectoryAdapter },
                { provide: PASSPORT_RATE_COUNTER, useExisting: IdentityRateCounterAdapter },
                { provide: PASSPORT_AUTHENTICATOR, useExisting: IdentityAuthenticatorService },
            ],
            exports: [
                CredentialGuard,
                CREDENTIAL_AUTHENTICATOR,
                AuthGuard,
                ACCESS_TOKEN_VERIFIER,
                IdentitySignInService,
                PASSPORT_SESSION_STORE,
                PASSPORT_ACCOUNTS,
                PASSPORT_RATE_COUNTER,
                PASSPORT_AUTHENTICATOR,
            ],
        }
    }
}
