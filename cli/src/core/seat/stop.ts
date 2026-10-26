import { openLedger } from "../../harness/ledger.js"
import { closeWorker, locateOrca } from "../../harness/orca/client.js"
import type { WorkerClosed } from "../../harness/orca/client.js"
import { CLOSED_SEAT_STATUSES, SEAT_RELEASED, getSeat, recordSeat } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

interface SeatStopData {
    readonly seat: SeatRow
    readonly closed: WorkerClosed
}

/** `starci seat stop <seat>`: stops the seat's Orca worker and releases its terminal; the task's own state is `task cancel`'s. */
export const seatStopVerb = defineVerb({
    path: ["seat", "stop"],
    summary: "stop one seat's Orca worker and release its terminal; the seat's task keeps its state",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner", "kernel", "supervisor", "coordinator"],
    schema: "starci/seat-stop@1",
    flags: {
        seat: { kind: "string", summary: "the seat id (starci seat list)", required: true, positional: true },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            const seat = getSeat(db, flags.seat)
            if (CLOSED_SEAT_STATUSES.includes(seat.status)) throw new Refusal("SEAT_CLOSED", `seat ${seat.id} is already ${seat.status}; nothing of it is left to stop`)
            if (seat.handle === null) throw new Refusal("SEAT_NO_DISPATCH", `seat ${seat.id} never got an Orca dispatch (status ${seat.status}); there is no worker to stop`)
            const binary = await locateOrca(context.cwd)
            const closed = await closeWorker(binary, seat.handle, context.cwd)
            // Each answer is recorded as it came; only a released terminal closes the seat, so a repeat finishes a half-closed one.
            const answered = [closed.release, closed.stop].find((state) => !state.startsWith("error: "))
            const after = recordSeat(db, seat.id, { status: closed.settled ? SEAT_RELEASED : (answered ?? seat.status), facts: { closed } })
            if (!closed.settled) throw new Refusal("ORCA_FAILED", `seat ${seat.id} (dispatch ${seat.handle}) is not released: stop ${closed.stop}, release ${closed.release}; run seat stop again once Orca answers`)
            return { data: { seat: after, closed } satisfies SeatStopData, message: `seat ${seat.id} stopped (${closed.stop}) and released; dispatch ${seat.handle}` }
        } finally {
            db.close()
        }
    },
})
