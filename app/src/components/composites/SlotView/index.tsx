import { EmptyNotice, PageContainer } from "@starci/grammar/core"
import type { ReactNode } from "react"
import type { DataSlot, SlotLabels } from "../../../modules/types"

/** Input of SlotView. */
export interface SlotViewProps<T> {
    readonly slot: DataSlot<T>
    /** Data of the same shape: while loading, the ready tree draws from it with `isSkeleton`. */
    readonly placeholder: T
    readonly labels: SlotLabels
    /** A secondary region disappears on 403; a primary one says so in place. */
    readonly forbidden?: "hide" | "notice"
    /** Re-runs exactly this read. */
    readonly onRetry?: () => void
    /** An answer that holds nothing reads as empty, as an empty list does. */
    readonly isEmpty?: (items: T) => boolean
    /** The region heads the page, so its notice (the ready tree draws its own header) sits in the page body's gutter. */
    readonly isFramed?: boolean
    readonly children: (items: T, isSkeleton: boolean) => ReactNode
}

const isEmptyList = (items: unknown): boolean => Array.isArray(items) && items.length === 0

/**
 * Composite: the ONE recipe for a region's data status (FE-ERROR-1). No block writes its own loading, forbidden, error or
 * empty branch; each renders through here, in its own place inside its unchanged surface.
 */
export const SlotView = <T,>(props: SlotViewProps<T>) => {
    const { slot, labels } = props
    const frame = (notice: ReactNode): ReactNode =>
        props.isFramed === true ? (
            <PageContainer measure="full" className="app-page-body">
                {notice}
            </PageContainer>
        ) : (
            notice
        )
    if (slot.isLoading === true) return <>{props.children(props.placeholder, true)}</>
    if (slot.isForbidden === true) return props.forbidden === "hide" ? null : frame(<EmptyNotice message={labels.forbidden} />)
    if (slot.isError === true) {
        return frame(
            <EmptyNotice
                message={labels.error}
                actionLabel={labels.retry}
                actionVariant="secondary"
                {...(props.onRetry === undefined ? {} : { onAction: props.onRetry })}
            />,
        )
    }
    const items = slot.items
    if (items === undefined || isEmptyList(items) || props.isEmpty?.(items) === true) {
        return frame(<EmptyNotice message={labels.empty} {...(labels.emptyHint === undefined ? {} : { description: labels.emptyHint })} />)
    }
    return <>{props.children(items, false)}</>
}
