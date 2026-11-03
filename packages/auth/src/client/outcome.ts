import type { AuthFailureKind, AuthOutcome } from "../contracts/index.ts"

/** Wraps a value as a successful outcome. */
export const authOk = <T>(value: T): AuthOutcome<T> => ({ success: true, message: "ok", data: value })

/** Builds an expected failure: the kind as the message, the wire code as the error. */
export const authFailure = <T = never>(kind: AuthFailureKind, code: string): AuthOutcome<T> => ({
    success: false,
    message: kind,
    error: code,
})

/** True when a status of a refresh or session door means the person is signed out. Only 401 and 403 do: a 429, a 5xx or a lost connection is a passing failure that never ends a session. */
export const isSignedOutStatus = (status: number): boolean => status === 401 || status === 403

/** True when a status is a passing failure (too many requests, a server error) that a later attempt can clear. */
export const isTransientStatus = (status: number): boolean => status === 429 || status >= 500

/** The failure kind an HTTP status of the auth doors stands for. */
export const kindOfStatus = (status: number): AuthFailureKind => {
    if (isSignedOutStatus(status)) return "refused"
    if (status === 404) return "not-found"
    return status === 400 || status === 409 || status === 410 || status === 422 ? "invalid" : "unavailable"
}

/** Codes a status falls back to when the body names none, so the friendly copy can pick its sentence. */
export type StatusCodes = Readonly<Record<number, string>>

/** Maps a non-ok answer of an auth door (status plus the optional `code` of its JSON body) into a failed outcome. */
export const failureOfStatus = <T = never>(status: number, code: string | undefined, fallbacks: StatusCodes = {}): AuthOutcome<T> =>
    authFailure(kindOfStatus(status), code ?? fallbacks[status] ?? String(status))
