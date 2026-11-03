import { AUTH_ERROR_CODES, PASSWORD_BOUNDS } from "../contracts/index.ts"

/** Shortest display name a sign-up accepts. */
export const NAME_MIN_LENGTH = 2
/** Shortest password the forms accept (the doors enforce the same bound). */
export const PASSWORD_MIN_LENGTH = PASSWORD_BOUNDS.min
/** Seconds before a confirmation or reset mail may be requested again. */
export const RESEND_COOLDOWN_SECONDS = 60

/** One address: a local part, one `@`, a domain with a dot. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/u

/** How strong a password looks. */
export type Strength = "weak" | "ok" | "strong"

/** Rough strength hint for the sign-up and reset forms (length plus character variety). */
export const passwordStrength = (value: string): Strength => {
    const variety = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((pattern) => pattern.test(value)).length
    if (value.length < PASSWORD_MIN_LENGTH || variety < 2) return "weak"
    return value.length >= 10 && variety >= 3 ? "strong" : "ok"
}

/** The catalog key of the strength sentence. */
export const strengthKey = (value: Strength): "strengthWeak" | "strengthOk" | "strengthStrong" => {
    if (value === "weak") return "strengthWeak"
    return value === "ok" ? "strengthOk" : "strengthStrong"
}

/** Catalog keys of the friendly error sentences. */
export type AuthErrorKey =
    | "errInvalidCredentials"
    | "errEmailNotConfirmed"
    | "errTooMany"
    | "errWeakPassword"
    | "errLinkInvalid"
    | "errGeneric"

/** Maps the code of a failed outcome (a wire code, or an HTTP status when the body named none) to its catalog key. */
export const authErrorKey = (code: string): AuthErrorKey => {
    switch (code) {
        case AUTH_ERROR_CODES.InvalidCredentials:
            return "errInvalidCredentials"
        case AUTH_ERROR_CODES.EmailNotConfirmed:
            return "errEmailNotConfirmed"
        case AUTH_ERROR_CODES.TooManyAttempts:
        case "429":
            return "errTooMany"
        case AUTH_ERROR_CODES.PasswordInvalid:
            return "errWeakPassword"
        case AUTH_ERROR_CODES.ResetTokenInvalid:
            return "errLinkInvalid"
        default:
            return "errGeneric"
    }
}

/** Whether a failure code means the recovery link is no longer usable. */
export const isLinkInvalid = (code: string): boolean => authErrorKey(code) === "errLinkInvalid"
