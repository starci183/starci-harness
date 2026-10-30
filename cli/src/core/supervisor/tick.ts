import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { tickBudgets } from "../../harness/budget-warn.js"
import { loadFeedbackRules, openFeedback } from "../../harness/feedback.js"
import { now } from "../../harness/ledger.js"
import { withMachine } from "../../harness/machine.js"
import { loadStallRules } from "../../harness/stall.js"
import { tickStarvation } from "../../harness/starvation.js"
import { tickNotices } from "../../harness/telegram-bridge.js"
import { ticketHostEscalations } from "../../harness/tickets.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { startDetached } from "../../shared/exec.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbContext } from "../../shared/verb.js"
import { supervisorTick } from "./driver.js"

/** One tick: the driver's sweep plus the owner feedback, tickets, budgets, starvation and Telegram notices it adds. */
const tickPass = async (context: VerbContext, dryRun: boolean): Promise<{ readonly data: object; readonly message: string }> => {
    const swept = await supervisorTick(context, dryRun)
    const open = openFeedback(loadFeedbackRules())
    const feedback = { open: open.open.map((item) => item.id), overdue: open.overdue.map((item) => item.id) }
    const line = feedback.open.length === 0 ? [] : [`owner feedback open: ${feedback.open.map((id) => (feedback.overdue.includes(id) ? id + " (overdue)" : id)).join(", ")}`]
    const tickets = dryRun ? [] : await ticketHostEscalations()
    const starved = dryRun ? null : await tickStarvation()
    const budgets = dryRun ? [] : await tickBudgets()
    const starvedLine = starved?.line == null ? [] : [starved.line]
    const telegram = dryRun ? { sweep: null, line: null } : await tickNotices()
    const notices = telegram.line === null ? [] : [telegram.line]
    const dry = dryRun ? " (dry run; add --execute)" : ""
    return {
        data: { ...swept, dryRun, feedback, tickets, budgets, starvation: starved, telegram: telegram.sweep },
        message: [`supervisor tick${dry}: swept ${swept.swept.length === 0 ? "nothing" : swept.swept.join(", ")}`, ...swept.actions, ...line, ...tickets, ...budgets, ...starvedLine, ...notices].join("\n"),
    }
}

const sleep = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

const DIST = fileURLToPath(new URL("../..", import.meta.url))

/** Modified time of one dist file, or -1 when a build is removing or rewriting it (Windows answers UNKNOWN, not ENOENT). */
const mtimeOf = (file: string): number => {
    try {
        return statSync(join(DIST, file), { throwIfNoEntry: false })?.mtimeMs ?? -1
    } catch {
        return -1
    }
}

/** The build of the CLI this process runs: the newest dist module's modified time, -1 while a build has the folder half written. */
const buildStamp = (): number => {
    try {
        const times = readdirSync(DIST, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".js")).map(mtimeOf)
        return times.includes(-1) ? -1 : Math.max(0, ...times)
    } catch {
        return -1
    }
}

/**
 * Replaces this loop with one started from the new build: the same node, argv, folder and environment, detached and writing
 * to this process's own stdout and stderr (the same log file, appended, or the same terminal); the reload is a host event, and
 * this process exits once the new one started, so one loop process runs however many builds come.
 */
const reload = async (stamp: number): Promise<never> => {
    const argv = [process.execPath, ...process.execArgv, ...process.argv.slice(1)]
    const pid = await startDetached(argv, process.cwd(), process.env, "inherit")
    withMachine((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), "supervisor-watch-reloaded", String(process.pid), JSON.stringify({ from: process.pid, to: pid, build: new Date(stamp).toISOString(), argv: argv.slice(1) })))
    process.exit(0)
}

/**
 * `supervisor tick --loop`: the tick in a loop for a foreground terminal, sleeping ops/liveness.yaml stall.watchSeconds between
 * passes and printing each pass as it happens; `--ticks <n>` stops after n passes (default: until killed). A long-lived process
 * keeps the modules it loaded, so a new build of its own dist is never ticked with: once the build stands unchanged for one sleep,
 * the loop is replaced by one started from the new build (`reload`), never nested under it.
 */
const tickLoop = async (context: VerbContext, dryRun: boolean, ticksFlag: string | undefined): Promise<{ readonly data: object; readonly message: string }> => {
    const limit = ticksFlag === undefined ? Infinity : Number(ticksFlag)
    if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Refusal("CLI_USAGE", `--ticks is a whole number above 0, not "${String(ticksFlag)}"`, EXIT_USAGE)
    const seconds = loadStallRules().watchSeconds
    const loaded = buildStamp()
    let seen = loaded
    let ticks = 0
    let last: object | null = null
    // One pass after another, `seconds` apart, until the limit; a new build of the CLI first settles, then replaces this process.
    const pass = async (n: number): Promise<void> => {
        const stamp = buildStamp()
        if (stamp !== -1 && stamp !== loaded && stamp === seen) {
            context.progress(`${new Date().toISOString()} a new build of ${DIST}: reloading (process ${String(process.pid)} hands over and exits)`)
            await reload(stamp)
        }
        if (stamp === loaded) {
            const tick = await tickPass(context, dryRun)
            ticks = n
            last = tick.data
            context.progress(`${new Date().toISOString()} tick ${String(n)}: ${tick.message.split("\n").join("\n  ")}`)
            if (n >= limit) return
        } else {
            seen = stamp
            context.progress(`${new Date().toISOString()} a new build of ${DIST} is being written: no tick until it settles`)
        }
        await sleep(seconds * 1000)
        await pass(stamp === loaded ? n + 1 : n)
    }
    await pass(1)
    return { data: { ticks, last }, message: `supervisor tick --loop: ${String(ticks)} tick(s)` }
}

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
 * harness/budget-warn.ts). Idempotent; no LLM needs to be awake. It acts only with `--execute`; without it the pass is dry: it
 * reports what the terminal sweep would close and does nothing else. `--loop` repeats it in a foreground terminal (`tickLoop`).
 */
export const supervisorTickVerb = defineVerb({
    path: ["supervisor", "tick"],
    summary: "one host-driver pass (dry until --execute): close finished and orphaned harness terminals, ensure every project's Supervisor, sweep each one's Kernels and their Ops, nudge or relaunch stalled agents (for a scheduled task); --loop repeats it in a foreground terminal",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "supervisor"],
    schema: "starci/supervisor-tick@1",
    flags: {
        execute: { kind: "boolean", summary: "act: close, launch and relaunch (default: a dry run that reports the terminals the sweep would close)" },
        loop: { kind: "boolean", summary: "repeat the pass every stall.watchSeconds of ops/liveness.yaml in a foreground terminal; it reloads itself on a new build of the CLI" },
        ticks: { kind: "string", summary: "with --loop: stop after this many passes (default: run until killed)" },
    },
    run: async (context, flags) => {
        if (flags.loop) return tickLoop(context, !flags.execute, flags.ticks)
        if (flags.ticks !== undefined) throw new Refusal("CLI_USAGE", "--ticks counts the passes of a loop: add --loop", EXIT_USAGE)
        return tickPass(context, !flags.execute)
    },
})
