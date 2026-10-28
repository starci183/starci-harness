import type { DataSlot } from "@/modules/types"

/**
 * The part of an operation's GraphQLResponse a slot reads: whether it succeeded, its value and the refusal kind. Only hooks/swr
 * imports an operation's types, so the slot owner reads the outcome by these fields alone.
 */
interface SettledRead<T> {
    readonly success: boolean
    readonly data?: T
    readonly kind?: string
}

/** What an SWR read of one operation hands its caller: the operation's outcome, the fetch error and whether it is on its way. */
interface SwrRead<T> {
    readonly data: SettledRead<T> | undefined
    readonly error?: unknown
    readonly isLoading: boolean
}

/** Folds one SWR read into its slot: a refusal of kind `forbidden` is its own status, every other failure is an error. */
export const slotOfSwr = <T>(read: SwrRead<T>): DataSlot<T> => {
    if (read.isLoading) return { items: undefined, isLoading: true }
    if (read.data === undefined) return { items: undefined, isError: read.error !== undefined }
    if (read.data.success) return { items: read.data.data }
    return read.data.kind === "forbidden" ? { items: undefined, isForbidden: true } : { items: undefined, isError: true }
}

/** Carries a slot's status over to the view made of its items. */
export const mapSlot = <T, U>(slot: DataSlot<T>, map: (items: T) => U): DataSlot<U> => ({
    ...slot,
    items: slot.items === undefined ? undefined : map(slot.items),
})

/** The slot of a read still on its way: what a skeleton story and a region waiting on its owner render. */
export const loadingSlot = <T>(): DataSlot<T> => ({ items: undefined, isLoading: true })
