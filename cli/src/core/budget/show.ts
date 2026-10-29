import { budgetOutlooks, stateLine } from "../../harness/budget-warn.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/**
 * `starci budget show`: each workflow's minutes and tries against its ceiling and the tasks it has left, its state exhausted, near
 * (with why and the raise sized to its remaining tasks, harness/budget-warn.ts) or ok; reads only.
 */
export const budgetShowVerb = defineVerb({
    path: ["budget", "show"],
    summary: "each workflow of this project: minutes and tries used against its ceiling (the ops default or as raised), tasks left, and whether it is exhausted or near its ceiling",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/budget-show@1",
    flags: {
        workflow: { kind: "string", summary: "only this workflow", positional: true },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const shown = budgetOutlooks(root, flags.workflow)
        const rows = [["workflow", "minutes", "tries", "tasks left", "ceiling", "state"]]
        for (const budget of shown.budgets) {
            rows.push([
                budget.workflow,
                `${String(budget.used.minutes)}/${String(budget.ceiling.minutes)}`,
                `${String(budget.used.tries)}/${String(budget.ceiling.tries)}`,
                String(budget.tasks.remaining),
                budget.raised ? "raised" : "default",
                stateLine(budget),
            ])
        }
        return { data: shown, message: shown.budgets.length === 0 ? "no workflows in this project's ledger" : formatTable(rows) }
    },
})
