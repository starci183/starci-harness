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
export interface SwrRead<T> {
    readonly data: SettledRead<T> | undefined
    readonly error?: unknown
    /** SWR's first load with no data. */
    readonly isLoading: boolean
    /** SWR's refresh beside data. It rides on the slot and never draws a skeleton. */
    readonly isValidating?: boolean
}

/**
 * Folds one SWR read into its slot: a first load with no data is `isLoading` (a refresh keeps the data), a refusal of kind `forbidden`
 * is its own status, every other failure is an error. A refresh beside data is `isValidating`.
 */
export const slotOfSwr = <T>(read: SwrRead<T>): DataSlot<T> => {
    if (read.isLoading) return { isLoading: true }
    if (read.data === undefined) return read.error !== undefined ? { isError: true } : { isEmpty: true }
    if (read.data.success && read.data.data !== undefined) return read.isValidating === true ? { items: read.data.data, isValidating: true } : { items: read.data.data }
    if (read.data.success) return { isEmpty: true }
    return read.data.kind === "forbidden" ? { isForbidden: true } : { isError: true }
}

/** Carries a slot's status over to the view made of its items. */
export const mapSlot = <T, U>(slot: DataSlot<T>, map: (items: T) => U): DataSlot<U> =>
    "items" in slot ? { ...slot, items: map(slot.items) } : slot

/** The slot of a read still on its way: what a skeleton story and a region waiting on its owner render. */
export const loadingSlot = <T>(): DataSlot<T> => ({ isLoading: true })

/** The part of an SWR read a frame folds with its other reads. */
export interface FrameRead<T> {
    readonly data: T | undefined
    readonly isLoading: boolean
    readonly error?: unknown
    readonly isValidating?: boolean
}

const slotOfFrameRead = <T>(read: FrameRead<T>): DataSlot<T> => {
    if (read.data !== undefined) return read.isValidating === true ? { items: read.data, isValidating: true } : { items: read.data }
    if (read.error !== undefined) return { isError: true }
    return read.isLoading ? { isLoading: true } : { isEmpty: true }
}

/**
 * Folds EVERY read a frame draws into one slot in a single pass. A frame never borrows the status of one of its reads for the others
 * (lint `no-foreign-slot-status`), and never folds a read to `[]` (`no-swr-default-array`). `view` gets the reads and builds the items.
 *
 * - `isError` when a read failed with no data of its own: a failure never reads as empty;
 * - `isLoading` when any read is loading with no data, unless the frame `hasDrawn` (latched after the first draw): a read that
 *   reloads on a key change leaves the frame standing, and the region keyed by that read shows its own loading;
 * - `isEmpty` when every read finished with nothing; otherwise the items, `view(reads)`.
 */
export const slotOfReads = <Reads extends Readonly<Record<string, FrameRead<unknown>>>, V>(
    reads: Reads,
    view: (reads: Reads) => V,
    hasDrawn = false,
): DataSlot<V> => {
    const slots = Object.values(reads).map((read) => slotOfFrameRead(read))
    if (slots.some((slot) => slot.isError === true)) return { isError: true }
    if (slots.some((slot) => slot.isLoading === true) && !hasDrawn) return { isLoading: true }
    if (slots.every((slot) => slot.isEmpty === true)) return { isEmpty: true }
    const items = view(reads)
    return Object.values(reads).some((read) => read.isValidating === true) ? { items, isValidating: true } : { items }
}
