import { useEffect, useRef } from "react"
import type { DataSlot } from "../../modules/types"
import { slotOfReads, type SlotSource } from "./slot.shared"

/**
 * `slotOfReads` for a component: it remembers that the frame has drawn its content, so a read that reloads on a key change
 * (the open room, the page) leaves the frame standing. Only a first load with no data is `loading`.
 */
export const useSlotOfReads = <Reads extends Readonly<Record<string, SlotSource<unknown>>>, V>(
    reads: Reads,
    view: (reads: Reads) => V,
): DataSlot<V> => {
    const hasDrawn = useRef(false)
    const slot = slotOfReads(reads, view, hasDrawn.current)
    useEffect(() => {
        if ("items" in slot) hasDrawn.current = true
    }, [slot])
    return slot
}
