import passport from "passport"
import type { Strategy } from "passport"
import { AUTH_ERROR_CODES } from "../../contracts/index.ts"
import { AuthError } from "../errors.ts"
import type { AuthOptions } from "../options.ts"
import type { AuthAuthenticator, AuthClock, AuthIds } from "../ports.ts"
import type { AuthTokens } from "../tokens.ts"
import { GOOGLE_PROVIDER_ID, google } from "./google.ts"
import { OAuthStateClient } from "./oauth-state.ts"
import type { AnySignInProvider } from "./provider.ts"

/**
 * The providers of one registration, in order: Google from the `google` option of 0.5.0 when it is set, then `providers`. Two
 * providers with one id (Google both as the option and in the list) are a configuration error, never a silent pick.
 */
export const providersOf = (options: Pick<AuthOptions, "google" | "providers">): readonly AnySignInProvider[] => {
    const listed: readonly AnySignInProvider[] = [...(options.google ? [google(options.google)] : []), ...(options.providers ?? [])]
    const seen = new Set<string>()
    for (const provider of listed) {
        if (seen.has(provider.id)) throw new AuthError(AUTH_ERROR_CODES.ProvidersInvalid, { context: { reason: "two providers share an id", id: provider.id } })
        seen.add(provider.id)
    }
    return listed
}

/** One provider as the module runs it: its definition, its state store and its passport strategy (registered under its id). */
export interface ProviderEntry {
    readonly provider: AnySignInProvider
    readonly state: OAuthStateClient
    readonly strategy: Strategy
}

/** What building the providers needs. */
export interface ProviderRuntimeDeps {
    readonly providers: readonly AnySignInProvider[]
    readonly authenticator: AuthAuthenticator
    readonly tokens: AuthTokens
    readonly clock: AuthClock
    readonly ids: AuthIds
    readonly returnOrigin: string
    /** The Google state store the module already holds (`AUTH_GOOGLE_STATE`), reused for the Google provider. */
    readonly googleState?: OAuthStateClient | undefined
}

/** Builds each provider's state store and strategy and registers the strategy with passport under the provider id. */
export const buildProviders = (deps: ProviderRuntimeDeps): ReadonlyMap<string, ProviderEntry> => {
    const entries = new Map<string, ProviderEntry>()
    for (const provider of deps.providers) {
        const reuse = provider.id === GOOGLE_PROVIDER_ID && deps.googleState?.cookieName === provider.stateCookie ? deps.googleState : undefined
        const state =
            reuse ??
            new OAuthStateClient({
                tokens: deps.tokens,
                clock: deps.clock,
                ids: deps.ids,
                state: { provider: provider.id, cookie: provider.stateCookie, path: provider.statePath, returnOrigin: deps.returnOrigin },
            })
        const strategy = provider.strategy({ authenticator: deps.authenticator, state })
        passport.use(provider.id, strategy)
        entries.set(provider.id, { provider, state, strategy })
    }
    return entries
}
