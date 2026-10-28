import { RAISERS, raiseWorkflowBudget } from "../../harness/budget.js"
import type { WorkflowBudget } from "../../harness/budget.js"
import { inTransaction, openLedger } from "../../harness/ledger.js"
import { raiseNodeTries } from "../../harness/workflow.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

const amount = (name: string, value: string | undefined): number => {
    if (value === undefined) return 0
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Refusal("CLI_USAGE", `--${name} is a positive whole number, not "${value}"`, EXIT_USAGE)
    return parsed
}

/** What a raise did: the workflow's ceiling before and after, or (with --task) the task's try budget before and after. */
interface RaiseData {
    readonly before?: WorkflowBudget
    readonly after?: WorkflowBudget
    readonly workflow?: string
    readonly task?: { readonly key: string; readonly task: string | null; readonly before: number; readonly after: number }
}

/** Who may raise one task's tries (`--task`): the raisers of a workflow's ceiling, and the workflow's Kernel for a task the harness exhausted. */
const TASK_RAISERS = [...RAISERS, "kernel"] as const

/**
 * `starci budget raise <workflow>`: raises a workflow's minutes or tries ceiling (owner or Supervisor), or with `--task` one task's
 * try budget over its contract's `budget.tries` (owner, Supervisor, or its Kernel), the route out of TRIES_EXHAUSTED for a single
 * task, a harness-caused exhaustion above all; who and why are kept.
 */
export const budgetRaiseVerb = defineVerb({
    path: ["budget", "raise"],
    summary: "raise a workflow's minutes or tries ceiling (owner or Supervisor), or with --task one task's tries (owner, Supervisor or its Kernel: the way out of TRIES_EXHAUSTED); who and why are kept",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor", "kernel"],
    schema: "starci/budget-raise@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        minutes: { kind: "string", summary: "add this many minutes to the ceiling" },
        tries: { kind: "string", summary: "add this many tries to the ceiling, or with --task to that task's try budget" },
        task: { kind: "string", summary: "raise the tries of this one task (its plan key or a ledger task id) instead of the workflow's ceiling" },
        by: { kind: "string", summary: `who raises it: ${RAISERS.join(" or ")}, or kernel with --task`, required: true },
        reason: { kind: "string", summary: "why the workflow or task needs more", required: true },
    },
    run: async (context, flags): Promise<{ readonly data: RaiseData; readonly message: string }> => {
        const minutes = amount("minutes", flags.minutes)
        const tries = amount("tries", flags.tries)
        if (flags.reason.trim() === "") throw new Refusal("CLI_USAGE", "--reason must say why", EXIT_USAGE)
        const root = await repositoryRoot(context.cwd)
        if (flags.task !== undefined) {
            const by = TASK_RAISERS.find((role) => role === flags.by)
            if (by === undefined) throw new Refusal("ROLE_REFUSED", `only ${TASK_RAISERS.join(", ")} raise a task's tries, not "${flags.by}"`)
            if (tries === 0 || minutes !== 0) throw new Refusal("CLI_USAGE", "--task raises tries only: give --tries", EXIT_USAGE)
            const named = flags.task
            const db = openLedger(root)
            try {
                const raised = inTransaction(db, () => {
                    const key = named.startsWith("t-") ? db.prepare("SELECT plan_key FROM tasks WHERE id = ? AND workflow_id = ?").get(named, flags.workflow)?.plan_key : named
                    if (typeof key !== "string" || key === "") throw new Refusal("TASK_UNKNOWN", `workflow ${flags.workflow} has no task ${named}`)
                    return { key, ...raiseNodeTries(db, flags.workflow, key, { tries, by, reason: flags.reason.trim() }) }
                })
                return {
                    data: { workflow: flags.workflow, task: raised },
                    message: `workflow ${flags.workflow}, task ${raised.key}${raised.task === null ? "" : ` (last ${raised.task})`}: tries ${String(raised.before)} -> ${String(raised.after)} (by ${by}: ${flags.reason.trim()}); its retry dispatches now`,
                }
            } finally {
                db.close()
            }
        }
        const by = RAISERS.find((role) => role === flags.by)
        if (by === undefined) throw new Refusal("ROLE_REFUSED", `only ${RAISERS.join(" or ")} raise a workflow's budget, not "${flags.by}"; a Kernel raises one task's tries with --task`)
        if (minutes === 0 && tries === 0) throw new Refusal("CLI_USAGE", "give --minutes, --tries or both", EXIT_USAGE)
        const raised = raiseWorkflowBudget(root, flags.workflow, { minutes, tries, by, reason: flags.reason.trim() })
        const { before, after } = raised
        return {
            data: raised,
            message: `workflow ${flags.workflow}: minutes ${String(before.ceiling.minutes)} -> ${String(after.ceiling.minutes)}, tries ${String(before.ceiling.tries)} -> ${String(after.ceiling.tries)} (by ${by}: ${flags.reason.trim()})`,
        }
    },
})
