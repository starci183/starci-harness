import { createHashRouter, RouterProvider } from "react-router"
import { InboxPage } from "../features/pages/InboxPage"
import { OverviewPage } from "../features/pages/OverviewPage"
import { SettingsPage } from "../features/pages/SettingsPage"
import { TaskPage } from "../features/pages/TaskPage"
import { WorkflowPage } from "../features/pages/WorkflowPage"
import { APP_ROUTES } from "../modules/routes"
import { Providers } from "./providers"

/**
 * The route table, Vite's `app/`: each route mounts exactly one page owner. Hash routes, since the desktop shell serves one
 * file; `?fixtures=1` and `?token=` stay in the page's own query. The root route is the providers, whose session gate
 * mounts the `WorkspaceLayout`, which renders the matched page through its outlet.
 */
const router = createHashRouter([
    {
        path: APP_ROUTES.overview,
        element: <Providers />,
        children: [
            { index: true, element: <OverviewPage /> },
            { path: APP_ROUTES.workflow.slice(1), element: <WorkflowPage /> },
            { path: APP_ROUTES.task.slice(1), element: <TaskPage /> },
            { path: APP_ROUTES.inbox.slice(1), element: <InboxPage /> },
            { path: APP_ROUTES.settings.slice(1), element: <SettingsPage /> },
            { path: "*", element: <OverviewPage /> },
        ],
    },
])

/** The app: the hash router, whose root route mounts every provider and the frame. */
export const App = () => <RouterProvider router={router} />
