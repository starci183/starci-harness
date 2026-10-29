import type { AuthSession } from "./contracts"

/** The signed-in reader and the access token, in memory only; the refresh token never reaches the browser's script. */
interface Held {
    readonly token: string
    readonly session: AuthSession
}

let held: Held | undefined
const listeners = new Set<(session: AuthSession | undefined) => void>()

/** The held access token, or undefined when signed out. */
export const heldToken = (): string | undefined => held?.token

/** The held session, or undefined when signed out. */
export const heldSession = (): AuthSession | undefined => held?.session

/** Replaces the held token and session (undefined signs out) and tells every listener. */
export const hold = (next: Held | undefined): void => {
    held = next
    for (const listener of listeners) listener(held?.session)
}

/** Subscribes to session changes; the listener hears the current session first. */
export const listen = (listener: (session: AuthSession | undefined) => void): (() => void) => {
    listeners.add(listener)
    listener(held?.session)
    return () => {
        listeners.delete(listener)
    }
}
