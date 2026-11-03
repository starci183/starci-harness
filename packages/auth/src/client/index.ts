export { createAuthClient } from "./auth-client.ts"
export type { AuthClient, AuthClientOptions, AuthDoorAnswer, AuthEvent, AuthListener, AuthSnapshot } from "./auth-client.ts"
export { authFailure, authOk, failureOfStatus, isSignedOutStatus, isTransientStatus, kindOfStatus } from "./outcome.ts"
export type { StatusCodes } from "./outcome.ts"
export {
    EMAIL_PATTERN,
    NAME_MIN_LENGTH,
    PASSWORD_MIN_LENGTH,
    RESEND_COOLDOWN_SECONDS,
    authErrorKey,
    isLinkInvalid,
    passwordStrength,
    strengthKey,
} from "./shared.ts"
export type { AuthErrorKey, Strength } from "./shared.ts"
export { createSessionStore, createSingleFlight } from "./session.ts"
export type { SessionEvent, SessionListener, SessionPerson, SessionSnapshot, SessionSource, SessionStore, SingleFlight } from "./session.ts"
