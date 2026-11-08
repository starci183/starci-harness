import type { Strategy } from "passport"
import { AUTH_ERROR_CODES, providerDoor } from "../../contracts/index.ts"
import type { AuthErrorCode } from "../../contracts/index.ts"
import { AuthError } from "../errors.ts"
import type { AuthAuthenticator, AuthSubject, ProviderProfile } from "../ports.ts"
import { oauthStateCookie } from "./oauth-state.ts"
import type { OAuthStateClient } from "./oauth-state.ts"

/** The codes a provider's doors refuse with: the provider is not configured, its round trip cannot be proved, or it refused the person. */
export interface ProviderCodes {
    readonly unavailable: AuthErrorCode
    readonly stateInvalid: AuthErrorCode
    readonly rejected: AuthErrorCode
}

/** The codes of every provider but Google, which keeps the codes 0.5.0 answered with. */
export const PROVIDER_CODES: ProviderCodes = {
    unavailable: AUTH_ERROR_CODES.ProviderUnavailable,
    stateInvalid: AUTH_ERROR_CODES.ProviderStateInvalid,
    rejected: AUTH_ERROR_CODES.ProviderRejected,
}

/** What the module hands a provider to build its passport strategy. */
export interface ProviderContext {
    /** The app's sign-in decisions. */
    readonly authenticator: AuthAuthenticator
    /** The state store of this provider's round trip (handle, PKCE verifier and landing path in a signed cookie). */
    readonly state: OAuthStateClient
}

/**
 * One way to sign in through a third party (Google, GitHub, a next one): the whole of it lives in one file that calls `defineProvider`,
 * and an app lists it in `AuthModule.register({ providers: [...] })`. The module gives it a state store, builds its passport strategy,
 * registers the strategy under `id`, and the doors run `/auth/<id>` and `/auth/<id>/callback` for it.
 */
export interface SignInProvider<TOptions = unknown, TRaw = unknown> {
    /** The provider id: the passport strategy name, the state purpose and the door segment. Lower-case letters, digits and dashes. */
    readonly id: string
    /** The provider's options (client id, secret, callback address), typed and parsed by the app. */
    readonly options: TOptions
    /** The cookie that carries one round trip (`auth_<id>_state` unless the options name one). */
    readonly stateCookie: string
    /** The path that cookie is sent to: the provider's door (`/auth/<id>`). */
    readonly statePath: string
    /** Extra parameters of the consent redirect (Google's `prompt: select_account`). */
    readonly authorizeParams: Readonly<Record<string, string>>
    /** The codes its doors refuse with. */
    readonly codes: ProviderCodes
    /** The facts the app needs from what the provider answered; an account without a subject is refused. */
    readonly profileOf: (raw: TRaw) => ProviderProfile
    /** Builds the passport strategy (`state` and PKCE through `context.state`); the module registers it with passport under `id`. */
    readonly strategy: (context: ProviderContext) => Strategy
}

/** Any provider, whatever its options and raw profile: what `AuthModule.register` lists. */
export type AnySignInProvider = SignInProvider<unknown, never>

/** What `defineProvider` takes: the id, the options, the profile mapping and the strategy, with the rest defaulted. */
export interface ProviderDefinition<TOptions, TRaw> {
    readonly id: string
    readonly options: TOptions
    readonly stateCookie?: string | undefined
    readonly authorizeParams?: Readonly<Record<string, string>> | undefined
    readonly codes?: ProviderCodes | undefined
    readonly profileOf: (raw: TRaw) => ProviderProfile
    readonly strategy: (context: ProviderContext) => Strategy
}

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,31}$/u

/** A provider from its definition: the id is checked (it becomes a door path, a cookie name and a passport name), the state cookie, its path and the codes are defaulted. */
export const defineProvider = <TOptions, TRaw>(definition: ProviderDefinition<TOptions, TRaw>): SignInProvider<TOptions, TRaw> => {
    if (!PROVIDER_ID.test(definition.id)) throw new AuthError(AUTH_ERROR_CODES.ProvidersInvalid, { context: { reason: "a provider id is lower-case letters, digits and dashes", id: definition.id } })
    return {
        id: definition.id,
        options: definition.options,
        stateCookie: definition.stateCookie ?? oauthStateCookie(definition.id),
        statePath: providerDoor(definition.id),
        authorizeParams: definition.authorizeParams ?? {},
        codes: definition.codes ?? PROVIDER_CODES,
        profileOf: definition.profileOf,
        strategy: definition.strategy,
    }
}

/** Signs in the person a provider other than Google established, through the app's `signInWithProvider`; an app that has none refuses the provider. */
export const signInWithProvider = (authenticator: AuthAuthenticator, profile: ProviderProfile): Promise<AuthSubject> => {
    if (authenticator.signInWithProvider === undefined) {
        return Promise.reject(new AuthError(AUTH_ERROR_CODES.ProviderUnavailable, { context: { provider: profile.provider, reason: "the authenticator has no signInWithProvider" } }))
    }
    return authenticator.signInWithProvider(profile)
}
