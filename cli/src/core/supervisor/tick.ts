import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { supervisorTick } from "./driver.js"

/**
 * `starci supervisor tick`: one deterministic pass of the host driver, for a scheduler to run every minute. It keeps one
 * Supervisor (relaunched when Orca says it is gone) and, acting for the attached Supervisor, sweeps the Kernels and Ops of the
 * workflows it owns and the Supervisor itself: gone or silent Kernels are relaunched, agents idle at their prompt with work
 * pending are nudged, then relaunched (or fenced) on another member, then escalated. Idempotent; no LLM needs to be awake.
 */
export const supervisorTickVerb = defineVerb({
    path: ["supervisor", "tick"],
    summary: "one host-driver pass: ensure the Supervisor, sweep its Kernels and their Ops, nudge or relaunch stalled agents (for a scheduled task)",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "supervisor"],
    schema: "starci/supervisor-tick@1",
    flags: {},
    run: async (context) => {
        const data = await supervisorTick(context)
        return { data, message: [`supervisor tick: ${data.swept ? "swept" : "not swept"}`, ...data.actions].join("\n") }
    },
})
