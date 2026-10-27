import { loadFeedbackRules, openFeedback } from "../../harness/feedback.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { supervisorTick } from "./driver.js"

/**
 * `starci supervisor tick`: one deterministic pass of the host driver, for a scheduler to run every minute. It keeps every
 * project's Supervisor (relaunched when Orca says it is gone) and, acting for each attached one, sweeps the Kernels and Ops of the
 * workflows it owns in its project and the Supervisor itself: gone or silent Kernels are relaunched, agents idle at their prompt
 * with work pending are nudged, then relaunched (or fenced) on another member, then escalated. It also names every owner feedback
 * still open (`data.feedback`, overdue past ops/liveness.yaml feedback.openMaxDays). Idempotent; no LLM needs to be awake.
 */
export const supervisorTickVerb = defineVerb({
    path: ["supervisor", "tick"],
    summary: "one host-driver pass: ensure every project's Supervisor, sweep each one's Kernels and their Ops, nudge or relaunch stalled agents (for a scheduled task)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor"],
    schema: "starci/supervisor-tick@1",
    flags: {},
    run: async (context) => {
        const swept = await supervisorTick(context)
        const open = openFeedback(loadFeedbackRules())
        const feedback = { open: open.open.map((item) => item.id), overdue: open.overdue.map((item) => item.id) }
        const line = feedback.open.length === 0 ? [] : [`owner feedback open: ${feedback.open.map((id) => `${id}${feedback.overdue.includes(id) ? " (overdue)" : ""}`).join(", ")}`]
        return { data: { ...swept, feedback }, message: [`supervisor tick: swept ${swept.swept.length === 0 ? "nothing" : swept.swept.join(", ")}`, ...swept.actions, ...line].join("\n") }
    },
})
