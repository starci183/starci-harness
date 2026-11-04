import { AuthModule } from "@starci/auth/server"
import type { AccountDirectory, RateCounter, SessionStore } from "@starci/auth/server"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { CLOCK } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { IDS } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { PASSPORT_ACCOUNTS, PASSPORT_RATE_COUNTER, PASSPORT_SESSION_STORE } from "./passport.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./passport.module-definition"

@Module({})
/**
 * The sign-in package as a Nest module: the typed settings, the clock, ids and logger of the app (the package reports a replayed
 * refresh token and a failed Google sign-in through it), and the stores the identity domain provides. The package's providers (doors,
 * sessions, passwords, budget, verifier) are global exactly when this module is.
 */
export class PassportModule extends ConfigurableModuleClass {
    /** Registers the sign-in package once per app that signs people in. */
    static override register(registration: typeof OPTIONS_TYPE): DynamicModule {
        const { isGlobal, authenticator, ...options } = registration
        const base = super.register(registration)
        const auth = AuthModule.registerAsync({
            isGlobal: isGlobal ?? false,
            authenticator,
            inject: [PASSPORT_SESSION_STORE, PASSPORT_ACCOUNTS, PASSPORT_RATE_COUNTER, CLOCK, IDS, LOGGER],
            useFactory: (sessions: SessionStore, accounts: AccountDirectory, rate: RateCounter, clock: Clock, ids: Ids, logger: Logger) => ({
                ...options,
                sessions,
                accounts,
                rate,
                clock,
                ids,
                logger,
            }),
        })
        return { ...base, imports: [...(base.imports ?? []), auth], exports: [...(base.exports ?? []), auth] }
    }
}
