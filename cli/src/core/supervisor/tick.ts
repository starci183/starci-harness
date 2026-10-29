import { tickBudgets } from "../../harness/budget-warn.js"
import { loadFeedbackRules, openFeedback } from "../../harness/feedback.js"
import { tickStarvation } from "../../harness/starvation.js"
import { tickNotices } from "../../harness/telegram-bridge.js"
import { ticketHostEscalations } from "../../harness/tickets.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { supervisorTick } from "./driver.js"

/**
 * `starci supervisor tick`: one deterministic pass of the host driver, for a scheduler to run every minute. It first closes every
 * Orca terminal the harness made that no open seat or live Supervisor holds any more, and every orphaned one (`data.terminals`).
 * Then it keeps every project's Supervisor (relaunched when Orca says it is gone) and, acting for each attached one, sweeps the
 * Kernels and Ops of the workflows it owns in its project and the Supervisor itself: each workflow is settled (its reported tasks
 * verified, a dead or hung verify reclaimed, settled workers' seats closed, a due wave run: settleWorkflow), gone or silent Kernels are relaunched, agents
 * idle at their prompt with work pending are nudged, then relaunched (a Kernel or Supervisor on the coordinator tier's order) or fenced (an Op, retried on another member), then escalated; an Op past its budget is asked to wrap up, then fenced past the grace (the budget ladder). It also names
 * every owner feedback still open (`data.feedback`, overdue past ops/liveness.yaml feedback.openMaxDays), files every escalation
 * a Supervisor cannot rule as its ticket (`data.tickets`, `ticketHostEscalations` in harness/tickets.ts), and, once the owner's
 * Telegram chat is connected, sends the owner the notices due (`data.telegram`, `tickNotices` in harness/telegram-bridge.ts), so
 * they go out with no bridge running. When heavy admission or a seat launch has been held past ops/liveness.yaml
 * heavy.starvedTicketMinutes, it opens one harness-defect ticket per episode naming the top unmanaged holders of memory
 * (`data.starvation`, harness/starvation.ts). A workflow near its budget with tasks left is asked of the owner as one question
 * ticket per ceiling proposing a raise sized to those tasks, repeated each tick until a raise answers it (`data.budgets`,
 * harness/budget-warn.ts). Idempotent; no LLM needs to be awake. `--dry-run` reports what the terminal sweep would close
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
        const tickets = flags["dry-run"] ? [] : await ticketHostEscalations()
        const starved = flags["dry-run"] ? null : await tickStarvation()
        const budgets = flags["dry-run"] ? [] : await tickBudgets()
        const starvedLine = starved?.line == null ? [] : [starved.line]
        const telegram = flags["dry-run"] ? { sweep: null, line: null } : await tickNotices()
        const notices = telegram.line === null ? [] : [telegram.line]
        return { data: { ...swept, feedback, tickets, budgets, starvation: starved, telegram: telegram.sweep }, message: [`supervisor tick: swept ${swept.swept.length === 0 ? "nothing" : swept.swept.join(", ")}`, ...swept.actions, ...line, ...tickets, ...budgets, ...starvedLine, ...notices].join("\n") }
    },
})
