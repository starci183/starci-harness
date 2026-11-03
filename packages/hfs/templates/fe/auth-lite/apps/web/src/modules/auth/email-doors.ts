// Managed by starci app sync (slot fe.modules.auth.client); do not edit: run "npx starci app sync --execute".
import { createAuthClient } from "@starci/auth/client"
import { apiUrl } from "@/modules/config"
import type { AuthFailure } from "./contracts"

/** The email doors of the lite back end; the full edition's identity provider owns its own sign-up and recovery flows. */
export type EmailDoorName = "signup" | "resend" | "confirm" | "forgot" | "reset"

/** The anonymous doors need no session, so they use a client of their own over the same back-end origin. */
const doors = createAuthClient({ apiOrigin: () => apiUrl() })

/** Calls one email door with its posted fields; answers its failure (the wire code and its kind), or undefined when the back end accepted it. */
export const sendEmailDoor = async (door: EmailDoorName, body: Readonly<Record<string, string | undefined>>): Promise<AuthFailure | undefined> => {
    const outcome = await doors.send(door, body)
    return outcome.success ? undefined : { code: outcome.error, kind: outcome.message, message: "" }
}
