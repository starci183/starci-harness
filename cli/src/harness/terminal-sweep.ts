import { loadCoordinatorLiveness, olderThan } from "./coordinator-liveness.js"
import { openLedger } from "./ledger.js"
import { readMachine, textOf } from "./machine.js"
import { terminalClose, terminalList } from "./orca/client.js"
import type { ListedTerminal, OrcaBinary } from "./orca/client.js"
import { CLOSED_SEAT_STATUSES } from "./seats.js"
import { inOrder } from "./sequential.js"

/**
 * The titles the harness gives the terminals it launches (`[Op] `, `[Kernel] `, `[Supervisor] `, set by `opTitle`, `kernelTitle`
 * and `supervisorTitle` through `terminal rename`), and Orca's own title of a worker terminal before that rename (`worker-task_`).
 */
const HARNESS_TITLE = /^\[(?:Op|Kernel|Supervisor)\] /
const WORKER_TITLE = "worker-task_"

/** Who recorded a terminal handle: a seat or a Supervisor row, and whether that record still holds the terminal. */
interface Holder {
    readonly who: string
    readonly live: boolean
}

/** Every terminal handle the harness recorded, and the folders of every workflow worktree it made. */
interface HarnessRecords {
    readonly holders: ReadonlyMap<string, readonly Holder[]>
    readonly worktrees: ReadonlySet<string>
}

const folderKey = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()

const add = (holders: Map<string, Holder[]>, terminal: unknown, holder: Holder): void => {
    const handle = textOf(terminal)
    if (handle === null || handle === "") return
    holders.set(handle, [...(holders.get(handle) ?? []), holder])
}

/** Reads the seats and Kernel terminals of every given ledger and the Supervisor rows of the host store. */
const harnessRecords = (repos: readonly string[]): HarnessRecords => {
    const holders = new Map<string, Holder[]>()
    const worktrees = new Set<string>()
    for (const repo of repos) {
        const db = openLedger(repo)
        try {
            for (const row of db.prepare("SELECT * FROM seats").all()) add(holders, row.terminal, { who: `${String(row.role)} seat ${String(row.id)} (${String(row.status)})`, live: !CLOSED_SEAT_STATUSES.includes(String(row.status)) })
            for (const row of db.prepare("SELECT * FROM workflows").all()) {
                add(holders, row.kernel_terminal, { who: `Kernel of ${String(row.id)}`, live: row.kernel_closed_at === null || row.kernel_closed_at === undefined })
                const worktree = textOf(row.worktree)
                if (worktree !== null) worktrees.add(folderKey(worktree))
            }
        } finally {
            db.close()
        }
    }
    const supervisors = readMachine((db) => db.prepare("SELECT * FROM project_supervisors").all(), [])
    for (const row of supervisors) add(holders, row.terminal, { who: `Supervisor ${String(row.id)} of ${String(row.project)}`, live: row.ended_at === null })
    const hosts = readMachine((db) => (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supervisors'").get() === undefined ? [] : db.prepare("SELECT * FROM supervisors").all()), [])
    for (const row of hosts) add(holders, row.terminal, { who: `host Supervisor ${String(row.id)}`, live: row.ended_at === null })
    return { holders, worktrees }
}

/** True when a terminal's title marks it as one the harness launched: its seat title, or Orca's worker title inside a workflow worktree. */
const harnessTitled = (terminal: ListedTerminal, worktrees: ReadonlySet<string>): boolean => {
    const title = terminal.title ?? ""
    if (HARNESS_TITLE.test(title)) return true
    return title.startsWith(WORKER_TITLE) && terminal.worktree !== null && worktrees.has(folderKey(terminal.worktree))
}

/** One terminal the sweep closes: its handle and title, why, and what Orca answered (`closed`, `gone`, `error: ...`, or `dry-run`). */
export interface SweptTerminal {
    readonly handle: string
    readonly title: string | null
    readonly why: string
    readonly outcome: string
}

/**
 * Why a listed terminal is to be closed, or null to leave it. Only a terminal the harness made is ever judged: one whose handle a
 * seat or Supervisor row recorded, or one carrying the harness title convention. Such a terminal is closed when Orca reports it
 * orphaned (its pane outlived an Orca restart, nothing drives it), when every record of it is closed (its seat released or
 * launch-failed, its Supervisor retired, its Kernel closed), or when no record names it at all and it has been quiet past the
 * effect-unknown deadline (a launch in flight records its handle before it renames the tab, so a fresh one is never cut).
 */
const verdict = (terminal: ListedTerminal, records: HarnessRecords, lastOutput: string | null, graceMinutes: number): string | null => {
    const held = records.holders.get(terminal.handle) ?? []
    const titled = harnessTitled(terminal, records.worktrees)
    if (held.length === 0 && !titled) return null
    if (terminal.orphaned) return `orphaned by an Orca restart${held.length === 0 ? "" : `; recorded by ${held.map((holder) => holder.who).join(", ")}`}`
    if (held.some((holder) => holder.live)) return null
    if (held.length > 0) return `its record is closed: ${held.map((holder) => holder.who).join(", ")}`
    return olderThan(lastOutput, graceMinutes) ? `harness-titled with no ledger seat, quiet past ${String(graceMinutes)} min` : null
}

/**
 * The terminal sweep of `supervisor tick`: lists Orca's terminals and closes the whole tab of every terminal the harness made that
 * no open seat or live Supervisor holds any more, and of every orphaned one (`verdict`). A terminal the harness did not make is
 * never touched. `dryRun` judges the same and closes nothing. Each closure is returned for the tick's actions.
 */
export const sweepTerminals = async (binary: OrcaBinary, cwd: string, repos: readonly string[], dryRun: boolean): Promise<SweptTerminal[]> => {
    const inventory = await terminalList(binary, cwd)
    const records = harnessRecords(repos)
    const grace = loadCoordinatorLiveness().effectUnknownDeadlineMinutes
    const doomed = inventory.terminals.flatMap((terminal) => {
        const why = verdict(terminal, records, inventory.lastOutput.get(terminal.handle) ?? null, grace)
        return why === null ? [] : [{ terminal, why }]
    })
    return inOrder(doomed, async ({ terminal, why }) => ({
        handle: terminal.handle,
        title: terminal.title,
        why,
        outcome: dryRun ? "dry-run" : await terminalClose(binary, terminal.handle, cwd).catch((error: unknown) => `error: ${error instanceof Error ? error.message : String(error)}`),
    }))
}
