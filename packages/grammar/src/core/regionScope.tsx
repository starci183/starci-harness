"use client"

import { createContext, createElement, useContext, type FunctionComponent, type ReactElement, type ReactNode } from "react"
import { SkeletonPlaceholder } from "./leaf/Skeleton/index.js"

/* The loading region and the helpers that read it. No dependency on a leaf that reads the region: this module is the root of the cycle-free graph. */

const LoadingScopeContext = createContext<boolean | null>(null)

/**
 * Whether the region around this component is loading. A region that loads (`PaneSection isLoading`, a `Section`) tells every
 * Grammar component inside it, so a frame passes one flag, not one per child. A component's own `isLoading` wins.
 */
export const useIsLoading = (own: boolean | undefined): boolean => {
    const scope = useContext(LoadingScopeContext)
    return own ?? scope ?? false
}

/** Tells the Grammar components inside that their region is (or is no longer) loading. */
export const LoadingScope = ({ isLoading, children }: { readonly isLoading: boolean; readonly children: ReactNode }) => (
    <LoadingScopeContext.Provider value={isLoading}>{children}</LoadingScopeContext.Provider>
)

/**
 * Makes a component take its loading from the nearest loading region (a `SurfaceCard`, `Section`, `PaneSection`, `Form`, `Dialog` or
 * `Drawer` body) when it is not given `isLoading` itself; an explicit `isLoading` (either value) wins. An app passes the flag to the
 * region, never to every field in it, and every component that can sit in a region draws the same box as when ready.
 */
export const withRegionLoading = <P extends { readonly isLoading?: boolean | undefined }>(Inner: (props: P) => ReactElement | null): ((props: P) => ReactElement) => {
    const Region = (props: P): ReactElement => {
        const isLoading = useIsLoading(props.isLoading)
        return createElement(Inner as unknown as FunctionComponent<Record<string, unknown>>, { ...props, isLoading })
    }
    Region.displayName = `Region(${Inner.name === "" ? "Component" : Inner.name})`
    return Region
}

/** Whether the loading state a component draws comes from a region that already carries `aria-busy` (so the component adds none). */
export const useRegionOwnsBusy = (): boolean => useContext(LoadingScopeContext) === true

/**
 * For static chrome (a tab label, "Cancel", an icon button, a breadcrumb, a link): inside a loading region it keeps its real words and
 * only goes inert (not focusable, not announced as active); the region carries the one `aria-busy`. Data-driven chrome (a button
 * labelled with a count) says so with its own `isLoading`, which an explicit flag draws as geometry. An explicit `isLoading={false}`
 * opts out of the region. Not loading, it renders as itself, with no wrapper.
 */
export const withRegionInert = <P extends object>(Inner: (props: P) => ReactElement | null): ((props: P) => ReactElement) => {
    const Region = (props: P): ReactElement => {
        const own = (props as { readonly isLoading?: boolean | undefined }).isLoading
        const scope = useContext(LoadingScopeContext)
        const element = createElement(Inner as unknown as FunctionComponent<Record<string, unknown>>, props as Record<string, unknown>)
        if (own !== undefined || scope !== true) return element
        return createElement("span", { className: "starci-core-region-inert", "data-grammar-region-inert": "true", inert: true }, element)
    }
    Region.displayName = `RegionInert(${Inner.name === "" ? "Component" : Inner.name})`
    return Region
}

/**
 * For data-driven parts with no skeleton of their own (an avatar stack, a lockup of a name and a mark, a relative time, an image):
 * loading, from the region or from an explicit `isLoading`, lays the ready content out unseen under a shimmer, so the box is the
 * ready box by construction. An explicit `isLoading={false}` opts out of the region.
 */
export const withRegionGeometry = <P extends object>(Inner: (props: P) => ReactElement | null, shape: "text" | "block" | "circle" = "block"): ((props: P) => ReactElement) => {
    const Region = (props: P): ReactElement => {
        const isLoading = useIsLoading((props as { readonly isLoading?: boolean | undefined }).isLoading)
        const element = createElement(Inner as unknown as FunctionComponent<Record<string, unknown>>, props as Record<string, unknown>)
        return isLoading ? createElement(SkeletonPlaceholder, { shape }, element) : element
    }
    Region.displayName = `RegionGeometry(${Inner.name === "" ? "Component" : Inner.name})`
    return Region
}
