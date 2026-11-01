/** The flags no member of `DataSlot` sets: reading one is allowed and gives `undefined`. */
interface Unset {
    readonly isLoading?: undefined
    readonly isError?: undefined
    readonly isForbidden?: undefined
    readonly isEmpty?: undefined
    readonly isValidating?: undefined
}

/**
 * The status of one read (FE-ERROR-1), a union over the flags so an impossible mix (loading and error together) cannot be built.
 * Only `slotOfSwr`, `slotOfReads`, `mapSlot` and `loadingSlot` build one. `items` exists only on the ready member. `isLoading` is a
 * first load with no data. `isValidating` is a refresh beside data: the content stays and no skeleton is drawn. `isEmpty` is a
 * finished read with nothing, never a failed one. Every field is an atom, so a slot crosses into a pure half; a region with two
 * reads carries two slots, and each one shows its own status.
 */
export type DataSlot<T> =
    | (Omit<Unset, "isLoading"> & { readonly isLoading: true })
    | (Omit<Unset, "isForbidden"> & { readonly isForbidden: true })
    | (Omit<Unset, "isError"> & { readonly isError: true })
    | (Omit<Unset, "isEmpty" | "isValidating"> & { readonly isEmpty: true; readonly isValidating?: boolean })
    | (Omit<Unset, "isValidating"> & { readonly items: T; readonly isValidating?: boolean })

/** The resolved copy of the status view for one slot: the shared status sentences plus the region's own empty sentence. */
export interface SlotLabels {
    readonly empty: string
    readonly forbidden: string
    readonly error: string
    readonly retry: string
}
