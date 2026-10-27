import { ApiError } from "../../modules/api"
import type { DataSlot } from "../../modules/types"

/** The part of a query result a slot is folded from. */
interface SlotSource<T> {
    readonly data: T | undefined
    readonly isLoading: boolean
    readonly error: Error | null
}

const statusOf = (error: Error | null): number | null => (error instanceof ApiError ? error.status : null)

/**
 * Folds one read into a slot. 403 is its own status; 404 (a workflow, task or decision that is not there) is the region's
 * empty sentence; any other failure is an error only while there is no earlier answer to keep showing.
 */
export const slotOfQuery = <T>(source: SlotSource<T>): DataSlot<T> => {
    const status = statusOf(source.error)
    if (status === 404) return { items: undefined }
    if (status === 403) return { items: undefined, isForbidden: true }
    if (source.data !== undefined) return { items: source.data }
    if (source.error !== null) return { items: undefined, isError: true }
    return { items: undefined, isLoading: source.isLoading }
}

/** Carries a slot's status over to the view made of its items. */
export const mapSlot = <T, U>(slot: DataSlot<T>, view: (items: T) => U): DataSlot<U> => ({
    ...slot,
    items: slot.items === undefined ? undefined : view(slot.items),
})

/** A slot that is still waiting, for a story or a part whose read has not started. */
export const loadingSlot = <T>(): DataSlot<T> => ({ items: undefined, isLoading: true })
