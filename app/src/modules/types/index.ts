/**
 * The status recipe's two types (FE-ERROR-1, decision F-1). A read is folded into a `DataSlot` by `slotOfQuery`, several by `slotOfReads`; a block's
 * pure half renders it through `components/composites/SlotView` and never branches on a status flag itself.
 */

/** The flags no member of `DataSlot` sets: reading one is allowed and gives `undefined`. */
interface Unset {
    readonly isLoading?: undefined
    readonly isError?: undefined
    readonly isForbidden?: undefined
    readonly isEmpty?: undefined
    readonly isValidating?: undefined
}

/**
 * The status of ONE read (FE-ERROR-1), a union over the flags so an impossible mix (loading and error together) cannot be built, and
 * built only by `slotOfQuery`, `slotOfReads`, `mapSlot` and `loadingSlot`. `items` exists only on the ready member. `isLoading` is a
 * first load with no data. `isValidating` is a refresh beside data: the content stays and no skeleton is drawn. `isEmpty` is a
 * finished read with nothing, never a failed one.
 */
export type DataSlot<T> =
    | (Omit<Unset, "isLoading"> & { readonly isLoading: true })
    | (Omit<Unset, "isForbidden"> & { readonly isForbidden: true })
    | (Omit<Unset, "isError"> & { readonly isError: true })
    | (Omit<Unset, "isEmpty" | "isValidating"> & { readonly isEmpty: true; readonly isValidating?: boolean })
    | (Omit<Unset, "isValidating"> & { readonly items: T; readonly isValidating?: boolean })

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
