import { AuthModule } from "@starci/auth/server"
import type { AccountDirectory, RateCounter, SessionStore } from "@starci/auth/server"
import type { DynamicModule } from "@nestjs/common"
import { CLOCK } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { IDS } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import { PASSPORT_ACCOUNTS, PASSPORT_AUTHENTICATOR, PASSPORT_RATE_COUNTER, PASSPORT_SESSION_STORE } from "./passport.decorators"
import type { PassportOptions } from "./passport.options"

/** The sign-in package as a Nest module: the typed options, the clock and ids of the app, and the stores the identity domain provides. */
export const passportModule = (options: PassportOptions): DynamicModule =>
    AuthModule.registerAsync({
        isGlobal: true,
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
