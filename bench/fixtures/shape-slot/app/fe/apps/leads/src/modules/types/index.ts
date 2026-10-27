/** The status of one read; none of the flags set and no items means the read settled empty. */
export interface DataSlot<T> {
    readonly items?: T | undefined
    readonly isLoading?: boolean
    readonly isError?: boolean
    readonly isForbidden?: boolean
}

/** The resolved copy of the status recipe for one slot, from the shared status namespace. */
export interface SlotLabels {
    readonly empty: string
    readonly error: string
    readonly forbidden: string
    readonly retry: string
}

/** One lead as the board draws it; a lead nobody owns has no owner name. */
export interface LeadRow {
    readonly id: string
    readonly name: string
    readonly stage: string
    readonly ownerName?: string | undefined
}

/** One person a lead can be handed to. */
export interface OwnerOption {
    readonly id: string
    readonly name: string
}
