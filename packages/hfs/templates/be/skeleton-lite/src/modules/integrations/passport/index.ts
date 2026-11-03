export { AuthError, digestOf, isAcceptablePassword, isPresentablePassword, normalizeEmail } from "@starci/auth/server"
export type {
    AccountDirectory,
    AccountStanding,
    AuthAuthenticator,
    AuthDoors,
    AuthPasswords,
    AuthSessions,
    AuthSubject,
    GoogleProfile,
    HttpExchange,
    NewSession,
    RateCounter,
    RefreshTokenRecord,
    SessionStore,
    SessionTransaction,
    SignInBudget,
} from "@starci/auth/server"
export type { AccessGrant, GoogleRedirect, JwksDocument } from "@starci/auth/contracts"
export { parsePassportConfig } from "./passport.config"
export {
    OWN_TOKEN_VERIFIER,
    PASSPORT_ACCOUNTS,
    PASSPORT_AUTHENTICATOR,
    PASSPORT_DOORS,
    PASSPORT_OPTIONS,
    PASSPORT_PASSWORDS,
    PASSPORT_RATE_COUNTER,
    PASSPORT_SESSION_STORE,
    PASSPORT_SESSIONS,
    PASSPORT_SIGN_IN_BUDGET,
} from "./passport.decorators"
export { PASSPORT_ERROR_KINDS, PassportError, PassportErrorCode } from "./errors/passport.error"
export { passportKit } from "./passport.kit"
export { passportModule } from "./passport.registration"
export type { PassportOptions, VerifyAccessToken } from "./passport.options"
