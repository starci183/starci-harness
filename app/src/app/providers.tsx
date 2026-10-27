import { CoreGrammarRoot, Toaster } from "@starci/grammar/core"
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { I18nProvider } from "react-aria-components"
import { useHref, useNavigate } from "react-router"
import { ConnectPage } from "../features/pages/ConnectPage"
import { ResolvingPage } from "../features/pages/ResolvingPage"
import { WorkspaceLayout } from "../features/layouts/WorkspaceLayout"
import { ConnectionContext, useConnection, type ConnectionStatus } from "../hooks/connection"
import {
    ApiError,
    isFixturesMode,
    readBrowserConnection,
    readLaunchConnection,
    saveConnection,
    setConnection,
    setFixturesMode,
    type Connection,
} from "../modules/api"
import { COMMON, LOCALE } from "../modules/i18n"

/**
 * Decides where the API is before anything renders: fixtures mode, then (desktop) the URL handed at launch, then `?token=`
 * or the stored connection; with none of them the connect page asks the owner to paste what `starci ui` printed.
 */
const ConnectionProvider = ({ children }: { readonly children: ReactNode }) => {
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

/** The session gate: no region renders before the API is known; a refused token brings the connect page back. */
const SessionGate = () => {
    const { status, disconnect } = useConnection()
    const [client] = useState(
        () =>
            new QueryClient({
                queryCache: new QueryCache({
                    onError: (error) => {
                        if (error instanceof ApiError && error.status === 401) disconnect(error.message)
                    },
                }),
                defaultOptions: {
                    queries: {
                        // Live events invalidate what changed; the interval only covers a stream that is down.
                        staleTime: 15_000,
                        refetchInterval: 60_000,
                        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
                    },
                },
            }),
    )
    if (status === "resolving") return <ResolvingPage />
    if (status === "needs-connect") return <ConnectPage />
    return (
        <QueryClientProvider client={client}>
            <WorkspaceLayout />
        </QueryClientProvider>
    )
}

/**
 * The providers of the root route: the React Aria locale, the Grammar `core` family (HeroUI anatomy) with the router's
 * `navigate` and `useHref`, so every Grammar `href` navigates in-app, the API connection and TanStack Query.
 */
export const Providers = () => {
    const navigate = useNavigate()
    return (
        // React Aria names its own controls (steppers, date parts) in the app's locale.
        <I18nProvider locale={LOCALE}>
            <CoreGrammarRoot theme="system" className="app-root" navigate={(path) => void navigate(path)} useHref={useHref}>
                <ConnectionProvider>
                    <SessionGate />
                </ConnectionProvider>
                <Toaster label={COMMON.notifications} dismissLabel={COMMON.dismissNotice} />
            </CoreGrammarRoot>
        </I18nProvider>
    )
}
