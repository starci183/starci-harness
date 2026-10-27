import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { kernelNext } from "./driver.js"

/** Parses a --wait value in whole seconds (0 returns after one tick). */
export const parseWait = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const seconds = Number(value)
    if (!Number.isInteger(seconds) || seconds < 0) throw new Refusal("CLI_USAGE", `--wait is a whole number of seconds, not "${value}"`, EXIT_USAGE)
    return seconds
}

/**
 * `starci kernel next <workflow>`: the Kernel's only wait. The deterministic driver drains the Kernel Run's mail, steps the
 * workflow (dispatch, verify, close seats), fences idle workers, resolves unknown launches, and returns one decision
 * (red, stale, question, conflict, goal, goal-change, escalation-answer, done) with a ledger digest; idle when none came.
 */
export const kernelNextVerb = defineVerb({
    path: ["kernel", "next"],
    summary: "drive a workflow until a decision is needed and return it (red|stale|question|conflict|goal|goal-change|escalation-answer|done) with a digest; idle after --wait",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel", "owner", "agent"],
    schema: "starci/kernel-next@1",
    flags: {
        workflow: { kind: "string", required: true, positional: true, summary: "the workflow id" },
        wait: { kind: "string", summary: "seconds to wait for a decision before returning idle (default ops/liveness.yaml coordinators.nextWaitSeconds)" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const data = await kernelNext(context, root, flags.workflow, parseWait(flags.wait))
        const inline = data.inlineNext === null ? "" : ": inline task " + data.inlineNext + " waits for the chat agent (starci workflow step " + data.workflow + ")"
        const head = data.decision === null ? "idle" + inline : `${data.kind} ${data.decision.id} (${data.decision.subject})`
        const reason = data.digest.reason === null ? "" : " (" + data.digest.reason + ")"
        const lines = [
            `${data.workflow}: ${head}`,
            `digest: ${data.digest.status}${reason}, graph v${String(data.digest.graphVersion)}, goal v${String(data.digest.goalVersion)}, nodes ${JSON.stringify(data.digest.nodes)}, ${String(data.digest.openDecisions)} open decision(s)`,
            ...(data.decision === null ? [] : [`evidence: ${JSON.stringify(data.decision.evidence)}`]),
            ...data.actions.map((action) => `${action.action}: ${action.key ?? "-"} ${action.detail}`),
        ]
        return { data, message: lines.join("\n") }
    },
})
