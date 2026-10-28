import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { now } from "../../harness/ledger.js"
import { readMachine, textOf, withMachine } from "../../harness/machine.js"
import { locateOrca, projectSetupDelete, projectSetups, terminalList, worktreeList } from "../../harness/orca/client.js"
import type { OrcaBinary } from "../../harness/orca/client.js"
import { CLOSED_SEAT_STATUSES } from "../../harness/seats.js"
import { retireWorktrees } from "../../harness/worktree-gc.js"
import type { GcEntry } from "../../harness/worktree-gc.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import { samePath } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

interface ProjectRetireData {
    readonly ledger: string
    readonly name: string
    readonly state: "retired" | "active"
    readonly openSeats: readonly string[]
    readonly worktrees: readonly GcEntry[]
    readonly orca: string
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
 * Detaches a retired repository from Orca's project list (`orca project setup-delete`, metadata only: the folder and its git
 * stay), once Orca lists no worktree of it but its main checkout; a worktree Orca still lists, an unknown repository or Orca's
 * own refusal (open terminals, saved workspace details) leaves it attached and says why.
 */
const detachFromOrca = async (binary: OrcaBinary, repo: string, cwd: string): Promise<string> => {
    const setup = (await projectSetups(binary, cwd)).find((one) => samePath(one.path, repo))
    if (setup === undefined) return `Orca lists no project set up at ${repo}`
    const others = (await worktreeList(binary, repo, cwd)).filter((one) => !samePath(one.path, repo))
    if (others.length > 0) return `left in Orca: it still lists ${others.map((one) => one.path).join(", ")}`
    try {
        await projectSetupDelete(binary, setup.id, cwd)
        return `detached from Orca (setup ${setup.id})`
    } catch (error: unknown) {
        return `left in Orca, which refused to detach it: ${asRefusal(error).message.split("\n")[0] ?? ""}`
    }
}

/**
 * `starci project retire <ledger>`: marks an abandoned project's ledger retired in the host registry (machine.sqlite `ledgers`),
 * so no sweep, tick, pool count or outcome read reaches it any more; `--restore` makes it active again. Refused while Orca still
 * lists the terminal of one of its open seats (RETIRE_LIVE): stop those seats first. Retiring also removes every worktree the
 * harness made for it (its work preserved first, branches kept, harness/worktree-gc.ts retireWorktrees) and then detaches the
 * repository from Orca's project list; the ledger file and the repository itself are kept.
 */
export const projectRetireVerb = defineVerb({
    path: ["project", "retire"],
    summary: "retire an abandoned project's ledger from the host registry (no sweep, tick or pool count reads it), remove its harness worktrees and detach it from Orca; --restore reverses the registry",
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
        const row = readMachine((db) => db.prepare("SELECT ledger_id, name, file, repo_root FROM ledgers WHERE ledger_id = ? OR name = ?").all(given, given), [])
        if (row.length !== 1) throw new Refusal("LEDGER_UNKNOWN", row.length === 0 ? `no registered ledger ${given}` : `${given} names ${String(row.length)} ledgers; give the ledger id`)
        const ledger = String(row[0]?.ledger_id)
        const name = String(row[0]?.name)
        const repo = String(row[0]?.repo_root)
        const open = openSeatsOf(String(row[0]?.file))
        const state = flags.restore ? "active" : "retired"
        const binary = state === "retired" ? await locateOrca(context.cwd) : undefined
        if (binary !== undefined) {
            const live = await terminalList(binary, context.cwd)
            const alive = open.filter((seat) => seat.terminal !== null && (live.truncated || live.handles.has(seat.terminal)))
            if (alive.length > 0) throw new Refusal("RETIRE_LIVE", `ledger ${ledger} has open seats whose terminal Orca lists: ${alive.map((seat) => `${seat.id} (${seat.terminal ?? "-"})`).join(", ")}; stop them first (starci seat stop)`)
        }
        withMachine((db) => {
            db.prepare("UPDATE ledgers SET state = ? WHERE ledger_id = ?").run(state, ledger)
            db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), state === "retired" ? "ledger-retired" : "ledger-restored", ledger, JSON.stringify({ name, openSeats: open.map((seat) => seat.id) }))
        })
        const present = existsSync(repo)
        const worktrees = binary !== undefined && present ? await retireWorktrees(repo) : []
        const orca = binary === undefined ? "Orca untouched" : present ? await detachFromOrca(binary, repo, context.cwd).catch((error: unknown) => `Orca not reached: ${asRefusal(error).message.split("\n")[0] ?? ""}`) : `${repo} is gone; Orca untouched`
        if (binary !== undefined) withMachine((db) => db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), "ledger-retired-cleanup", ledger, JSON.stringify({ worktrees, orca })))
        const data: ProjectRetireData = { ledger, name, state, openSeats: open.map((seat) => seat.id), worktrees, orca }
        const left = open.length === 0 ? "" : `; its open seats (${data.openSeats.join(", ")}) no longer count`
        const lines = worktrees.map((entry) => `worktree ${entry.kind} ${entry.path} ${entry.removed ? "removed" : "left"}: ${entry.detail}${entry.preserved === null ? "" : `; its work preserved in ${entry.preserved}`}`)
        return { data, message: [`ledger ${ledger} (${name}) is ${state}${state === "retired" ? left : ""}`, ...lines, ...(state === "retired" ? [`orca: ${orca}`] : [])].join("\n") }
    },
})
