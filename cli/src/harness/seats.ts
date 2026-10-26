import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { now, openLedger } from "./ledger.js"
import { closeWorker, locateOrca } from "./orca/client.js"
import type { WorkerClosed } from "./orca/client.js"
import { recordEvent } from "./tasks.js"

/** Who a seat is. P1 launches workers only; the Kernel and Supervisor seats come later. */
export type SeatRole = "worker" | "kernel" | "supervisor" | "debug"

/**
 * A seat's status is a fact, not a liveness verdict (that is P2): `starting` while the launch is issued, then the state Orca
 * last reported (`ready`, `stopped`, ...), or `launch-failed` and `released` when the harness closes it.
 */
export type SeatStatus = string

/** The status of a seat whose launch failed and whose leftovers were cleaned up (or never existed). */
export const SEAT_LAUNCH_FAILED = "launch-failed"

/** The status of a seat whose launch failed but whose leftover dispatch could not be released; `seat stop` finishes it. */
export const SEAT_LAUNCH_UNSETTLED = "launch-unsettled"

/**
 * The status of a seat whose launch Orca could not confirm or deny (outcome_unknown, a lost or unreadable receipt, a timeout).
 * Unknown is never dead: the seat stays open, its task stays effect_unknown with its leases, and `seat start <task> --resume`
 * replays the launch under the same request id.
 */
export const SEAT_LAUNCH_UNKNOWN = "launch-unknown"

/** The status of a seat in launch, before Orca answered. */
export const SEAT_STARTING = "starting"

/** The status of a seat whose worker Orca fenced and stopped but whose terminal is not released yet; `seat stop` finishes it. */
export const SEAT_STOPPED = "stopped"

/** The status of a seat whose terminal Orca released; nothing of it is left on the host. */
export const SEAT_RELEASED = "released"

/** Statuses after which a seat holds nothing on the host. */
export const CLOSED_SEAT_STATUSES: readonly SeatStatus[] = [SEAT_LAUNCH_FAILED, SEAT_RELEASED]

/**
 * A seat as the ledger stores it; `handle` is Orca's dispatch id, the key every worker verb takes. `launch` is everything its
 * launch sent to Orca (replayed as it was by a resume), `requestId` the worker-start request id, `runId` the Orca Run.
 */
export interface SeatRow {
    readonly id: string
    readonly role: SeatRole
    readonly agent: string | null
    readonly model: string | null
    readonly attemptId: string | null
    readonly handle: string | null
    readonly taskId: string | null
    readonly status: SeatStatus
    readonly requestId: string | null
    readonly runId: string | null
    readonly launch: unknown
    readonly lastPongAt: string | null
    readonly startedAt: string
    readonly endedAt: string | null
}

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const optText = (value: unknown): string | null => (value === null || value === undefined ? null : text(value))

// A ledger opened read-only may predate the version 2 columns; a missing column reads as null.
const toSeat = (row: Record<string, unknown>): SeatRow => {
    const launch = optText(row.launch_json)
    return {
        id: text(row.id),
        role: text(row.role) as SeatRole,
        agent: optText(row.agent),
        model: optText(row.model),
        attemptId: optText(row.attempt_id),
        handle: optText(row.handle),
        taskId: optText(row.task_id),
        status: text(row.status),
        requestId: optText(row.request_id),
        runId: optText(row.run_id),
        launch: launch === null ? null : JSON.parse(launch),
        lastPongAt: optText(row.last_pong_at),
        startedAt: text(row.started_at),
        endedAt: optText(row.ended_at),
    }
}

/** One seat by id; refuses an unknown id. */
export const getSeat = (db: DatabaseSync, id: string): SeatRow => {
    const row = db.prepare("SELECT * FROM seats WHERE id = ?").get(id)
    if (row === undefined) throw new Refusal("SEAT_UNKNOWN", `no seat ${id} in this project's ledger`)
    return toSeat(row)
}

/** Every seat, newest first. */
export const listSeats = (db: DatabaseSync): SeatRow[] => db.prepare("SELECT * FROM seats ORDER BY started_at DESC, id").all().map(toSeat)

/** The seats of one task, newest first. */
export const seatsOfTask = (db: DatabaseSync, taskId: string): SeatRow[] => db.prepare("SELECT * FROM seats WHERE task_id = ? ORDER BY started_at DESC, id").all(taskId).map(toSeat)

/** True while a seat may still hold something on the host. */
export const isSeatOpen = (seat: SeatRow): boolean => !CLOSED_SEAT_STATUSES.includes(seat.status)

/** What a seat is opened with: who, on which task and attempt, and the launch it is about to send. */
export interface SeatOpening {
    readonly role: SeatRole
    readonly agent: string
    readonly model: string
    readonly taskId: string
    readonly attemptId: string
    readonly requestId: string
    readonly launch: unknown
}

/** Opens a seat row in `starting` before its launch is issued, so a launch that dies half-way still leaves its trace (and its launch to replay). */
export const openSeat = (db: DatabaseSync, seat: SeatOpening): SeatRow => {
    const id = `s-${randomUUID().slice(0, 8)}`
    db.prepare(
        "INSERT INTO seats (id, role, agent, model, attempt_id, handle, task_id, status, request_id, run_id, launch_json, last_pong_at, started_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, ?, NULL)",
    ).run(id, seat.role, seat.agent, seat.model, seat.attemptId, seat.taskId, SEAT_STARTING, seat.requestId, JSON.stringify(seat.launch), now())
    recordEvent(db, "seat-opened", id, { role: seat.role, agent: seat.agent, model: seat.model, taskId: seat.taskId, attempt: seat.attemptId, request: seat.requestId })
    return getSeat(db, id)
}

/** What Orca said about a seat: its status, its dispatch handle and Run once known; `facts` go to the event log as they were. */
export interface SeatUpdate {
    readonly status: SeatStatus
    readonly handle?: string
    readonly runId?: string
    readonly facts?: unknown
}

/** Records what Orca said about a seat; a seat that reaches a closed status gets its end time once. */
export const recordSeat = (db: DatabaseSync, id: string, update: SeatUpdate): SeatRow => {
    const seat = getSeat(db, id)
    const endedAt = CLOSED_SEAT_STATUSES.includes(update.status) ? now() : null
    db.prepare("UPDATE seats SET status = ?, handle = COALESCE(?, handle), run_id = COALESCE(?, run_id), ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(
        update.status,
        update.handle ?? null,
        update.runId ?? null,
        endedAt,
        id,
    )
    recordEvent(db, "seat-status", id, {
        from: seat.status,
        to: update.status,
        ...(update.handle === undefined ? {} : { handle: update.handle }),
        ...(update.runId === undefined ? {} : { runId: update.runId }),
        ...(update.facts === undefined ? {} : { facts: update.facts }),
    })
    return getSeat(db, id)
}

/** What closing one seat of a task did: its worker closed (terminal released), fenced only, not fenced, or no dispatch to close yet. */
export interface SeatClosing {
    readonly seat: string
    readonly handle: string | null
    readonly outcome: "closed" | "stopped" | "not-stopped" | "no-dispatch" | "launch-unknown"
    readonly closed: WorkerClosed | null
}

/**
 * Stops and releases every open seat of a task through Orca and records each answer; for a task that ended (done or failed) or
 * is being cancelled. A seat still starting has no dispatch yet: its own `seat start` closes the worker once it sees the task is
 * no longer its own. A launch whose outcome is unknown and named no dispatch may have a worker nobody can address yet: it is
 * reported `launch-unknown` (a resume learns its dispatch). Opens its own ledger connection, so call it outside a transaction.
 */
export const closeSeatsOfTask = async (root: string, taskId: string): Promise<SeatClosing[]> => {
    const db = openLedger(root)
    try {
        const open = seatsOfTask(db, taskId).filter(isSeatOpen)
        if (open.length === 0) return []
        const binary = open.some((seat) => seat.handle !== null) ? await locateOrca(root) : undefined
        const closings: SeatClosing[] = []
        for (const seat of open) {
            if (seat.handle === null || binary === undefined) {
                closings.push({ seat: seat.id, handle: null, outcome: seat.status === SEAT_LAUNCH_UNKNOWN ? "launch-unknown" : "no-dispatch", closed: null })
                continue
            }
            const closed = await closeWorker(binary, seat.handle, root)
            const outcome = closed.settled ? "closed" : closed.stopped ? "stopped" : "not-stopped"
            recordSeat(db, seat.id, { status: closed.settled ? SEAT_RELEASED : closed.stopped ? SEAT_STOPPED : seat.status, facts: { closed, closedFor: taskId } })
            closings.push({ seat: seat.id, handle: seat.handle, outcome, closed })
        }
        return closings
    } finally {
        db.close()
    }
}
