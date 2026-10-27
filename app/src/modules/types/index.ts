/**
 * The status recipe's two types (FE-ERROR-1, decision F-1). A read is folded into a `DataSlot` by `slotOfQuery`; a block's
 * pure half renders it through `components/composites/SlotView` and never branches on a status flag itself.
 */

/** The data status of ONE read; none of the flags set means `items` is the answer (empty when it holds nothing). */
export interface DataSlot<T> {
    readonly items: T | undefined
    readonly isLoading?: boolean
    readonly isError?: boolean
    readonly isForbidden?: boolean
}

/** The resolved copy of the status recipe for one region: the shared words plus the region's own empty sentence. */
export interface SlotLabels {
    readonly empty: string
    readonly emptyHint?: string
    readonly forbidden: string
    readonly error: string
    readonly retry: string
}

/** A status word and its tone, resolved for drawing. */
export interface ToneLabel {
    readonly label: string
    readonly tone: "neutral" | "accent" | "success" | "warning" | "danger"
}

/** The outcome of one write, resolved for drawing: its tone, title and words. */
export interface ResultNotice {
    /** Increments per write, so the same words twice still show as a fresh notice. */
    readonly n: number
    readonly isOk: boolean
    readonly title: string
    readonly description: string
}
