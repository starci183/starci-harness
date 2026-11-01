import type { ReactNode } from "react"
import { EmptyNotice } from "@starci/grammar/common"
{{slotTypes}}
/** One region's read, its same-shape placeholder, its resolved status copy and the ready tree it draws. */
type SlotViewProps<T> = {
    readonly slot: DataSlot<T>
    /** A value of the same shape as the items: while loading, the ready tree draws it with `isLoading` on each Grammar component. */
    readonly placeholder: T
    readonly labels: SlotLabels
    /** A primary region says it is forbidden in place; a secondary one disappears. */
    readonly forbidden?: "notice" | "hide"
    /** Re-runs exactly the read of this slot. */
    readonly onRetry: () => void
    readonly render: (items: T, isLoading: boolean) => ReactNode
}

/** The one status view (FE-ERROR-1): every region renders its loading, forbidden, error and empty status through here. */
export const SlotView = <T,>(props: SlotViewProps<T>) => {
    const { slot } = props
    if (slot.isLoading === true) return props.render(props.placeholder, true)
    if (slot.isForbidden === true) return props.forbidden === "hide" ? null : <EmptyNotice message={props.labels.forbidden} />
    if (slot.isError === true) {
        return <EmptyNotice isError message={props.labels.error} actionLabel={props.labels.retry} onAction={props.onRetry} />
    }
    if (slot.isEmpty === true) return <EmptyNotice message={props.labels.empty} />
    // A refresh (`isValidating`) beside data keeps the content: it never draws a skeleton.
    if (Array.isArray(slot.items) && slot.items.length === 0) return <EmptyNotice message={props.labels.empty} />
    return props.render(slot.items, false)
}
