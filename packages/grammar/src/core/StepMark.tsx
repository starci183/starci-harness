import type { ReactNode } from "react"
import { MARK_STATE_TONE, StatusGlyph, StatusTile, type MarkState } from "./statusMark.js"

/** The state a step is in. The mark is decorative: the app says the state in words too (title or meta). */
export type StepState = "done" | "current" | "problem" | "todo"

/** The step at the start of a row: its state and, for a number, its position. */
export type StepLeading = { readonly state: StepState; readonly position?: number }

/** The status of a checklist step (0.55.0, case 1): done the check, problem the x, todo the plain ring; the current step is the reader's own. */
const STEP_MARK: Readonly<Record<Exclude<StepState, "current">, MarkState>> = { done: "done", problem: "error", todo: "notRun" }

/**
 * The step mark of a setup checklist or a step disclosure (0.55.0, the status-mark rule, case 1 "how far along is it?"): the round 40px status
 * tile with the STATUS glyph in the state's tone (check, x, the small ring); the current step, the reader's own, is its number on the accent plate.
 */
export const StepMark = ({ state, position, isLoading = false }: { readonly state: StepState; readonly position?: number | undefined; readonly isLoading?: boolean }): ReactNode => (
    <span className="starci-core-accordion-step" data-grammar-step-state={isLoading ? "todo" : state} aria-hidden="true">
        {isLoading ? null : state === "current" ? <StatusTile tone="info">{position}</StatusTile> : (
            <StatusTile tone={MARK_STATE_TONE[STEP_MARK[state]]} state={STEP_MARK[state]}><StatusGlyph kind={STEP_MARK[state]} /></StatusTile>
        )}
    </span>
)
