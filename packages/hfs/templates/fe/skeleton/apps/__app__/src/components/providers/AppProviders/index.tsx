"use client"

import { ToastProvider } from "@heroui/react"
import { viewerCacheKey, viewerSwrConfig } from "@starci/next-data"
import type { ViewerId } from "@starci/next-data"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"
import { SWRConfig, useSWRConfig } from "swr"
import { useViewerId } from "@/hooks/auth"
import { useAuthSessionEffect } from "@/hooks/effects"
import { SwrSideEffects } from "@/hooks/swr"
import { viewerCache } from "@/modules/viewer-cache"
import { ReduxProvider } from "@/redux"

/** What the app providers wrap: the routed tree. */
type AppProvidersProps = { readonly children: ReactNode }

/**
 * The SWR defaults of the app: no refetch on focus or reconnect (a hook that needs fresh data opts in with its own
 * refreshInterval), duplicate requests collapsed for a minute, at most two retries of a failing key, and no stale data
 * across a key change (the loading state shows instead).
 */
const SWR_DEFAULTS = {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    errorRetryCount: 2,
    keepPreviousData: false,
} as const

/** The app-wide session effect: modules/auth's session kept in redux. Renders nothing. */
const AuthSessionEffect = (): null => {
    useAuthSessionEffect()
    return null
}

/** Points the writes of viewerCache at the SWR cache around it. Renders nothing. */
const ViewerCacheBinding = (): null => {
    viewerCache.bind(useSWRConfig().mutate)
    return null
}

/**
 * Each viewer gets their own SWR cache (FE-BOUNDARY-3): a change of person remounts the config on a fresh Map, and
 * `viewerSwrConfig` lists pollingRestart so a read whose refreshInterval stopped at 0 polls again for newer data.
 */
const renderViewerScope = (viewerId: ViewerId, children: ReactNode): ReactNode => (
    <SWRConfig key={viewerCacheKey(viewerId)} value={viewerSwrConfig(SWR_DEFAULTS)}>
        <ViewerCacheBinding />
        <SwrSideEffects />
        {children}
        <ToastProvider />
    </SWRConfig>
)

/** The SWR config of the viewer on screen around the routed tree. */
const ViewerSwrScope = (props: AppProvidersProps): ReactNode => renderViewerScope(useViewerId(), props.children)

/**
 * The one client provider stack the locale layout mounts, outer to inner: the theme (light and dark through the `.light` /
 * `.dark` class the grammar and the brand layer read, the system theme by default), the redux store, the session effect, the
 * SWR config keyed by the viewer, the app-wide effects and the HeroUI toast region modules/toast writes to. Each part is
 * composed here, in its one owner.
 */
export const AppProviders = (props: AppProvidersProps) => (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ReduxProvider>
            <AuthSessionEffect />
            <ViewerSwrScope>{props.children}</ViewerSwrScope>
        </ReduxProvider>
    </ThemeProvider>
)
