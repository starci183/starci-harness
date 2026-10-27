/**
 * What every block story shares: the status copy, a ready and a loading slot, and inert actions. Each story spells its
 * `parameters: { dna: { pair, phase } }` literally, so a skeleton-parity gate can read it without running the file.
 */
import { SLOT } from "../src/modules/i18n"
import type { DataSlot, SlotLabels } from "../src/modules/types"

export const slotLabels = (empty: string, emptyHint?: string): SlotLabels => ({
    empty,
    ...(emptyHint === undefined ? {} : { emptyHint }),
    forbidden: SLOT.forbidden,
    error: SLOT.error,
    retry: SLOT.retry,
})

export const ready = <T>(items: T): DataSlot<T> => ({ items })

export const loading = <T>(): DataSlot<T> => ({ items: undefined, isLoading: true })

/** An action a story never needs to answer. */
export const noop = (): void => undefined

