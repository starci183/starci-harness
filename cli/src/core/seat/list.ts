import { existsSync } from "node:fs"
import { ledgerPath, openLedger } from "../../harness/ledger.js"
import { OrcaFailure, locateOrca, workerShow } from "../../harness/orca/client.js"
import type { WorkerShown } from "../../harness/orca/client.js"
import { CLOSED_SEAT_STATUSES, listSeats } from "../../harness/seats.js"
import type { SeatRow } from "../../harness/seats.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"

/** What Orca says of a seat right now: its worker, or why it could not tell (which proves nothing about the worker). */
type LiveView = WorkerShown | { readonly error: string }

interface SeatView extends SeatRow {
    readonly live?: LiveView
}

interface SeatListData {
    readonly ledger: string
    readonly seats: readonly SeatView[]
}

const liveCell = (live: LiveView | undefined): string => {
    if (live === undefined) return "-"
    return "error" in live ? `unknown (${live.error.split("\n")[0] ?? ""})` : (live.state ?? "unknown")
}

/** `starci seat list`: the seats of this project's ledger; --live adds what Orca says of each open seat, without recording it. */
export const seatListVerb = defineVerb({
    path: ["seat", "list"],
    summary: "list the seats of this project's ledger; --live asks Orca for each open seat's worker state",
    editions: ["full"],
    effect: "read",
    roles: EVERYONE,
    schema: "starci/seat-list@1",
    flags: {
        live: { kind: "boolean", summary: "ask Orca (worker-show) for the state of every open seat; nothing is recorded" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const ledger = ledgerPath(root)
        // A read verb never creates the ledger: no ledger is simply no seats.
        if (!existsSync(ledger)) return { data: { ledger, seats: [] } satisfies SeatListData, message: "no seats (no ledger yet)" }
        const db = openLedger(root)
        let rows: SeatRow[]
        try {
            rows = listSeats(db)
        } finally {
            db.close()
        }
        const open = rows.filter((seat) => seat.handle !== null && !CLOSED_SEAT_STATUSES.includes(seat.status))
        const binary = flags.live && open.length > 0 ? await locateOrca(context.cwd) : undefined
        const seats: SeatView[] = []
        for (const seat of rows) {
            if (binary === undefined || seat.handle === null || !open.includes(seat)) {
                seats.push(seat)
                continue
            }
            // Only Orca's own answer is per seat; an orca that cannot even be started is refused for the whole listing.
            const live: LiveView = await workerShow(binary, seat.handle, context.cwd).catch((error: unknown) => {
                if (error instanceof OrcaFailure) return { error: error.message }
                throw error
            })
            seats.push({ ...seat, live })
        }
        const data: SeatListData = { ledger, seats }
        if (seats.length === 0) return { data, message: "no seats" }
        const header = ["SEAT", "ROLE", "AGENT", "MODEL", "TASK", "STATUS", "DISPATCH", "STARTED", ...(flags.live ? ["ORCA"] : [])]
        const table = seats.map((seat) => [seat.id, seat.role, seat.agent ?? "-", seat.model ?? "-", seat.taskId ?? "-", seat.status, seat.handle ?? "-", seat.startedAt, ...(flags.live ? [liveCell(seat.live)] : [])])
        return { data, message: formatTable([header, ...table]) }
    },
})
