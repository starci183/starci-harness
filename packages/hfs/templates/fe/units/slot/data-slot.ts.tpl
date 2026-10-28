/**
 * The data status of one read (FE-ERROR-1). Every field is an atom, so a slot crosses into a pure half; a region with
 * two reads carries two slots, and each one shows its own status. No flag set and no items means empty.
 */
export interface DataSlot<T> {
    readonly items: T | undefined
    readonly isLoading?: boolean
    readonly isError?: boolean
    readonly isForbidden?: boolean
}

/** The resolved copy of the status view for one slot: the shared status sentences plus the region's own empty sentence. */
export interface SlotLabels {
    readonly empty: string
    readonly forbidden: string
    readonly error: string
    readonly retry: string
}
