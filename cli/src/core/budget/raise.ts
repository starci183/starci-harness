import { RAISERS, raiseWorkflowBudget } from "../../harness/budget.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

const amount = (name: string, value: string | undefined): number => {
    if (value === undefined) return 0
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Refusal("CLI_USAGE", `--${name} is a positive whole number, not "${value}"`, EXIT_USAGE)
    return parsed
}

/** `starci budget raise <workflow>`: raises a workflow's minutes or tries ceiling; only the owner or the Supervisor, with a reason. */
export const budgetRaiseVerb = defineVerb({
    path: ["budget", "raise"],
    summary: "raise a workflow's minutes or tries ceiling (owner or Supervisor only); who and why are kept",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/budget-raise@1",
    flags: {
        workflow: { kind: "string", summary: "the workflow id", required: true, positional: true },
        minutes: { kind: "string", summary: "add this many minutes to the ceiling" },
        tries: { kind: "string", summary: "add this many tries to the ceiling" },
        by: { kind: "string", summary: `who raises it: ${RAISERS.join(" or ")}`, required: true },
        reason: { kind: "string", summary: "why the workflow needs more", required: true },
    },
    run: async (context, flags) => {
        const by = RAISERS.find((role) => role === flags.by)
        if (by === undefined) throw new Refusal("ROLE_REFUSED", `only ${RAISERS.join(" or ")} raise a budget, not "${flags.by}"`)
        const minutes = amount("minutes", flags.minutes)
        const tries = amount("tries", flags.tries)
        if (minutes === 0 && tries === 0) throw new Refusal("CLI_USAGE", "give --minutes, --tries or both", EXIT_USAGE)
        if (flags.reason.trim() === "") throw new Refusal("CLI_USAGE", "--reason must say why", EXIT_USAGE)
        const root = await repositoryRoot(context.cwd)
        const raised = raiseWorkflowBudget(root, flags.workflow, { minutes, tries, by, reason: flags.reason.trim() })
        const { before, after } = raised
        return {
            data: raised,
            message: `workflow ${flags.workflow}: minutes ${String(before.ceiling.minutes)} -> ${String(after.ceiling.minutes)}, tries ${String(before.ceiling.tries)} -> ${String(after.ceiling.tries)} (by ${by}: ${flags.reason.trim()})`,
        }
    },
})
