/**
 * The sign-in providers of the lite edition: `AuthModule.register({ ...options, providers: [google({...}), github({...})] })`. A next
 * provider (Facebook) is one file beside these that calls `defineProvider`, and one more entry in that list.
 */
export { DEFAULT_GOOGLE_STATE_COOKIE, GOOGLE_CODES, GOOGLE_PROVIDER_ID, GOOGLE_STATE_PATH, GOOGLE_STATE_TTL_MS, GoogleStateClient, PassportGoogleStrategy, google, googleProfileOf } from "./google.ts"
export type { GoogleOptions } from "./google.ts"
export { GITHUB_ENDPOINTS, GITHUB_PROVIDER_ID, GITHUB_SCOPES, PassportGitHubStrategy, github, githubProfileOf } from "./github.ts"
export type { GitHubOptions, GitHubRawProfile } from "./github.ts"
export { OAUTH_STATE_TTL_MS, OAuthStateClient, oauthStateCookie } from "./oauth-state.ts"
export type { OAuthStateDeps, OAuthStateOptions } from "./oauth-state.ts"
export { PROVIDER_CODES, defineProvider, signInWithProvider } from "./provider.ts"
export type { AnySignInProvider, ProviderCodes, ProviderContext, ProviderDefinition, SignInProvider } from "./provider.ts"
export { buildProviders, providersOf } from "./registry.ts"
export type { ProviderEntry, ProviderRuntimeDeps } from "./registry.ts"
