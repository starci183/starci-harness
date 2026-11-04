"use client"

import { usePaneContext } from "./paneContext.js"
import { useSurfaceHost } from "./surfaceContext.js"
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
    /**
     * The failure sits in a row of content (a form card, a booking step) and reads as one line: the warning mark, the title with its
     * line, and the retry at the end, with no tinted ground. Default: a band in a pane, the centred notice elsewhere.
     */
    readonly isInline?: boolean
}

/**
 * How many placeholder rows a list draws when it was given no row to measure. The Grammar's choice; an app never passes a
 * count. A block that gives same-shape placeholder rows (FE-ERROR-1) sets both the count and the shape of the skeleton.
 */
export const LOADING_ROWS = 3

export { LoadingScope, useIsLoading, useRegionOwnsBusy, withRegionGeometry, withRegionInert, withRegionLoading } from "./regionScope.js"

/**
 * A failed read, in the place the data would have been. It is a live `alert` with a warning mark, so it never looks like
 * the empty line: the message is the title (what happened), the description the way out, and the retry the one next step
 * as an alternative (outlined) command, since a failure is not the page's commit. In a pane's own band it draws as a
 * soft danger band that spans the band (`data-grammar-error-layout="band"`: mark, copy and retry in one row); inside a
 * card, a dialog or on the page it is the centred notice (`"notice"`). Built from leaves only, so a branch may draw it too.
 */
export const ErrorView = ({ error }: { readonly error: ErrorData }) => {
    const inPane = usePaneContext() !== undefined
    const host = useSurfaceHost()
    const layout = error.isInline === true ? "row" : inPane && host !== "card" && host !== "overlay" ? "band" : "notice"
    return (
        <div
            role="alert"
            className="starci-core-empty-notice"
            data-contract="GAP-3 PADDING-4"
            data-grammar-error="true"
            data-grammar-error-layout={layout}
            data-grammar-empty-mark="glyph"
        >
            <IconTile source={ExclamationTriangleIcon} tone="danger" size="md" />
            <div className="starci-core-notice-copy" data-contract="GAP-1">
                <Text size="sm" isStrong>{error.message}</Text>
                {error.description === undefined ? null : <Text size="sm" tone="muted">{error.description}</Text>}
            </div>
            {error.actionLabel === undefined ? null : (
                <Button intent="alternative" size="sm" {...(error.onAction === undefined ? {} : { onPress: error.onAction })}>{error.actionLabel}</Button>
            )}
        </div>
    )
}
