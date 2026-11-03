import { injector } from "@modules/platform/composition"
import type { TypedParameterDecorator } from "@modules/platform/composition"
import type { PassportOptions, VerifyAccessToken } from "./passport.options"

/** Token of the passport options. */
export const PASSPORT_OPTIONS: unique symbol = Symbol("integrations.passport.options")
/** Token of the verifier of the app's own access tokens. */
export const OWN_TOKEN_VERIFIER: unique symbol = Symbol("integrations.passport.own-token-verifier")

/** Injects the passport options. Parameter type: PassportOptions. */
export const InjectPassportOptions = (): TypedParameterDecorator<PassportOptions> => injector<PassportOptions>(PASSPORT_OPTIONS)

/** Injects the own-token verifier. Parameter type: VerifyAccessToken. */
export const InjectOwnTokenVerifier = (): TypedParameterDecorator<VerifyAccessToken> =>
    injector<VerifyAccessToken>(OWN_TOKEN_VERIFIER)
