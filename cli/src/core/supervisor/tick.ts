import { loadFeedbackRules, openFeedback } from "../../harness/feedback.js"
import { tickNotices } from "../../harness/telegram-bridge.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { supervisorTick } from "./driver.js"

/**
 * `starci supervisor tick`: one deterministic pass of the host driver, for a scheduler to run every minute. It first closes every
 * Orca terminal the harness made that no open seat or live Supervisor holds any more, and every orphaned one (`data.terminals`).
 * Then it keeps every project's Supervisor (relaunched when Orca says it is gone) and, acting for each attached one, sweeps the
 * Kernels and Ops of the workflows it owns in its project and the Supervisor itself: gone or silent Kernels are relaunched, agents
 * idle at their prompt with work pending are nudged, then relaunched (a Kernel or Supervisor on the coordinator tier's order) or fenced (an Op, retried on another member), then escalated. It also names
 * every owner feedback still open (`data.feedback`, overdue past ops/liveness.yaml feedback.openMaxDays), and, once the owner's
 * Telegram chat is connected, sends the owner the notices due (`data.telegram`, `tickNotices` in harness/telegram-bridge.ts), so
 * they go out with no bridge running. Idempotent; no LLM needs to be awake. `--dry-run` reports what the terminal sweep would close
 * and does nothing else.
 */
export const supervisorTickVerb = defineVerb({
    path: ["supervisor", "tick"],
    summary: "one host-driver pass: close finished and orphaned harness terminals, ensure every project's Supervisor, sweep each one's Kernels and their Ops, nudge or relaunch stalled agents (for a scheduled task)",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "supervisor"],
    schema: "starci/supervisor-tick@1",
    flags: {
        "dry-run": { kind: "boolean", summary: "report the terminals the sweep would close; close, launch and relaunch nothing" },
    },
    run: async (context, flags) => {
        const swept = await supervisorTick(context, flags["dry-run"])
        const open = openFeedback(loadFeedbackRules())
        const feedback = { open: open.open.map((item) => item.id), overdue: open.overdue.map((item) => item.id) }
        const line = feedback.open.length === 0 ? [] : [`owner feedback open: ${feedback.open.map((id) => (feedback.overdue.includes(id) ? id + " (overdue)" : id)).join(", ")}`]
        const telegram = flags["dry-run"] ? { sweep: null, line: null } : await tickNotices()
        const notices = telegram.line === null ? [] : [telegram.line]
        return { data: { ...swept, feedback, telegram: telegram.sweep }, message: [`supervisor tick: swept ${swept.swept.length === 0 ? "nothing" : swept.swept.join(", ")}`, ...swept.actions, ...line, ...notices].join("\n") }
    },
})
