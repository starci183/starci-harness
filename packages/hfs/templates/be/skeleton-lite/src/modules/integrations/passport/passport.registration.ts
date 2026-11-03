import { AuthModule } from "@starci/auth/server"
import type { AccountDirectory, RateCounter, SessionStore } from "@starci/auth/server"
import type { DynamicModule } from "@nestjs/common"
import { CLOCK } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { IDS } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { PASSPORT_ACCOUNTS, PASSPORT_AUTHENTICATOR, PASSPORT_RATE_COUNTER, PASSPORT_SESSION_STORE } from "./passport.decorators"
import type { PassportOptions } from "./passport.options"

/** Whether the app root registers the sign-in package globally: the root decides, never the module. */
export interface PassportRegistration {
    /** True when every module of the app may inject what the package provides, without importing it. */
    readonly isGlobal: boolean
}

/** The sign-in package as a Nest module: the typed options, the clock and ids of the app, and the stores the identity domain provides. */
export const passportModule = (options: PassportOptions, registration: PassportRegistration): DynamicModule =>
    AuthModule.registerAsync({
        isGlobal: registration.isGlobal,
        authenticator: PASSPORT_AUTHENTICATOR,
        inject: [PASSPORT_SESSION_STORE, PASSPORT_ACCOUNTS, PASSPORT_RATE_COUNTER, CLOCK, IDS],
        useFactory: (sessions: SessionStore, accounts: AccountDirectory, rate: RateCounter, clock: Clock, ids: Ids) => ({
            ...options,
            sessions,
            accounts,
            rate,
            clock,
            ids,
        }),
    })
