import { SLOT } from "../../modules/i18n"
import type { SlotLabels } from "../../modules/types"

/** Resolves the shared status copy once, adding the region's own empty sentence. */
export const useSlotLabels = () => (empty: string, emptyHint?: string): SlotLabels => ({
    empty,
    ...(emptyHint === undefined ? {} : { emptyHint }),
    forbidden: SLOT.forbidden,
    error: SLOT.error,
    retry: SLOT.retry,
})
