import type { ReactNode } from "react"
import { EmptyNotice } from "@starci/grammar/core"
import type { DataSlot, SlotLabels } from "@/modules/types"

/** One region's slot, the placeholder its skeleton draws, and the ready tree as a function of its items. */
export interface SlotViewProps<T> {
    readonly slot: DataSlot<T>
    /** Fake data of the same shape: the skeleton reuses the ready tree. */
    readonly placeholder: T
    readonly labels: SlotLabels
    /** A primary region says it is forbidden; a secondary one disappears. */
    readonly forbidden?: "notice" | "hide"
    readonly onRetry: () => void
    readonly children: (items: T, isSkeleton: boolean) => ReactNode
}

/** The one status view: loading draws the ready tree from the placeholder, error offers the retry, empty says so. */
export const SlotView = <T,>(props: SlotViewProps<T>) => {
    if (props.slot.isLoading === true) return <>{props.children(props.placeholder, true)}</>
    if (props.slot.isForbidden === true) return props.forbidden === "hide" ? null : <EmptyNotice message={props.labels.forbidden} />
    if (props.slot.isError === true) return <EmptyNotice message={props.labels.error} actionLabel={props.labels.retry} onAction={props.onRetry} />
    const items = props.slot.items
    if (items === undefined || (Array.isArray(items) && items.length === 0)) return <EmptyNotice message={props.labels.empty} />
    return <>{props.children(items, false)}</>
}
