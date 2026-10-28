import { openLedger, now } from "./ledger.js"
import { inTransaction, missingLeases, releaseLeases } from "./leases.js"
import { PreserveIncomplete, preserveTaskPaths, resetPreserved } from "./preserve.js"
import { closeSeatsOfTask } from "./seats.js"
import type { SeatClosing } from "./seats.js"
import { claimIntent, clearIntent, getTask, markIntent, noteIntentDir, recordEvent, setStatus, taskCheckout } from "./tasks.js"

/** What fencing one running attempt did, or why it stopped short. */
export interface Fenced {
    /**
     * `fenced`: the task failed with the outcome; `not-running`: it left running first (a result was filed), nothing was done;
     * `held`: a seat Orca did not stop, or a launch that named no dispatch, keeps the `fencing` intent and the leases for the next sweep.
     */
    readonly status: "fenced" | "not-running" | "held"
    readonly seats: readonly SeatClosing[]
    readonly preserved: string | null
    readonly lostLeases: readonly string[]
    readonly leasesReleased: number
    /** The preserve folder whose reset broke: the task keeps its leases under a `repair` intent (`task verify --recover`). */
    readonly repair: string | null
}

const heldBy = (seats: readonly SeatClosing[]): SeatClosing[] => seats.filter((seat) => seat.outcome === "not-stopped" || seat.outcome === "launch-unknown")

/**
 * Fences a running attempt as a red verify ends one: claims the `fencing` intent while the task still runs (a result filed first
 * wins, and once claimed no result is taken), closes its seats through the seat lifecycle (worker-stop, release, tab), preserves
 * and resets its dirty allowPaths while it still holds its leases (a task that lost a lease resets nothing), then fails the task,
 * closes its attempt with `outcome` (a spent try) and releases the leases in one transaction. A seat Orca did not stop keeps the
 * intent and the leases: the next call resumes from there. A reset that broke keeps the leases under a `repair` intent.
 */
export const fenceAttempt = async (root: string, taskId: string, outcome: string, facts: Readonly<Record<string, unknown>>): Promise<Fenced> => {
    const db = openLedger(root)
    try {
        const current = getTask(db, taskId)
        const idle: Fenced = { status: "not-running", seats: [], preserved: null, lostLeases: [], leasesReleased: 0, repair: null }
        if (current.intent !== "fencing" && (current.status !== "running" || current.intent !== null)) return idle
        const { task: before } = claimIntent(db, taskId, "fencing", ["running"])
        const checkout = await taskCheckout(before, root)
        const seats = await closeSeatsOfTask(checkout, taskId)
        if (heldBy(seats).length > 0) return { ...idle, status: "held", seats }
        const lostLeases = missingLeases(db, before)
        let preserved: string | null = null
        let repair: string | null = null
        if (lostLeases.length === 0) {
            const saved = before.intentData?.dir ?? null
            try {
                if (saved === null) preserved = (await preserveTaskPaths(checkout, getTask(db, taskId), db, (dir) => { noteIntentDir(db, taskId, dir); })).dir
                else {
                    await resetPreserved(checkout, saved)
                    preserved = saved
                }
            } catch (error: unknown) {
                if (!(error instanceof PreserveIncomplete)) throw error
                preserved = error.dir
                repair = error.dir
            }
        }
        const leasesReleased = inTransaction(db, () => {
            setStatus(db, taskId, "failed", "running")
            db.prepare("UPDATE attempts SET outcome = ?, ended_at = COALESCE(ended_at, ?) WHERE task_id = ? AND outcome IS NULL").run(outcome, now(), taskId)
            recordEvent(db, `task-${outcome}`, taskId, { ...facts, seats, preserved, lostLeases, repair, checkout })
            if (repair !== null) {
                markIntent(db, taskId, "repair", repair)
                return 0
            }
            clearIntent(db, taskId)
            return releaseLeases(db, taskId)
        })
        return { status: "fenced", seats, preserved, lostLeases, leasesReleased, repair }
    } finally {
        db.close()
    }
}
