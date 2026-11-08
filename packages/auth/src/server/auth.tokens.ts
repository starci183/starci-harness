/** Token of the app's authenticator (resolved from the token the registration names). */
export const AUTH_AUTHENTICATOR: unique symbol = Symbol.for("@starci/auth/authenticator")
/** Token of `AuthTokens`, the access-token signer and verifier. */
export const AUTH_TOKENS: unique symbol = Symbol.for("@starci/auth/tokens")
/** Token of `AuthPasswords`. */
export const AUTH_PASSWORDS: unique symbol = Symbol.for("@starci/auth/passwords")
/** Token of `SignInBudget`. */
export const AUTH_SIGN_IN_BUDGET: unique symbol = Symbol.for("@starci/auth/sign-in-budget")
/** Token of `AuthSessions`, the rotating device sessions. */
export const AUTH_SESSIONS: unique symbol = Symbol.for("@starci/auth/sessions")
/** Token of `RefreshCookie`. */
export const AUTH_REFRESH_COOKIE: unique symbol = Symbol.for("@starci/auth/refresh-cookie")
/** Token of the Google round-trip state store. */
export const AUTH_GOOGLE_STATE: unique symbol = Symbol.for("@starci/auth/google-state")
/** Token of `AuthFlows`, the passport strategy runs. */
export const AUTH_FLOWS: unique symbol = Symbol.for("@starci/auth/flows")
/** Token of the local passport strategy (registered with passport when constructed). */
export const AUTH_LOCAL_STRATEGY: unique symbol = Symbol.for("@starci/auth/local-strategy")
/** Token of the Google passport strategy, or null when the deployment has no Google client. */
export const AUTH_GOOGLE_STRATEGY: unique symbol = Symbol.for("@starci/auth/google-strategy")
/** Token of the registered sign-in providers: each one's definition, state store and passport strategy, by provider id. */
export const AUTH_PROVIDERS: unique symbol = Symbol.for("@starci/auth/providers")
/** Token of `AuthDoors`, what a controller calls. */
export const AUTH_DOORS_SERVICE: unique symbol = Symbol.for("@starci/auth/doors")
/** Token of the `PrincipalVerifier` the identity domain injects. */
export const AUTH_PRINCIPAL_VERIFIER: unique symbol = Symbol.for("@starci/auth/principal-verifier")
