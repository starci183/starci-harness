import type { AuthFailure } from "@/modules/auth"

/** Why an email door refused: input the back end rejected, a weak password, a dead link, too many tries or the back end unreachable. */
export type EmailDoorFailure = "invalid" | "password" | "link" | "tooMany" | "unavailable"

/** The failure a door's wire code and kind stand for. */
export const failureOf = (failure: AuthFailure): EmailDoorFailure => {
    if (failure.code === "IDENTITY_PASSWORD_INVALID") return "password"
    if (failure.code === "IDENTITY_RESET_TOKEN_INVALID") return "link"
    if (failure.code === "IDENTITY_TOO_MANY_ATTEMPTS" || failure.code === "429") return "tooMany"
    return failure.kind === "invalid" ? "invalid" : "unavailable"
}
