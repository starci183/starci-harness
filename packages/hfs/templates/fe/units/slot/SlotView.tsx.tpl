import type { ReactNode } from "react"
import { EmptyNotice } from "@starci/grammar/common"
{{slotTypes}}
/** One region's read, its same-shape placeholder, its resolved status copy and the ready tree it draws. */
type SlotViewProps<T> = {
    readonly slot: DataSlot<T>
    /** A value of the same shape as the items: while loading, the ready tree draws it with `isSkeleton`. */
    readonly placeholder: T
    readonly labels: SlotLabels
    /** A primary region says it is forbidden in place; a secondary one disappears. */
    readonly forbidden?: "notice" | "hide"
    /** Re-runs exactly the read of this slot. */
    readonly onRetry: () => void
    readonly children: (items: T, isSkeleton: boolean) => ReactNode
}

/** The one status view (FE-ERROR-1): every region renders its loading, forbidden, error and empty status through here. */
export const SlotView = <T,>(props: SlotViewProps<T>) => {
    if (props.slot.isLoading === true) return props.children(props.placeholder, true)
    if (props.slot.isForbidden === true) return props.forbidden === "hide" ? null : <EmptyNotice message={props.labels.forbidden} />
    if (props.slot.isError === true) {
        return <EmptyNotice message={props.labels.error} actionLabel={props.labels.retry} onAction={props.onRetry} />
    }
    const items = props.slot.items
    // No items, or an empty list, is the region's empty sentence.
    if (items === undefined || (Array.isArray(items) && items.length === 0)) return <EmptyNotice message={props.labels.empty} />
    return props.children(items, false)
}
