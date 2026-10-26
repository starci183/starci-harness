import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { now } from "./ledger.js"
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

/** The status of a seat whose terminal Orca released; nothing of it is left on the host. */
export const SEAT_RELEASED = "released"

/** Statuses after which a seat holds nothing on the host. */
export const CLOSED_SEAT_STATUSES: readonly SeatStatus[] = [SEAT_LAUNCH_FAILED, SEAT_RELEASED]

/** A seat as the ledger stores it; `handle` is Orca's dispatch id, the key every worker verb takes. */
export interface SeatRow {
    readonly id: string
    readonly role: SeatRole
    readonly agent: string | null
    readonly handle: string | null
    readonly taskId: string | null
    readonly status: SeatStatus
    readonly lastPongAt: string | null
    readonly startedAt: string
}

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const optText = (value: unknown): string | null => (value === null || value === undefined ? null : text(value))

const toSeat = (row: Record<string, unknown>): SeatRow => ({
    id: text(row.id),
    role: text(row.role) as SeatRole,
    agent: optText(row.agent),
    handle: optText(row.handle),
    taskId: optText(row.task_id),
    status: text(row.status),
    lastPongAt: optText(row.last_pong_at),
    startedAt: text(row.started_at),
})

/** One seat by id; refuses an unknown id. */
export const getSeat = (db: DatabaseSync, id: string): SeatRow => {
    const row = db.prepare("SELECT * FROM seats WHERE id = ?").get(id)
    if (row === undefined) throw new Refusal("SEAT_UNKNOWN", `no seat ${id} in this project's ledger`)
    return toSeat(row)
}

/** Every seat, newest first. */
export const listSeats = (db: DatabaseSync): SeatRow[] => db.prepare("SELECT * FROM seats ORDER BY started_at DESC, id").all().map(toSeat)

/** Opens a seat row in `starting` before its launch is issued, so a launch that dies half-way still leaves its trace. */
export const openSeat = (db: DatabaseSync, seat: { readonly role: SeatRole; readonly agent: string; readonly taskId: string; readonly facts?: unknown }): SeatRow => {
    const id = `s-${randomUUID().slice(0, 8)}`
    db.prepare("INSERT INTO seats (id, role, agent, handle, task_id, status, last_pong_at, started_at) VALUES (?, ?, ?, NULL, ?, 'starting', NULL, ?)").run(
        id,
        seat.role,
        seat.agent,
        seat.taskId,
        now(),
    )
    recordEvent(db, "seat-opened", id, { role: seat.role, agent: seat.agent, taskId: seat.taskId, ...(seat.facts === undefined ? {} : { facts: seat.facts }) })
    return getSeat(db, id)
}

/** Records what Orca said about a seat: its status, and its dispatch handle once known; `facts` go to the event log as they were. */
export const recordSeat = (db: DatabaseSync, id: string, update: { readonly status: SeatStatus; readonly handle?: string; readonly facts?: unknown }): SeatRow => {
    const seat = getSeat(db, id)
    db.prepare("UPDATE seats SET status = ?, handle = COALESCE(?, handle) WHERE id = ?").run(update.status, update.handle ?? null, id)
    recordEvent(db, "seat-status", id, { from: seat.status, to: update.status, ...(update.handle === undefined ? {} : { handle: update.handle }), ...(update.facts === undefined ? {} : { facts: update.facts }) })
    return getSeat(db, id)
}
