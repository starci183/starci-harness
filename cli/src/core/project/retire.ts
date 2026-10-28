import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { now } from "../../harness/ledger.js"
import { readMachine, textOf, withMachine } from "../../harness/machine.js"
import { locateOrca, terminalList } from "../../harness/orca/client.js"
import { CLOSED_SEAT_STATUSES } from "../../harness/seats.js"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

interface ProjectRetireData {
    readonly ledger: string
    readonly name: string
    readonly state: "retired" | "active"
    readonly openSeats: readonly string[]
}

/** The open seats of a ledger file with the terminal each recorded, read-only; none when the file is gone. */
const openSeatsOf = (file: string): { readonly id: string; readonly terminal: string | null }[] => {
    if (!existsSync(file)) return []
    const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 })
    try {
        return db
            .prepare("SELECT id, status, terminal FROM seats WHERE ended_at IS NULL")
            .all()
            .filter((row) => !CLOSED_SEAT_STATUSES.includes(String(row.status)))
            .map((row) => ({ id: String(row.id), terminal: textOf(row.terminal) }))
    } finally {
        db.close()
    }
}

/**
 * `starci project retire <ledger>`: marks an abandoned project's ledger retired in the host registry (machine.sqlite `ledgers`),
 * so no sweep, tick, pool count or outcome read reaches it any more; `--restore` makes it active again. Refused while Orca still
 * lists the terminal of one of its open seats (RETIRE_LIVE): stop those seats first. The ledger file itself is kept.
 */
export const projectRetireVerb = defineVerb({
    path: ["project", "retire"],
    summary: "retire an abandoned project's ledger from the host registry (no sweep, tick or pool count reads it); --restore reverses it",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/project-retire@1",
    flags: {
        ledger: { kind: "string", positional: true, summary: "the ledger id or project name, as machine.sqlite ledgers lists it" },
        restore: { kind: "boolean", summary: "make a retired ledger active again" },
    },
    run: async (context, flags) => {
        const given = flags.ledger
        if (given === undefined || given === "") throw new Refusal("CLI_USAGE", "name the ledger id or project name to retire")
        const row = readMachine((db) => db.prepare("SELECT ledger_id, name, file FROM ledgers WHERE ledger_id = ? OR name = ?").all(given, given), [])
        if (row.length !== 1) throw new Refusal("LEDGER_UNKNOWN", row.length === 0 ? `no registered ledger ${given}` : `${given} names ${String(row.length)} ledgers; give the ledger id`)
        const ledger = String(row[0]?.ledger_id)
        const name = String(row[0]?.name)
        const open = openSeatsOf(String(row[0]?.file))
        const state = flags.restore ? "active" : "retired"
        if (state === "retired") {
            const live = await terminalList(await locateOrca(context.cwd), context.cwd)
            const alive = open.filter((seat) => seat.terminal !== null && (live.truncated || live.handles.has(seat.terminal)))
            if (alive.length > 0) throw new Refusal("RETIRE_LIVE", `ledger ${ledger} has open seats whose terminal Orca lists: ${alive.map((seat) => `${seat.id} (${seat.terminal ?? "-"})`).join(", ")}; stop them first (starci seat stop)`)
        }
        withMachine((db) => {
            db.prepare("UPDATE ledgers SET state = ? WHERE ledger_id = ?").run(state, ledger)
            db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), state === "retired" ? "ledger-retired" : "ledger-restored", ledger, JSON.stringify({ name, openSeats: open.map((seat) => seat.id) }))
        })
        const data: ProjectRetireData = { ledger, name, state, openSeats: open.map((seat) => seat.id) }
        const left = open.length === 0 ? "" : `; its open seats (${data.openSeats.join(", ")}) no longer count`
        return { data, message: `ledger ${ledger} (${name}) is ${state}${state === "retired" ? left : ""}` }
    },
})
