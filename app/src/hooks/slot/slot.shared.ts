import { ApiError } from "../../modules/api"
import type { DataSlot } from "../../modules/types"

/** The part of a query result a slot is folded from. */
export interface SlotSource<T> {
    readonly data: T | undefined
    readonly isLoading: boolean
    /** A refresh in flight; it rides beside data and never draws a skeleton. */
    readonly isValidating?: boolean
    readonly error: Error | null
}

const statusOf = (error: Error | null): number | null => (error instanceof ApiError ? error.status : null)

/**
 * Folds one read into a slot. A first read with no data is `loading` (a refresh that already has data stays `ready`). 403 is its
 * own stage; 404 (a workflow, task or decision that is not there) is `empty`, the region's sentence; any other failure is an
 * `error` only while there is no earlier answer to keep showing.
 */
export const slotOfQuery = <T>(source: SlotSource<T>): DataSlot<T> => {
    const status = statusOf(source.error)
    if (status === 404) return { isEmpty: true }
    if (status === 403) return { isForbidden: true }
    if (source.data !== undefined) return source.isValidating === true ? { items: source.data, isValidating: true } : { items: source.data }
    if (source.error !== null) return { isError: true }
    return source.isLoading ? { isLoading: true } : { isEmpty: true }
}

/** Carries a slot's stage over to the view made of its items. */
export const mapSlot = <T, U>(slot: DataSlot<T>, view: (items: T) => U): DataSlot<U> =>
    "items" in slot ? { ...slot, items: view(slot.items) } : slot

/** A slot that is still waiting, for a story or a part whose read has not started. */
export const loadingSlot = <T>(): DataSlot<T> => ({ isLoading: true })

/**
 * Folds EVERY read a frame draws into one slot in a single pass (contexts/ui/loading.md, `no-foreign-slot-status`). A frame never
 * borrows the status of one of its reads for the others. `view` gets the reads and builds the frame's items from their data.
 *
 * - `isError` (or `isForbidden`) when a read failed with no data of its own: a failure never reads as empty;
 * - `isLoading` when any read is loading with no data, unless the frame `hasDrawn` (latched): after the first draw a read that
 *   reloads on a key change leaves the frame standing, and the region keyed by that read shows its own loading;
 * - `isEmpty` when every read finished with nothing; otherwise `ready` with `view(reads)` (a read's `data` is `undefined` where it
 *   has none yet, only possible after the first draw).
 */
export const slotOfReads = <Reads extends Readonly<Record<string, SlotSource<unknown>>>, V>(
    reads: Reads,
    view: (reads: Reads) => V,
    hasDrawn = false,
): DataSlot<V> => {
    const slots = Object.values(reads).map((read) => slotOfQuery(read))
    if (slots.some((slot) => slot.isError === true)) return { isError: true }
    if (slots.some((slot) => slot.isForbidden === true)) return { isForbidden: true }
    if (slots.some((slot) => slot.isLoading === true) && !hasDrawn) return { isLoading: true }
    if (slots.every((slot) => slot.isEmpty === true)) return { isEmpty: true }
    const isValidating = Object.values(reads).some((read) => read.isValidating === true)
    return isValidating ? { items: view(reads), isValidating: true } : { items: view(reads) }
}
