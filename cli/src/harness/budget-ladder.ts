import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { olderThan } from "./coordinator-liveness.js"
import { locateOps } from "./ops.js"

const budgetSchema = z.strictObject({
    graceMinutes: z.number().nonnegative(),
    prompt: z.string().min(1),
})

/** The `budget` block of ops/liveness.yaml: how long an Op asked to wrap up at its budget has before it is fenced, and what it is asked. */
export type BudgetLadder = z.infer<typeof budgetSchema>

const loaded = new Map<string, BudgetLadder>()

/** Loads and validates the `budget` block of ops/liveness.yaml (STARCI_OPS_DIR honoured); read once per process. */
export const loadBudgetLadder = (dir: string = locateOps()): BudgetLadder => {
    const known = loaded.get(dir)
    if (known !== undefined) return known
    const file = join(dir, "liveness.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = z.looseObject({ budget: budgetSchema }).safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} budget block is invalid: ${z.prettifyError(parsed.error)}`)
    loaded.set(dir, parsed.data.budget)
    return parsed.data.budget
}

/** The event the ladder records when it asks an Op past its budget to wrap up (subject: the task; data.attempt names the attempt). */
export const BUDGET_NUDGED = "budget-nudged"

/** The outcome of an attempt the ladder fenced past its budget and grace; it spends its try. */
export const OVER_BUDGET = "over-budget"

/** The ladder's next step for a running attempt: inside its budget, asked now, waiting out its grace, or fenced. */
export type BudgetStep =
    | { readonly kind: "within" }
    | { readonly kind: "nudge" }
    | { readonly kind: "grace"; readonly detail: string }
    | { readonly kind: "fence"; readonly detail: string }

/**
 * The budget ladder of one running attempt, from when it started, its contract's budget.minutes and when it was asked to wrap
 * up: inside the budget nothing happens; past it the worker is asked once for its result; graceMinutes after that ask with no
 * result filed, the attempt is fenced. A result filed in the grace ends the attempt's run, so the ladder never sees it again.
 */
export const budgetStep = (startedAt: string, budgetMinutes: number, nudgedAt: string | null, rules: BudgetLadder, at: number = Date.now()): BudgetStep => {
    if (!olderThan(startedAt, budgetMinutes, at)) return { kind: "within" }
    if (nudgedAt === null) return { kind: "nudge" }
    if (!olderThan(nudgedAt, rules.graceMinutes, at)) return { kind: "grace", detail: `asked to wrap up at ${nudgedAt}; fenced after ${String(rules.graceMinutes)} min` }
    return { kind: "fence", detail: `past its budget of ${String(budgetMinutes)} min and ${String(rules.graceMinutes)} min of grace since it was asked at ${nudgedAt}` }
}
