import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
    isFixturesMode,
    readBrowserConnection,
    readLaunchConnection,
    saveConnection,
    setConnection,
    setFixturesMode,
    type Connection,
} from "../api/client"

export type ConnectionStatus = "resolving" | "connected" | "fixtures" | "needs-connect"

interface ConnectionContextValue {
    readonly status: ConnectionStatus
    readonly connection: Connection | null
    /** Why the connect screen is showing again (a refused token), if it is. */
    readonly problem: string | null
    readonly connect: (connection: Connection) => void
    readonly disconnect: (problem?: string) => void
    readonly enterFixtures: () => void
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

/**
 * Decides where the API is before anything renders: fixtures mode, then (desktop) the URL handed at launch, then `?token=`
 * or the stored connection; with none of them the connect screen asks the owner to paste what `starci ui` printed.
 */
export const ConnectionProvider = ({ children }: { readonly children: ReactNode }) => {
    const [status, setStatus] = useState<ConnectionStatus>(() => (isFixturesMode() ? "fixtures" : "resolving"))
    const [connection, setState] = useState<Connection | null>(null)
    const [problem, setProblem] = useState<string | null>(null)

    const connect = useCallback((next: Connection) => {
        saveConnection(next)
        setConnection(next)
        setState(next)
        setProblem(null)
        setStatus("connected")
    }, [])

    const disconnect = useCallback((reason?: string) => {
        saveConnection(null)
        setConnection(null)
        setState(null)
        setProblem(reason ?? null)
        setStatus("needs-connect")
    }, [])

    const enterFixtures = useCallback(() => {
        setFixturesMode(true)
        setStatus("fixtures")
    }, [])

    useEffect(() => {
        if (status !== "resolving") return
        let cancelled = false
        void (async () => {
            const found = (await readLaunchConnection()) ?? readBrowserConnection()
            if (cancelled) return
            if (found === null) setStatus("needs-connect")
            else connect(found)
        })()
        return () => {
            cancelled = true
        }
    }, [status, connect])

    const value = useMemo(
        () => ({ status, connection, problem, connect, disconnect, enterFixtures }),
        [status, connection, problem, connect, disconnect, enterFixtures],
    )
    return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export const useConnection = (): ConnectionContextValue => {
    const value = useContext(ConnectionContext)
    if (value === null) throw new Error("useConnection outside ConnectionProvider")
    return value
}
