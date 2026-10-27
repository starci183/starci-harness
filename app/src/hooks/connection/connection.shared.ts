import { createContext } from "react"
import type { Connection } from "../../modules/api"

export type ConnectionStatus = "resolving" | "connected" | "fixtures" | "needs-connect"

export interface ConnectionContextValue {
    readonly status: ConnectionStatus
    readonly connection: Connection | null
    /** Why the connect screen is showing again (a refused token), if it is. */
    readonly problem: string | null
    readonly connect: (connection: Connection) => void
    readonly disconnect: (problem?: string) => void
    readonly enterFixtures: () => void
}

/** Filled by the `ConnectionProvider` of `app/providers.tsx`. */
export const ConnectionContext = createContext<ConnectionContextValue | null>(null)
