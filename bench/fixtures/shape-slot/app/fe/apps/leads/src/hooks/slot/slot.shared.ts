import type { DataSlot } from "@/modules/types"

/** What one SWR read reports, the part a slot folds. */
interface SwrRead<T> {
    readonly data?: T | undefined
    readonly isLoading: boolean
    readonly error?: unknown
}

/** A slot in its loading status: the region draws its placeholder through SlotView, the skeleton story's one input. */
export const loadingSlot = <T>(): DataSlot<T> => ({ isLoading: true })

/** Folds one SWR read into its slot; a forbidden read is the error the transport tagged as such. */
export const slotOfSwr = <T>(read: SwrRead<T>, isForbidden: boolean): DataSlot<T> => {
    if (read.isLoading) return loadingSlot<T>()
    if (read.error !== undefined) return isForbidden ? { isForbidden: true } : { isError: true }
    return { items: read.data }
}
