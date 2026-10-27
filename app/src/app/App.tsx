import { CoreGrammarRoot, PageContainer, Spinner, Toaster } from "@starci/grammar/core"
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { I18nProvider } from "react-aria-components"
import { createHashRouter, RouterProvider } from "react-router"
import { ApiError } from "../api/client"
import { InboxPage } from "../pages/inbox"
import { OverviewPage } from "../pages/overview"
import { SettingsPage } from "../pages/settings"
import { TaskPage } from "../pages/task"
import { WorkflowPage } from "../pages/workflow"
import { AriaRoutedShell } from "./AriaRouter"
import { ConnectionProvider, useConnection } from "./connection"
import { ConnectScreen } from "./ConnectScreen"
import { COMMON, CONNECT, LOCALE } from "./labels"

/**
 * Hash routes: the desktop shell serves one file, so the route lives after `#` while `?fixtures=1` and `?token=` stay in
 * the page's own query.
 */
const router = createHashRouter([
    {
        path: "/",
        element: <AriaRoutedShell />,
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
            <RouterProvider router={router} />
        </QueryClientProvider>
    )
}

/** Providers: the React Aria locale, the Grammar `core` family (HeroUI anatomy), the API connection, TanStack Query and the router. */
export const App = () => (
    // React Aria names its own controls (steppers, date parts) in the app's locale.
    <I18nProvider locale={LOCALE}>
        <CoreGrammarRoot theme="system" className="app-root">
            <ConnectionProvider>
                <Gate />
            </ConnectionProvider>
            <Toaster label={COMMON.notifications} dismissLabel={COMMON.dismissNotice} />
        </CoreGrammarRoot>
    </I18nProvider>
)
