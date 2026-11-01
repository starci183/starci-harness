"use client"

import { createContext, useContext, type ReactNode } from "react"
import { ExclamationTriangleIcon } from "@heroicons/react/16/solid"
import { Button } from "./leaf/Button/index.js"
import { IconTile } from "./leaf/IconTile/index.js"
import { Text } from "./leaf/Text/index.js"

/**
 * The four states of a region, and who owns them (contexts/ui/loading.md).
 *
 * - **loading**: a first read with no data. The component draws its ready structure as geometry. A refresh that already has
 *   data is not loading: the content stays still.
 * - **error**: the read failed. `error` is the place it shows; a failed read never reads as empty.
 * - **empty**: the read finished and there is nothing. The component's own `empty` slot.
 * - **ready**: the data.
 *
 * An app passes the status (`isLoading`, `error`) and never draws a skeleton or a row count. Precedence: loading, then
 * error, then empty, then ready.
 */

/** What a failed read shows: the words, and the one next step (usually a retry). Drawn by the component, not the app. */
export type ErrorData = {
    /** What failed, in the reader's words. */
    readonly message: string
    /** One supporting line. */
    readonly description?: string
    /** The retry command's label. Give it with `onAction`. */
    readonly actionLabel?: string
    readonly onAction?: () => void
}

/**
 * How many placeholder rows a list draws when it was given no row to measure. The Grammar's choice; an app never passes a
 * count. A block that gives same-shape placeholder rows (FE-ERROR-1) sets both the count and the shape of the skeleton.
 */
export const LOADING_ROWS = 3

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
 * A failed read, in the place the data would have been. It is a live `alert` with a warning mark, so it never looks like
 * the empty line. Built from leaves only, so a branch may draw it too.
 */
export const ErrorView = ({ error }: { readonly error: ErrorData }) => (
    <div
        role="alert"
        className="starci-core-empty-notice"
        data-contract="GAP-3 PADDING-4"
        data-grammar-error="true"
        data-grammar-empty-mark="glyph"
    >
        <IconTile source={ExclamationTriangleIcon} tone="danger" size="md" />
        <Text size="sm" tone="muted">{error.message}</Text>
        {error.description === undefined ? null : <Text size="xs" tone="muted">{error.description}</Text>}
        {error.actionLabel === undefined ? null : (
            <Button intent="commit" size="sm" {...(error.onAction === undefined ? {} : { onPress: error.onAction })}>{error.actionLabel}</Button>
        )}
    </div>
)
