import { injector } from "@modules/platform/composition"
import type { TypedParameterDecorator } from "@modules/platform/composition"
import type { PassportOptions, VerifyAccessToken } from "./passport.options"
import type { FindPasswordAccount } from "./strategies/local.strategy"

/** Token of the passport options. */
export const PASSPORT_OPTIONS: unique symbol = Symbol("integrations.passport.options")
/** Token of the verifier of the app's own access tokens. */
export const OWN_TOKEN_VERIFIER: unique symbol = Symbol("integrations.passport.own-token-verifier")
/** Token of the password-account lookup the identity domain provides. */
export const PASSWORD_ACCOUNTS: unique symbol = Symbol("integrations.passport.password-accounts")

/** Injects the passport options. Parameter type: PassportOptions. */
export const InjectPassportOptions = (): TypedParameterDecorator<PassportOptions> => injector<PassportOptions>(PASSPORT_OPTIONS)

/** Injects the own-token verifier. Parameter type: VerifyAccessToken. */
export const InjectOwnTokenVerifier = (): TypedParameterDecorator<VerifyAccessToken> =>
    injector<VerifyAccessToken>(OWN_TOKEN_VERIFIER)

/** Injects the password-account lookup. Parameter type: FindPasswordAccount. */
export const InjectPasswordAccounts = (): TypedParameterDecorator<FindPasswordAccount> =>
    injector<FindPasswordAccount>(PASSWORD_ACCOUNTS)
