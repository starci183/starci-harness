import type { DatabaseSync } from "node:sqlite"
import { loadCoordinatorLiveness, olderThan } from "./coordinator-liveness.js"
import { openLedger } from "./ledger.js"
import { judgeStart, loadLiveness } from "./liveness.js"
import { readMachine, textOf } from "./machine.js"
import { closeWorker, OrcaFailure, requestShow, workerShow } from "./orca/client.js"
import type { OrcaBinary, TerminalInventory, WorkerShown } from "./orca/client.js"
import { inOrder } from "./sequential.js"
import { getSeat, launchUnreconciled, noteTab, recordSeat, SEAT_LAUNCH_FAILED } from "./seats.js"
import type { SeatRow } from "./seats.js"
import { loadStallRules } from "./stall.js"

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/** worker-show of a dispatch: its answer, `gone` when Orca names no such dispatch, null when Orca did not answer. */
const showOrGone = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<WorkerShown | "gone" | null> =>
    workerShow(binary, dispatchId, cwd).catch((error: unknown) => (error instanceof OrcaFailure && error.effect === "none" && loadLiveness().goneErrors.includes(error.orcaCode ?? "") ? "gone" : null))

/**
 * Closes one stale unreconciled Kernel launch, or returns null to leave it: its dispatch (the seat's, else request-show's
 * receipt) judged by `judgeStart` must be dead or gone, or with no dispatch at all its terminal must be unknown or no longer
 * listed. A pending request, an Orca that does not answer, a listed terminal or a started worker leaves it alone.
 */
const closeStale = async (binary: OrcaBinary, cwd: string, root: string, seat: SeatRow, live: TerminalInventory): Promise<string | null> => {
    const request = seat.handle !== null || seat.requestId === null ? null : await requestShow(binary, seat.requestId, cwd).catch(() => null)
    if (request?.state === "pending" || (seat.handle === null && seat.requestId !== null && request === null)) return null
    const dispatchId = seat.handle ?? request?.dispatchId ?? null
    if (dispatchId === null) {
        if (seat.terminal !== null && live.handles.has(seat.terminal)) return null
        withLedger(root, (db) => { recordSeat(db, seat.id, { status: SEAT_LAUNCH_FAILED, facts: { stale: { request: request?.state ?? null, terminal: seat.terminal } } }); })
        return `Kernel launch ${seat.id} of ${seat.workflowId ?? "-"} in ${root}: no dispatch (request ${request?.state ?? "-"}) and no live terminal: closed launch-failed`
    }
    const shown = await showOrGone(binary, dispatchId, cwd)
    if (shown === null) return null
    const verdict = shown === "gone" ? "gone" : judgeStart({ shown, seat, live, alive: false }, loadStallRules()).verdict
    if (verdict !== "gone" && verdict !== "dead") return null
    const terminal = shown === "gone" ? seat.terminal : (shown.terminal ?? seat.terminal)
    const closed = shown === "gone" ? null : await closeWorker(binary, dispatchId, cwd, terminal)
    if (closed !== null && !closed.stopped) return null
    withLedger(root, (db) => {
        if (closed !== null) noteTab(db, seat.id, closed)
        recordSeat(db, seat.id, { status: SEAT_LAUNCH_FAILED, handle: dispatchId, facts: { stale: { verdict, closed } } })
    })
    return `Kernel launch ${seat.id} of ${seat.workflowId ?? "-"} in ${root}: dispatch ${dispatchId} ${verdict} and no live terminal: closed launch-failed`
}

/**
 * The host-wide reconcile of `supervisor tick`: in every registered ledger that is not retired, an open Kernel seat whose launch
 * is still unreconciled (`launchUnreconciled`) past effectUnknownDeadlineMinutes is closed launch-failed when nothing of it can
 * be alive (`closeStale`), whether or not a Supervisor owns its workflow, so an abandoned launch stops holding a pool slot. `live`
 * is a full terminal list (a truncated one proves no absence, and the reconcile is skipped).
 */
export const reconcileStaleLaunches = async (binary: OrcaBinary, cwd: string, live: TerminalInventory): Promise<string[]> => {
    if (live.truncated) return []
    const deadline = loadCoordinatorLiveness().effectUnknownDeadlineMinutes
    const roots = readMachine((db) => db.prepare("SELECT repo_root FROM ledgers WHERE state != 'retired'").all().map((row) => textOf(row.repo_root) ?? ""), [])
    const found = roots.flatMap((root) => {
        try {
            return withLedger(root, (db) =>
                db
                    .prepare("SELECT id FROM seats WHERE role = 'kernel' AND ended_at IS NULL")
                    .all()
                    .map((row) => getSeat(db, String(row.id)))
                    .filter((seat) => launchUnreconciled(seat) && olderThan(seat.startedAt, deadline))
                    .map((seat) => ({ root, seat })),
            )
        } catch {
            return []
        }
    })
    const lines = await inOrder(found, async ({ root, seat }) => closeStale(binary, cwd, root, seat, live).catch(() => null))
    return lines.filter((line): line is string => line !== null)
}
