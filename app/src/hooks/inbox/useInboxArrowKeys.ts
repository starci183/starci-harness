import type { Decision } from "@contract"
import { useEffect } from "react"
import { decisionKey } from "./inbox.shared"

/** Arrow keys belong to these targets (text fields and other arrow-key widgets), not to the inbox selection. */
const ownsArrowKeys = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
        target.closest("input, textarea, select, [role='radiogroup'], [role='tablist'], [role='menu'], [role='dialog']") !== null)

/** Up and down move the inbox selection from anywhere on the page; inside the list the vendor also moves focus with it. */
export const useInboxArrowKeys = (decisions: readonly Decision[], index: number, select: (key: string) => void): void => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
            if (event.altKey || event.ctrlKey || event.metaKey || ownsArrowKeys(event.target)) return
            const next = decisions[Math.min(decisions.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))]
            if (next === undefined) return
            select(decisionKey(next))
            if (!(event.target instanceof HTMLElement && event.target.closest("[role='listbox']") !== null)) event.preventDefault()
        }
        window.addEventListener("keydown", onKeyDown, true)
        return () => window.removeEventListener("keydown", onKeyDown, true)
    }, [decisions, index, select])
}
