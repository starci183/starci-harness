import { now, openLedger } from "../../harness/ledger.js"
import { inTransaction, missingLeases, releaseLeases } from "../../harness/leases.js"
import { preserveTaskPaths } from "../../harness/preserve.js"
import type { Preserved } from "../../harness/preserve.js"
import { closeSeatsOfTask } from "../../harness/seats.js"
import type { SeatClosing } from "../../harness/seats.js"
import { getTask, recordEvent, setStatus, TRANSITIONS } from "../../harness/tasks.js"
import type { TaskStatus } from "../../harness/tasks.js"
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
}

const seatNote = (seats: readonly SeatClosing[]): string => (seats.length === 0 ? "no open seat" : seats.map((seat) => `seat ${seat.seat} ${seat.outcome}`).join(", "))

/**
 * `starci task cancel <task-id>`: stops and releases the task's open seats through Orca, preserves its dirty work under its
 * allowPaths and puts those paths back to HEAD, then ends the task as cancelled and frees its leases, in that order, so no
 * worker can still write and no overlapping task can commit the half-done work.
 */
export const taskCancelVerb = defineVerb({
    path: ["task", "cancel"],
    summary: "cancel a task: stop its seat, preserve and reset its dirty allowPaths, then release its path leases",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["kernel", "supervisor", "owner"],
    schema: "starci/task-cancel@1",
    flags: {
        task: { kind: "string", summary: "the task id", required: true, positional: true },
        reason: { kind: "string", summary: "why, recorded in the ledger's events" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            const before = getTask(db, flags.task)
            if (!TRANSITIONS[before.status].includes("cancelled")) throw new Refusal("TASK_NOT_CANCELLABLE", `task ${before.id} is ${before.status}; it cannot be cancelled`)
            const seats = await closeSeatsOfTask(root, before.id)
            const running = seats.filter((seat) => seat.outcome === "not-stopped")
            if (running.length > 0) {
                const detail = running.map((seat) => `seat ${seat.seat} (dispatch ${seat.handle ?? "-"}): stop ${seat.closed?.stop ?? "-"}`).join("; ")
                throw new Refusal("SEAT_NOT_STOPPED", `task ${before.id} keeps its state and leases: Orca did not stop its worker, which may still write (${detail}); run task cancel again once Orca answers`)
            }
            const unknown = seats.filter((seat) => seat.outcome === "launch-unknown")
            if (unknown.length > 0) {
                throw new Refusal(
                    "SEAT_LAUNCH_UNKNOWN",
                    `task ${before.id} keeps its state and leases: the launch of seat ${unknown.map((seat) => seat.seat).join(", ")} named no dispatch, so a worker may run that nobody can stop yet; learn its dispatch with starci seat start ${before.id} --resume, then cancel again`,
                )
            }
            // A task that lost a lease must not reset that path: another task may own it now.
            const lost = missingLeases(db, before)
            const preserved = lost.length === 0 ? await preserveTaskPaths(root, getTask(db, before.id), db) : null
            const data = inTransaction(db, (): CancelData => {
                const task = setStatus(db, before.id, "cancelled")
                // An attempt still open when its task is cancelled ends here, so no attempt stays open forever.
                db.prepare("UPDATE attempts SET outcome = 'cancelled', ended_at = ? WHERE task_id = ? AND ended_at IS NULL").run(now(), task.id)
                const leasesReleased = releaseLeases(db, task.id)
                recordEvent(db, "task-cancelled", task.id, { from: before.status, reason: flags.reason ?? null, seats, preserved: preserved?.dir ?? null, lostLeases: lost })
                return { task: task.id, from: before.status, status: task.status, reason: flags.reason ?? null, seats, preserved, leasesReleased }
            })
            const dir = preserved?.dir ?? null
            const kept = dir === null ? (lost.length > 0 ? `; lost leases on ${lost.join(", ")}, nothing reset` : "; nothing dirty to preserve") : `; dirty work preserved in ${dir}`
            return { data, message: `cancelled ${data.task} (was ${data.from}); ${seatNote(seats)}${kept}; released ${String(data.leasesReleased)} lease(s)` }
        } finally {
            db.close()
        }
    },
})
