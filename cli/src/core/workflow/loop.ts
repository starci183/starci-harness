import { setTimeout as sleep } from "node:timers/promises"
import { LIVE_STATES, STUCK_STATES } from "../../harness/graph.js"
import type { NodeState } from "../../harness/graph.js"
import type { WorkflowStatus } from "../../harness/workflow.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import type { VerbContext, VerbResult } from "../../shared/verb.js"
import { exitOf, readSnapshot, reportMessage, stepWorkflow } from "./engine.js"
import type { StepAction, WorkflowReport } from "./engine.js"

const UNTIL = ["done", "blocked", "idle"] as const

/** What a run waits for: done (or stuck), the first blocked, or the first tick that changes nothing. */
type Until = (typeof UNTIL)[number]

/**
 * Why a run ended: its workflow is done or stopped; blocked with nothing left moving (or, with --until blocked, blocked at
 * all); paused with no live task left to settle; a tick changed nothing (--until idle); or --max-ticks ran out.
 */
type Ended = "done" | "stopped" | "blocked" | "paused" | "idle" | "max-ticks"

const DEFAULT_INTERVAL_SECONDS = 30

// A shorter interval would make the loop a busy wait on Orca and the ledger.
const MIN_INTERVAL_SECONDS = 1

// Actions that move a task; a wait or a repeated problem is not progress.
const PROGRESS: ReadonlySet<StepAction["action"]> = new Set(["verified", "dispatched", "launched", "cancelled", "released", "lost"])

/** What a loop did: how many ticks, why it ended, every change line it printed, and the last step's report. */
export interface LoopData {
    readonly workflow: string
    readonly until: Until
    readonly intervalSeconds: number
    readonly ticks: number
    readonly ended: Ended
    readonly changes: readonly string[]
    readonly report: WorkflowReport
}

/** The state a run compares each tick against: the workflow status and every node's state. */
interface Seen {
    readonly status: WorkflowStatus
    readonly nodes: ReadonlyMap<string, NodeState>
    readonly actions: ReadonlySet<string>
}

const parseInterval = (value: string | undefined): number => {
    if (value === undefined) return DEFAULT_INTERVAL_SECONDS
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds < MIN_INTERVAL_SECONDS) throw new Refusal("CLI_USAGE", `--interval is a number of seconds of at least ${String(MIN_INTERVAL_SECONDS)}, not "${value}"`, EXIT_USAGE)
    return seconds
}

const parseMaxTicks = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const ticks = Number(value)
    if (!Number.isInteger(ticks) || ticks <= 0) throw new Refusal("CLI_USAGE", `--max-ticks is a positive whole number, not "${value}"`, EXIT_USAGE)
    return ticks
}

const parseUntil = (value: string | undefined): Until | undefined => {
    if (value === undefined) return undefined
    const until = UNTIL.find((name) => name === value)
    if (until === undefined) throw new Refusal("CLI_USAGE", `--until is one of ${UNTIL.join(", ")}, not "${value}"`, EXIT_USAGE)
    return until
}

const actionLine = (action: StepAction): string => `${action.action}: ${action.key ?? "-"} ${action.task ?? ""} ${action.detail}`.replace(/\s+/g, " ").trim()

const stamp = (tick: number): string => `[${new Date().toISOString().slice(11, 19)} tick ${String(tick)}]`

/** The lines one tick changed against what the run saw before; an action line is printed once, not every tick it repeats. */
const changesOf = (seen: Seen, report: WorkflowReport, tick: number): { readonly lines: string[]; readonly moved: boolean; readonly next: Seen } => {
    const lines: string[] = []
    if (seen.status !== report.status) {
        const why = report.reason === null ? "" : ` (${report.reason})`
        lines.push(`${stamp(tick)} workflow ${report.workflow}: ${seen.status} -> ${report.status}${why}`)
    }
    for (const node of report.nodes) {
        const before = seen.nodes.get(node.key)
        const ledgerTask = node.task === null ? "" : ` (${node.task.id})`
        if (before !== node.state) lines.push(`${stamp(tick)} ${node.key}: ${before ?? "new"} -> ${node.state}${ledgerTask}`)
    }
    const actions = new Set(report.actions.map(actionLine))
    for (const line of actions) if (!seen.actions.has(line)) lines.push(`${stamp(tick)} ${line}`)
    const moved = lines.length > 0 && (seen.status !== report.status || report.nodes.some((node) => seen.nodes.get(node.key) !== node.state) || report.actions.some((action) => PROGRESS.has(action.action)))
    return { lines, moved, next: { status: report.status, nodes: new Map(report.nodes.map((node) => [node.key, node.state])), actions } }
}

// Tasks still moving on their own: live and not stuck (a task returned to the Kernel or whose worker is lost waits for an amend).
const moving = (report: WorkflowReport): number => report.nodes.filter((node) => LIVE_STATES.includes(node.state) && !STUCK_STATES.includes(node.state)).length

const live = (report: WorkflowReport): number => report.nodes.filter((node) => LIVE_STATES.includes(node.state)).length

/** Why the run ends after this tick, or undefined to tick again. */
const endOf = (report: WorkflowReport, until: Until, moved: boolean): Ended | undefined => {
    if (report.status === "done") return "done"
    if (report.status === "stopped") return "stopped"
    if (report.status === "blocked" && (until === "blocked" || moving(report) === 0)) return "blocked"
    if (report.status === "paused" && live(report) === 0) return "paused"
    if (until === "idle" && !moved) return "idle"
    return undefined
}

/** The flags of `workflow step` that shape its loop, as typed. */
export interface LoopFlags {
    readonly interval: string | undefined
    readonly until: string | undefined
    readonly "max-ticks": string | undefined
}

/** The help lines of the loop's flags, declared once with the verb that takes them (`workflow step`). */
export const LOOP_SUMMARIES = {
    interval: `with --loop: seconds between ticks (default ${String(DEFAULT_INTERVAL_SECONDS)}, at least ${String(MIN_INTERVAL_SECONDS)})`,
    until: "with --loop: done (default for orca), blocked, or idle (default for inline): when the loop returns",
    maxTicks: "with --loop: return after this many ticks at most",
} as const

/**
 * `starci workflow step <id> --loop`: the daemon-less driver a terminal or a chat loop runs. It runs the step every --interval
 * seconds and prints one line per change (a status, a node state, a new action) until the workflow is done, blocked with
 * nothing left moving, stopped, or paused with nothing live; --until blocked stops at the first blocked, --until idle at the
 * first tick that changes nothing (the default of an inline run, whose next task the chat agent works between runs). It
 * sleeps between ticks, never spins. Exit 0 unless the workflow ends blocked (1); bad flags are usage (2).
 */
export const loopWorkflow = async (context: VerbContext, workflow: string, flags: LoopFlags): Promise<VerbResult<LoopData>> => {
    const intervalSeconds = parseInterval(flags.interval)
    const maxTicks = parseMaxTicks(flags["max-ticks"])
    const asked = parseUntil(flags.until)
    const root = await repositoryRoot(context.cwd)
    const before = readSnapshot(root, workflow)
    const until: Until = asked ?? (before.workflow.header.runner === "inline" ? "idle" : "done")
    let seen: Seen = { status: before.workflow.status, nodes: new Map(before.views.map((view) => [view.key, view.state])), actions: new Set() }
    const changes: string[] = []
    const limit = maxTicks === undefined ? "" : `, at most ${String(maxTicks)} tick(s)`
    context.progress(`${stamp(0)} step ${workflow} in a loop until ${until}, every ${String(intervalSeconds)} s${limit}`)
    // One tick per call; the sleep between ticks is a tail call of the loop, so no await sits in a loop statement.
    const tickFrom = async (tick: number): Promise<VerbResult<LoopData>> => {
        const report = await stepWorkflow(context, root, workflow)
        const { lines, moved, next } = changesOf(seen, report, tick)
        seen = next
        for (const line of lines) context.progress(line)
        changes.push(...lines)
        const ended = endOf(report, until, moved) ?? (maxTicks !== undefined && tick >= maxTicks ? "max-ticks" : undefined)
        if (ended === undefined) {
            await sleep(intervalSeconds * 1000)
            return tickFrom(tick + 1)
        }
        const data: LoopData = { workflow: report.workflow, until, intervalSeconds, ticks: tick, ended, changes, report }
        return { data, message: `loop over ${report.workflow} ended ${ended} after ${String(tick)} tick(s)\n${reportMessage(report)}`, exitCode: exitOf(report) }
    }
    return tickFrom(1)
}
