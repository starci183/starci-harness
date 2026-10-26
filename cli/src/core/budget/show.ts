import { workflowBudgets } from "../../harness/budget.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** `starci budget show`: each workflow's minutes and tries against its ceiling; reads only. */
export const budgetShowVerb = defineVerb({
    path: ["budget", "show"],
    summary: "each workflow of this project: minutes and tries used against its ceiling (the ops default or as raised)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/budget-show@1",
    flags: {
        workflow: { kind: "string", summary: "only this workflow", positional: true },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const shown = workflowBudgets(root, flags.workflow)
        const rows = [["workflow", "minutes", "tries", "ceiling", "state"]]
        for (const budget of shown.budgets) {
            rows.push([
                budget.workflow,
                `${String(budget.used.minutes)}/${String(budget.ceiling.minutes)}`,
                `${String(budget.used.tries)}/${String(budget.ceiling.tries)}`,
                budget.raised ? "raised" : "default",
                budget.exhausted.length === 0 ? "ok" : `exhausted: ${budget.exhausted.join(", ")}`,
            ])
        }
        return { data: shown, message: shown.budgets.length === 0 ? "no workflows in this project's ledger" : formatTable(rows) }
    },
})
