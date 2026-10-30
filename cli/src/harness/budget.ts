import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { findLedgerId, now, openExistingLedger } from "./ledger.js"
import { readMachine, textOf, withMachine } from "./machine.js"
import { loadRouting } from "./routing.js"

/**
 * Attempt outcomes that spent no try and no minutes: the launch certainly failed (a dispatch that never started its turn among
 * them, and an agent blocked at a prompt), Orca fenced its caller (consumer-fenced, a harness error), launched the wrong model, or lost its task mid-launch. Only attempts burn minutes, from launch to their result or
 * fence: a workflow waiting on an escalation or a coordinator burns none, and the stall ladder bounds an Op idle at its prompt.
 */
export const CONSUMER_FENCED_OUTCOME = "consumer-fenced"

const FREE_OUTCOMES: readonly string[] = ["launch-failed", "blocked-prompt", CONSUMER_FENCED_OUTCOME, "model-mismatch", "orphaned"]

/** A workflow's minutes and tries: its ceiling (the ops default, or as raised) against what its attempts used. */
export interface WorkflowBudget {
    readonly ledgerId: string
    readonly workflow: string
    readonly ceiling: { readonly minutes: number; readonly tries: number }
    readonly used: { readonly minutes: number; readonly tries: number }
    readonly raised: boolean
    readonly exhausted: readonly ("minutes" | "tries")[]
}

const ceilingOf = (machine: DatabaseSync | undefined, ledgerId: string, workflow: string): { minutes: number; tries: number; raised: boolean } => {
    const defaults = loadRouting().budgets.workflow
    const row = machine?.prepare("SELECT minutes, tries FROM budgets WHERE ledger_id = ? AND workflow_id = ?").get(ledgerId, workflow)
    return row === undefined ? { ...defaults, raised: false } : { minutes: Number(row.minutes), tries: Number(row.tries), raised: true }
}

/** What a workflow's attempts used: every attempt that spent a try, and their wall-clock minutes (a running one up to now). */
const usedBy = (ledger: DatabaseSync, workflow: string, at: string): { minutes: number; tries: number } => {
    const marks = FREE_OUTCOMES.map(() => "?").join(", ")
    const row = ledger
        .prepare(
            `SELECT COUNT(*) AS tries, COALESCE(SUM((julianday(COALESCE(a.ended_at, ?)) - julianday(a.started_at)) * 1440), 0) AS minutes
             FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE t.workflow_id = ? AND (a.outcome IS NULL OR a.outcome NOT IN (${marks}))`,
        )
        .get(at, workflow, ...FREE_OUTCOMES)
    return { tries: Number(row?.tries ?? 0), minutes: Math.round(Number(row?.minutes ?? 0) * 10) / 10 }
}

const budgetOf = (machine: DatabaseSync | undefined, ledger: DatabaseSync, ledgerId: string, workflow: string, at: string): WorkflowBudget => {
    const { raised, ...ceiling } = ceilingOf(machine, ledgerId, workflow)
    const used = usedBy(ledger, workflow, at)
    const exhausted = (["minutes", "tries"] as const).filter((key) => used[key] >= ceiling[key])
    return { ledgerId, workflow, ceiling, used, raised, exhausted }
}

const workflowsOf = (ledger: DatabaseSync): string[] =>
    ledger
        .prepare("SELECT id FROM workflows UNION SELECT DISTINCT workflow_id FROM tasks WHERE workflow_id IS NOT NULL ORDER BY 1")
        .all()
        .map((row) => textOf(row.id) ?? "")
        .filter((id) => id !== "")

/** The budgets of this project's workflows (or one of them); reads only and creates nothing. */
export const workflowBudgets = (root: string, workflow?: string, at: string = now()): { readonly ledgerId: string | null; readonly budgets: WorkflowBudget[] } => {
    const ledgerId = findLedgerId(root)
    const ledger = openExistingLedger(root)
    if (ledgerId === undefined || ledger === undefined) {
        if (workflow !== undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflow}: this project has no ledger yet`)
        return { ledgerId: null, budgets: [] }
    }
    try {
        const ids = workflowsOf(ledger)
        if (workflow !== undefined && !ids.includes(workflow)) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflow} in this project's ledger`)
        const wanted = workflow === undefined ? ids : [workflow]
        const read = (machine: DatabaseSync | undefined): WorkflowBudget[] => wanted.map((id) => budgetOf(machine, ledger, ledgerId, id, at))
        return { ledgerId, budgets: readMachine<WorkflowBudget[] | undefined>(read, undefined) ?? read(undefined) }
    } finally {
        ledger.close()
    }
}

/** Refuses BUDGET_EXHAUSTED when a workflow has used its minutes or tries: dispatch holds until the owner or Supervisor raises it. */
export const assertWorkflowBudget = (root: string, workflow: string): WorkflowBudget => {
    const budget = workflowBudgets(root, workflow).budgets[0]
    if (budget === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflow} in this project's ledger`)
    if (budget.exhausted.length > 0) {
        const spent = budget.exhausted.map((key) => `${key} ${String(budget.used[key])} of ${String(budget.ceiling[key])}`).join(", ")
        throw new Refusal("BUDGET_EXHAUSTED", `workflow ${workflow} has used its budget (${spent}); dispatch holds until the owner or the Supervisor runs: starci budget raise ${workflow} --minutes <n>|--tries <n> --reason <why> (as the owner or the Supervisor)`)
    }
    return budget
}

/** Who may raise a budget. */
export const RAISERS = ["owner", "supervisor"] as const

/** Raises a workflow's ceilings by the given minutes and tries; who and why are kept in budget_raises. */
export const raiseWorkflowBudget = (
    root: string,
    workflow: string,
    raise: { readonly minutes: number; readonly tries: number; readonly by: (typeof RAISERS)[number]; readonly reason: string },
    at: string = now(),
): { readonly before: WorkflowBudget; readonly after: WorkflowBudget } => {
    const before = workflowBudgets(root, workflow, at).budgets[0]
    if (before === undefined) throw new Refusal("WORKFLOW_UNKNOWN", `no workflow ${workflow} in this project's ledger`)
    withMachine((machine) => {
        // Read the ceiling again under the write lock, so two raises at once both count.
        const current = ceilingOf(machine, before.ledgerId, workflow)
        machine
            .prepare(
                `INSERT INTO budgets (ledger_id, workflow_id, minutes, tries, updated_at) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(ledger_id, workflow_id) DO UPDATE SET minutes = excluded.minutes, tries = excluded.tries, updated_at = excluded.updated_at`,
            )
            .run(before.ledgerId, workflow, current.minutes + raise.minutes, current.tries + raise.tries, at)
        machine
            .prepare("INSERT INTO budget_raises (ledger_id, workflow_id, by, reason, minutes_by, tries_by, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(before.ledgerId, workflow, raise.by, raise.reason, raise.minutes, raise.tries, at)
    })
    const after = workflowBudgets(root, workflow, at).budgets[0] ?? before
    return { before, after }
}
