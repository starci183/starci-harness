import { callAuthDoor } from "./auth-door"
import type { DoorAnswer } from "./auth-door"
import type { AuthClient, AuthFailure, AuthSession } from "./contracts"
import { heldSession, heldToken, hold, listen } from "./token-store"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null

/** The token and session an auth door issued, narrowed from its unread body; undefined when the body is not one. */
const issuedOf = (body: unknown): { readonly token: string; readonly session: AuthSession } | undefined => {
    if (!isRecord(body) || typeof body.accessToken !== "string" || !isRecord(body.user) || typeof body.user.id !== "string") return undefined
    const email = typeof body.user.email === "string" ? body.user.email : undefined
    return { token: body.accessToken, session: { userId: body.user.id, ...(email === undefined ? {} : { email }) } }
}

/** The failure kind of a door's status: refused credentials, rejected input, or the API unavailable. */
const kindOf = (status: number): string => {
    if (status === 400 || status === 401 || status === 403) return "refused"
    return status === 422 ? "invalid" : "unavailable"
}

const failureOf = (answer: DoorAnswer): AuthFailure => ({ code: `AUTH_${String(answer.status)}`, kind: kindOf(answer.status), message: "" })

const ok = (answer: DoorAnswer): boolean => answer.status >= 200 && answer.status < 300

/** Rotates the refresh cookie and holds the new access token; signs out when the API refuses the cookie. */
const refresh = async (): Promise<string | undefined> => {
    const answer = await callAuthDoor("refresh")
    hold(ok(answer) ? issuedOf(answer.body) : undefined)
    return heldToken()
}

/** The lite session issuer's client: the app's own auth doors through `auth-door.ts`, the token in `token-store.ts`. */
export const authClient: AuthClient = {
    session: async () => heldSession() ?? ((await refresh()) === undefined ? undefined : heldSession()),
    accessToken: async () => heldToken() ?? refresh(),
    refreshAccessToken: refresh,
    signInWithPassword: async (email, password) => {
        const answer = await callAuthDoor("sign-in", { email, password })
        const issued = ok(answer) ? issuedOf(answer.body) : undefined
        if (issued === undefined) return failureOf(answer)
        hold(issued)
        return undefined
    },
    signOut: async () => {
        const answer = await callAuthDoor("sign-out")
        hold(undefined)
        return ok(answer) ? undefined : failureOf(answer)
    },
    onChange: listen,
}
