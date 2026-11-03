import { createContext, createElement, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react"
import type { ReactElement, ReactNode } from "react"
import type { AuthClient, AuthSnapshot } from "../client/index.ts"

const AuthClientContext = createContext<AuthClient | null>(null)

/** The props of the provider. */
export interface AuthProviderProps {
    /** The one client of the front end (`createAuthClient`). */
    readonly client: AuthClient
    readonly children?: ReactNode
}

/** Makes the client reachable to the hooks below. It draws nothing: it is a context, never a visual. */
export const AuthProvider = ({ client, children }: AuthProviderProps): ReactElement =>
    createElement(AuthClientContext.Provider, { value: client }, children)

/** The client of the nearest provider. */
export const useAuthClient = (): AuthClient => {
    const client = useContext(AuthClientContext)
    if (client === null) throw new Error("useAuthClient needs an AuthProvider above it")
    return client
}

/** The session snapshot: loading until the first answer (the first subscriber starts it), then signed in or out. */
export const useAuthSession = (): AuthSnapshot => {
    const client = useAuthClient()
    return useSyncExternalStore(client.watch, client.getSnapshot, client.getServerSnapshot)
}

/** Calls `onSignedIn` once the session is signed in (a public sign-in page sends a visitor who already has a session on). */
export const useWhenSignedIn = (onSignedIn: () => void): void => {
    const { status } = useAuthSession()
    useEffect(() => {
        if (status === "signed-in") onSignedIn()
    }, [status, onSignedIn])
}

/** A resend cooldown: `start()` begins a countdown from `seconds`; `left` is 0 when ready. */
export const useCooldown = (seconds: number, startActive = false): { readonly left: number; readonly start: () => void } => {
    const [left, setLeft] = useState(startActive ? seconds : 0)
    useEffect(() => {
        if (left <= 0) return undefined
        const id = setTimeout(() => {
            setLeft((current) => current - 1)
        }, 1000)
        return () => {
            clearTimeout(id)
        }
    }, [left])
    const start = useCallback(() => {
        setLeft(seconds)
    }, [seconds])
    return { left, start }
}
