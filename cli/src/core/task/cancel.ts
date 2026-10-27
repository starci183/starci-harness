import { now, openLedger } from "../../harness/ledger.js"
import { inTransaction, missingLeases, releaseLeases } from "../../harness/leases.js"
import { PreserveIncomplete, preserveTaskPaths, resetPreserved } from "../../harness/preserve.js"
import type { Preserved } from "../../harness/preserve.js"
import { closeSeatsOfTask } from "../../harness/seats.js"
import type { SeatClosing } from "../../harness/seats.js"
import { claimIntent, clearIntent, getTask, noteIntentDir, recordEvent, setStatus, taskCheckout, TRANSITIONS } from "../../harness/tasks.js"
import type { TaskRow, TaskStatus } from "../../harness/tasks.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

interface CancelData {
    readonly task: string
    readonly from: TaskStatus
    readonly status: TaskStatus
    readonly reason: string | null
    readonly seats: readonly SeatClosing[]
    readonly preserved: Preserved | null
    readonly leasesReleased: number
    readonly resumed: boolean
}

/** The statuses a task can be cancelled from. */
const CANCELLABLE: readonly TaskStatus[] = (Object.keys(TRANSITIONS) as TaskStatus[]).filter((status) => TRANSITIONS[status].includes("cancelled"))

const seatNote = (seats: readonly SeatClosing[]): string => (seats.length === 0 ? "no open seat" : seats.map((seat) => `seat ${seat.seat} ${seat.outcome}`).join(", "))

/** Saves and resets the task's dirty allowPaths, or, on a resumed cancel that already saved them, finishes the reset from that copy. */
const preserveForCancel = async (db: Parameters<typeof noteIntentDir>[0], root: string, task: TaskRow): Promise<Preserved> => {
    const saved = task.intentData?.dir ?? null
    try {
        if (saved === null) return await preserveTaskPaths(root, task, db, (dir) => {
            noteIntentDir(db, task.id, dir)
        })
        await resetPreserved(root, saved)
        return { dir: saved, patch: null, tracked: [], untracked: [] }
    } catch (error: unknown) {
        if (!(error instanceof PreserveIncomplete)) throw error
        throw new Refusal(error.code, `task ${task.id} stays cancelling with its leases: its work is saved in ${error.dir}, but not every path was put back (${error.message}); run task cancel again to finish`)
    }
}

/**
 * `starci task cancel <task-id>`: claims the `cancelling` intent first (a verify or result arriving later is refused, one that
 * claimed the task first makes the cancel refuse), then stops and releases the task's open seats through Orca, preserves its
 * dirty work under its allowPaths in the task's own checkout and puts those paths back to HEAD, then ends the task as
 * cancelled and frees its leases, in that order, so no worker can still write and no overlapping task can commit the half-done
 * work. A cancel that is refused half-way keeps its intent; running it again resumes from where it stopped.
 */
export const taskCancelVerb = defineVerb({
    path: ["task", "cancel"],
    summary: "cancel a task: claim it, stop its seat, preserve and reset its dirty allowPaths, then release its path leases",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel", "supervisor", "owner"],
    schema: "starci/task-cancel@1",
    flags: {
        task: { kind: "string", summary: "the task id", required: true, positional: true },
        reason: { kind: "string", summary: "why, recorded in the ledger's events" },
    },
    run: async (context, flags) => {
        const callerRoot = await repositoryRoot(context.cwd)
        const db = openLedger(callerRoot)
        try {
            const current = getTask(db, flags.task)
            if (current.intent !== "cancelling" && !CANCELLABLE.includes(current.status)) throw new Refusal("TASK_NOT_CANCELLABLE", `task ${current.id} is ${current.status}; it cannot be cancelled`)
            // The claim comes before any Orca or git side effect.
            const { task: before, resumed } = claimIntent(db, current.id, "cancelling", CANCELLABLE)
            const from = before.intentData?.from ?? before.status
            const root = await taskCheckout(before, callerRoot)
            const seats = await closeSeatsOfTask(root, before.id)
            const running = seats.filter((seat) => seat.outcome === "not-stopped")
            if (running.length > 0) {
                const detail = running.map((seat) => `seat ${seat.seat} (dispatch ${seat.handle ?? "-"}): stop ${seat.closed?.stop ?? "-"}`).join("; ")
                throw new Refusal("SEAT_NOT_STOPPED", `task ${before.id} stays cancelling with its leases: Orca did not stop its worker, which may still write (${detail}); run task cancel again once Orca answers`)
            }
            const unknown = seats.filter((seat) => seat.outcome === "launch-unknown")
            if (unknown.length > 0) {
                throw new Refusal(
                    "SEAT_LAUNCH_UNKNOWN",
                    `task ${before.id} stays cancelling with its leases: the launch of seat ${unknown.map((seat) => seat.seat).join(", ")} named no dispatch, so a worker may run that nobody can stop yet; learn its dispatch with starci seat start ${before.id} --resume, then cancel again`,
                )
            }
            // A task that lost a lease must not reset that path: another task may own it now.
            const lost = missingLeases(db, before)
            const preserved = lost.length === 0 ? await preserveForCancel(db, root, getTask(db, before.id)) : null
            const data = inTransaction(db, (): CancelData => {
                const task = setStatus(db, before.id, "cancelled")
                clearIntent(db, task.id)
                // An attempt still open when its task is cancelled ends here, so no attempt stays open forever.
                db.prepare("UPDATE attempts SET outcome = 'cancelled', ended_at = ? WHERE task_id = ? AND ended_at IS NULL").run(now(), task.id)
                const leasesReleased = releaseLeases(db, task.id)
                recordEvent(db, "task-cancelled", task.id, { from, reason: flags.reason ?? null, seats, preserved: preserved?.dir ?? null, lostLeases: lost, resumed, checkout: root })
                return { task: task.id, from, status: task.status, reason: flags.reason ?? null, seats, preserved, leasesReleased, resumed }
            })
            const dir = preserved?.dir ?? null
            const nothingKept = lost.length > 0 ? `; lost leases on ${lost.join(", ")}, nothing reset` : "; nothing dirty to preserve"
            const kept = dir === null ? nothingKept : `; dirty work preserved in ${dir}`
            return { data, message: `cancelled ${data.task} (was ${data.from}${resumed ? ", resumed" : ""}); ${seatNote(seats)}${kept}; released ${String(data.leasesReleased)} lease(s)` }
        } finally {
            db.close()
        }
    },
})
