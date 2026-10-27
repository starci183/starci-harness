import { CoreGrammarRoot, PageContainer, Spinner, Toaster } from "@starci/grammar/core"
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { I18nProvider } from "react-aria-components"
import { createHashRouter, RouterProvider, useHref, useNavigate } from "react-router"
import { ApiError } from "../api/client"
import { InboxPage } from "../pages/inbox"
import { OverviewPage } from "../pages/overview"
import { SettingsPage } from "../pages/settings"
import { TaskPage } from "../pages/task"
import { WorkflowPage } from "../pages/workflow"
import { AppShell } from "./AppShell"
import { ConnectionProvider, useConnection } from "./connection"
import { ConnectScreen } from "./ConnectScreen"
import { COMMON, CONNECT, LOCALE } from "./labels"

/**
 * Hash routes: the desktop shell serves one file, so the route lives after `#` while `?fixtures=1` and `?token=` stay in
 * the page's own query. The router is outermost, so the Grammar root below it takes its `navigate` and `useHref`.
 */
const router = createHashRouter([
    {
        path: "/",
        element: <Root />,
        children: [
            { index: true, element: <OverviewPage /> },
            { path: "w/:project/:workflow", element: <WorkflowPage /> },
            { path: "t/:project/:task", element: <TaskPage /> },
            { path: "inbox", element: <InboxPage /> },
            { path: "settings", element: <SettingsPage /> },
            { path: "*", element: <OverviewPage /> },
        ],
    },
])

const Gate = () => {
    const { status, disconnect } = useConnection()
    const [client] = useState(
        () =>
            new QueryClient({
                queryCache: new QueryCache({
                    onError: error => {
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

    if (status === "resolving")
        return (
            <PageContainer measure="reading" className="app-connect">
                <Spinner label={CONNECT.resolving} />
            </PageContainer>
        )
    if (status === "needs-connect") return <ConnectScreen />
    return (
        <QueryClientProvider client={client}>
            <AppShell />
        </QueryClientProvider>
    )
}

/**
 * Providers under the router: the React Aria locale, the Grammar `core` family (HeroUI anatomy) with the router's
 * `navigate` and `useHref`, so every Grammar `href` (links, breadcrumbs, table rows, graph nodes) navigates in-app, the API
 * connection and TanStack Query.
 */
function Root() {
    const navigate = useNavigate()
    return (
        // React Aria names its own controls (steppers, date parts) in the app's locale.
        <I18nProvider locale={LOCALE}>
            <CoreGrammarRoot theme="system" className="app-root" navigate={(path) => void navigate(path)} useHref={useHref}>
                <ConnectionProvider>
                    <Gate />
                </ConnectionProvider>
                <Toaster label={COMMON.notifications} dismissLabel={COMMON.dismissNotice} />
            </CoreGrammarRoot>
        </I18nProvider>
    )
}

/** The app: the hash router, whose root route mounts every provider and the shell. */
export const App = () => <RouterProvider router={router} />
