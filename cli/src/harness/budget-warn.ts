import type { DatabaseSync } from "node:sqlite"
import { workflowBudgets } from "./budget.js"
import type { WorkflowBudget } from "./budget.js"
import { openExistingLedger } from "./ledger.js"
import { registeredRepositories } from "./project-workers.js"
import { loadRouting } from "./routing.js"
import { inOrder } from "./sequential.js"
import { closeTicket, keyedFingerprint, liveTicketOf, openTicket } from "./tickets.js"
import type { Ticket, TicketKind } from "./tickets.js"
import { hasGraphTables, snapshotOf } from "./workflow.js"
import type { WorkflowStatus } from "./workflow.js"
import { projectOf } from "./work.js"

/** Why a workflow is near its ceiling: its minutes or tries at ops/routing.yaml budgets.nearPercent of it or past, or fewer tries left than tasks to run. */
export type NearReason = "minutes" | "tries" | "tasks"

/** A workflow's budget with what is left to run: its tasks done and remaining, why it is near its ceiling, and the raise that would carry it through. */
export interface BudgetOutlook extends WorkflowBudget {
    /** exhausted once it used a ceiling, else near once `near` names a reason, else ok. */
    readonly state: "ok" | "near" | "exhausted"
    readonly tasks: { readonly done: number; readonly remaining: number }
    /** Empty while the workflow is not near its ceiling, or has no task left to run. */
    readonly near: readonly NearReason[]
    /** The minutes and tries to add, sized to the remaining tasks at the pace of the done ones; null while not near. */
    readonly proposed: { readonly minutes: number; readonly tries: number } | null
}

/** The question a near workflow's ticket is filed as. */
const NEAR_KIND: TicketKind = "question:business"

/** A workflow that runs nothing more: its remaining nodes are not counted. */
const ENDED: readonly WorkflowStatus[] = ["done", "stopping", "stopped"]

/**
 * A workflow's graph nodes done and still to run, from its ledger; none to run for an ended workflow (its graph is not read) or
 * a workflow id the ledger holds no graph of.
 */
const tasksOf = (ledger: DatabaseSync, workflow: string): { readonly done: number; readonly remaining: number } => {
    const status = hasGraphTables(ledger) ? ledger.prepare("SELECT status FROM workflows WHERE id = ?").get(workflow)?.status : undefined
    if (typeof status !== "string" || ENDED.some((ended) => ended === status)) return { done: 0, remaining: 0 }
    const views = snapshotOf(ledger, workflow).views
    const done = views.filter((view) => view.state === "done").length
    return { done, remaining: views.length - done }
}

/**
 * The raise that carries the remaining tasks through at the done tasks' pace (at least one try each), sized so the workflow sits
 * at the near threshold once they ran: for each of minutes and tries, ceil((used + need) / nearPercent) - ceiling, never below 0.
 */
const proposedRaise = (budget: WorkflowBudget, tasks: { readonly done: number; readonly remaining: number }, fraction: number): { minutes: number; tries: number } => {
    const raise = (key: "minutes" | "tries", floor: number): number => {
        const pace = Math.max(floor, budget.used[key] / Math.max(1, tasks.done))
        const need = Math.ceil(tasks.remaining * pace)
        return Math.max(0, Math.ceil((budget.used[key] + need) / fraction) - budget.ceiling[key])
    }
    return { minutes: raise("minutes", 0), tries: raise("tries", 1) }
}

const outlookOf = (budget: WorkflowBudget, tasks: { readonly done: number; readonly remaining: number }, fraction: number): BudgetOutlook => {
    const near: NearReason[] =
        tasks.remaining === 0
            ? []
            : [...(["minutes", "tries"] as const).filter((key) => budget.used[key] >= budget.ceiling[key] * fraction), ...(budget.ceiling.tries - budget.used.tries < tasks.remaining ? (["tasks"] as const) : [])]
    const state = budget.exhausted.length > 0 ? "exhausted" : near.length > 0 ? "near" : "ok"
    return { ...budget, state, tasks, near, proposed: near.length === 0 ? null : proposedRaise(budget, tasks, fraction) }
}

/** The budgets of this project's workflows (or one of them) with what is left to run and whether each is near its ceiling; reads only. */
export const budgetOutlooks = (root: string, workflow?: string): { readonly ledgerId: string | null; readonly budgets: BudgetOutlook[] } => {
    const shown = workflowBudgets(root, workflow)
    const ledger = openExistingLedger(root)
    if (ledger === undefined) return { ledgerId: shown.ledgerId, budgets: [] }
    const fraction = loadRouting().budgets.nearPercent / 100
    try {
        return { ledgerId: shown.ledgerId, budgets: shown.budgets.map((budget) => outlookOf(budget, tasksOf(ledger, budget.workflow), fraction)) }
    } finally {
        ledger.close()
    }
}

/** The episode of a workflow's near question: one per ceiling, so a raise ends it and a later approach to the new ceiling asks again. */
const nearKey = (budget: WorkflowBudget): string => `budget-near:${budget.ledgerId}:${budget.workflow}:${String(budget.ceiling.minutes)}:${String(budget.ceiling.tries)}`

/** The raise a proposal adds, as `budget raise` flags. */
const raiseFlags = (proposed: BudgetOutlook["proposed"]): string[] => [
    ...(proposed === null || proposed.minutes === 0 ? [] : [`--minutes ${String(proposed.minutes)}`]),
    ...(proposed === null || proposed.tries === 0 ? [] : [`--tries ${String(proposed.tries)}`]),
]

/** How a budget's state reads in `budget show`: ok, exhausted and what, or near, why and the raise it proposes. */
export const stateLine = (outlook: BudgetOutlook): string => {
    if (outlook.state === "exhausted") return `exhausted: ${outlook.exhausted.join(", ")}`
    if (outlook.state === "near") return `near: ${outlook.near.join(", ")}; propose ${raiseFlags(outlook.proposed).join(" ")}`
    return "ok"
}

/** The `budget raise` a near workflow's question proposes. */
const raiseCommand = (outlook: BudgetOutlook, by: string): string => {
    return `starci budget raise ${outlook.workflow} ${raiseFlags(outlook.proposed).join(" ")} --by ${by} --reason "${String(outlook.tasks.remaining)} task(s) left"`
}

/** How a budget reads in one line: minutes and tries against the ceiling, and the tasks left. */
export const budgetLine = (outlook: BudgetOutlook): string =>
    `minutes ${String(outlook.used.minutes)}/${String(outlook.ceiling.minutes)}, tries ${String(outlook.used.tries)}/${String(outlook.ceiling.tries)}, ${String(outlook.tasks.remaining)} task(s) left`

/**
 * Answers the live near question of a workflow's budget as it stood before a raise (`budget raise`): the raise is its answer, by
 * whoever raised it and why. Returns the ticket answered, or null when none was open.
 */
export const answerNearTicket = (before: WorkflowBudget, after: WorkflowBudget, by: string, reason: string): Ticket | null => {
    const live = liveTicketOf(keyedFingerprint(NEAR_KIND, nearKey(before)))
    if (live === undefined) return null
    const answer = `raised: minutes ${String(before.ceiling.minutes)} -> ${String(after.ceiling.minutes)}, tries ${String(before.ceiling.tries)} -> ${String(after.ceiling.tries)}`
    return closeTicket(live.id, { state: "answered", answer, why: reason }, by).ticket
}

/**
 * The tick's budget round (`supervisor tick`): every workflow of every registered repository that is near its ceiling with tasks
 * left (`budgetOutlooks`) is asked once as a `question:business` ticket the owner answers on Telegram, opened as the Supervisor's
 * so his answer wakes it, with the raise sized to the remaining tasks as its proposed default; every later tick of the same
 * ceiling repeats it (occurrences bumped), and a raise answers it (`answerNearTicket`). A workflow no longer near (done, or its
 * tasks fit) has its live question answered by the tick. One line per workflow near its ceiling.
 */
export const tickBudgets = async (): Promise<string[]> => {
    const lines = await inOrder(registeredRepositories(), async (repo) => {
        try {
            const project = await projectOf(repo, false)
            return budgetOutlooks(repo).budgets.flatMap((outlook) => {
                if (outlook.near.length === 0) {
                    const live = liveTicketOf(keyedFingerprint(NEAR_KIND, nearKey(outlook)))
                    if (live !== undefined) closeTicket(live.id, { state: "answered", answer: "no raise needed", why: `workflow ${outlook.workflow} is no longer near its ceiling: ${budgetLine(outlook)}` }, "supervisor-tick")
                    return []
                }
                const question = `Workflow ${outlook.workflow} is near its budget (${outlook.near.join(", ")}): ${budgetLine(outlook)}. Raise it before it stops?`
                const { ticket, outcome } = openTicket({
                    kind: NEAR_KIND,
                    severity: "normal",
                    title: question,
                    evidence: { workflow: outlook.workflow, question },
                    tried: `the near threshold is ${String(loadRouting().budgets.nearPercent)}% of the ceiling (ops/routing.yaml budgets.nearPercent), or fewer tries left than tasks; the raise is sized to the remaining tasks at the done tasks' pace`,
                    proposedDefault: raiseCommand(outlook, "owner"),
                    options: ["hold: no raise; dispatch stops at the ceiling (BUDGET_EXHAUSTED)"],
                    project,
                    workflow: outlook.workflow,
                    by: "supervisor",
                    key: nearKey(outlook),
                    waiters: [],
                })
                return [`budget near: workflow ${outlook.workflow} (${outlook.near.join(", ")}; ${budgetLine(outlook)}): question ticket ${ticket.id} ${outcome === "opened" ? "opened" : `seen ${String(ticket.occurrences)} times`}, proposing: ${raiseCommand(outlook, "supervisor")}`]
            })
        } catch {
            return []
        }
    })
    return lines.flat()
}
