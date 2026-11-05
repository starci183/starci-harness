import type { ReactNode } from "react"

/** The state a step is in. The mark is decorative: the app says the state in words too (title or meta). */
export type StepState = "done" | "current" | "problem" | "todo"

/** The step at the start of a row: its state and, for a number, its position. */
export type StepLeading = { readonly state: StepState; readonly position?: number }

/** The step mark: a check, the current number, a warning triangle or a grey number, in a 24px circle. */
export const StepMark = ({ state, position, isLoading = false }: { readonly state: StepState; readonly position?: number | undefined; readonly isLoading?: boolean }): ReactNode => (
    <span className="starci-core-accordion-step" data-grammar-step-state={isLoading ? "todo" : state} aria-hidden="true">
        {isLoading ? null : state === "done" ? (
            <svg viewBox="0 0 20 20" focusable="false"><path d="M5 10.5 8.25 14 15 6.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
        ) : state === "problem" ? (
            <svg viewBox="0 0 20 20" focusable="false"><path d="M10 4 18 17H2L10 4Zm0 4.5v4m0 2v.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></svg>
        ) : <span>{position}</span>}
    </span>
)
