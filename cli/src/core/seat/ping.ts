import { openLedger } from "../../harness/ledger.js"
import { askOrca, isPingable, livenessOf, loadLiveness, recordPing } from "../../harness/liveness.js"
import type { PingAnswer, SeatLiveness } from "../../harness/liveness.js"
import { locateOrca } from "../../harness/orca/client.js"
import { SEAT_WORKER_LOST, getSeat } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** What one ping asked, what Orca answered, and the seat's liveness after it was recorded. */
interface SeatPingData {
    readonly seat: SeatRow
    readonly answer: PingAnswer
    readonly liveness: SeatLiveness
    readonly lostTask: string | null
}

const answerLine = (answer: PingAnswer): string => {
    if (answer.kind === "pong") return `pong: worker ${answer.state}${answer.lastOutputAt === null ? "" : ", last output " + answer.lastOutputAt}`
    if (answer.kind === "gone") return `gone: ${answer.evidence}`
    return `no answer: ${answer.why}; unknown is not dead`
}

/** The idle clause of the liveness line, empty when the last pong named no output time. */
const idleNote = (idleSeconds: number | null): string => (idleSeconds === null ? "" : ", no output for " + String(idleSeconds) + " s at the last pong")

/**
 * `starci seat ping <seat>`: asks Orca (worker-show, under the ping deadline of ops/liveness.yaml) about one open seat and
 * records the answer: last_ping_at always, last_pong_at and the worker's last output on a pong. Orca's explicit word that the
 * worker is gone makes the seat worker-lost and its running task effect_unknown (exit 1); no answer proves nothing.
 */
export const seatPingVerb = defineVerb({
    path: ["seat", "ping"],
    summary: "ask Orca whether a seat's worker is alive and record it (last pong, quiet time); a worker Orca reports gone is marked worker-lost (exit 1)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor", "coordinator"],
    schema: "starci/seat-ping@1",
    flags: {
        seat: { kind: "string", summary: "the seat id (starci seat list)", required: true, positional: true },
    },
    run: async (context, flags) => {
        const rules = loadLiveness()
        const root = await repositoryRoot(context.cwd)
        const db = openLedger(root)
        try {
            const seat = getSeat(db, flags.seat)
            if (seat.status === SEAT_WORKER_LOST) throw new Refusal("SEAT_LOST", `seat ${seat.id} is worker-lost already: Orca said its worker is gone (starci task status ${seat.taskId ?? "-"})`)
            if (!isPingable(seat)) throw new Refusal(seat.handle === null ? "SEAT_NO_DISPATCH" : "SEAT_CLOSED", `seat ${seat.id} is ${seat.status}${seat.handle === null ? " with no Orca dispatch" : ""}; there is no worker to ping`)
            const handle = seat.handle ?? ""
            const answer = await askOrca(await locateOrca(context.cwd), handle, context.cwd, rules)
            const recorded = recordPing(db, seat.id, answer)
            const liveness = livenessOf(recorded.seat, rules)
            const data: SeatPingData = { seat: recorded.seat, answer, liveness, lostTask: recorded.lostTask }
            const lines = [
                `seat ${seat.id} (dispatch ${handle}): ${answerLine(answer)}`,
                `liveness: ${liveness.verdict}, quiet ${String(liveness.quietSeconds)} s${idleNote(liveness.idleSeconds)}`,
                ...(recorded.lostTask === null ? [] : [`task ${recorded.lostTask} is effect_unknown and keeps its leases; cancel it (starci task cancel ${recorded.lostTask}) and retry it`]),
            ]
            return { data, message: lines.join("\n"), ...(answer.kind === "gone" ? { exitCode: 1 } : {}) }
        } finally {
            db.close()
        }
    },
})
