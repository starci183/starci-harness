import { RouterProvider } from "react-aria-components"
import { useHref, useNavigate, type NavigateOptions } from "react-router"
import { AppShell } from "./AppShell"

declare module "react-aria-components" {
    interface RouterConfig {
        routerOptions: NavigateOptions
    }
}

/**
 * The app's one bridge between React Aria and react-router: every Grammar `Link`, `Breadcrumbs` item and other `href`
 * (HeroUI's React Aria anchors) navigates in-app through the hash router instead of loading a document.
 */
export const AriaRoutedShell = () => {
    const navigate = useNavigate()
    return (
        <RouterProvider navigate={(path, options) => void navigate(path, options)} useHref={useHref}>
            <AppShell />
        </RouterProvider>
    )
}
