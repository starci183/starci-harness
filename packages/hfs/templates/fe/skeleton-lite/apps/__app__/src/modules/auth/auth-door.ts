import axios from "axios"
import { apiUrl } from "@/modules/config"

/** What one auth door answered: its status and its body, unread (the client narrows it). */
export interface DoorAnswer {
    readonly status: number
    readonly body: unknown
}

/** The auth doors of the app's own back end; the refresh token rides in their httpOnly cookie, never in a body. */
export type AuthDoor = "sign-in" | "sign-up" | "refresh" | "sign-out" | "password-reset" | "resend-verification"

const TIMEOUT_MS = 10_000

/**
 * The one auth door of the front end: a POST to `<api>/auth/<door>` with the cookies attached. A network failure answers
 * status 0, so the client maps it to "unavailable" instead of throwing.
 */
export const callAuthDoor = async (door: AuthDoor, body?: Readonly<Record<string, string>>): Promise<DoorAnswer> => {
    try {
        const response = await axios.post<unknown>(`${apiUrl()}/auth/${door}`, body, {
            withCredentials: true,
            validateStatus: () => true,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        return { status: response.status, body: response.data }
    } catch {
        return { status: 0, body: undefined }
    }
}
