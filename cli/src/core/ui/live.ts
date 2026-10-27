import { statSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { readMachine } from "../../harness/machine.js"
import { locateOps } from "../../harness/ops.js"
import { SETTINGS_FILES } from "../../harness/settings.js"
import { listWorkflows } from "../../harness/workflow.js"
import type { LiveEvent } from "./contract.js"
import { places, readLedger } from "./places.js"

/** The event kinds that open or close an owner decision: the inbox changes with them. */
const INBOX_KINDS: ReadonlySet<string> = new Set(["decision-raised", "command-applied", "command-failed"])

/** What the watcher remembers between polls: each ledger's newest event id, the host store's marker and the settings files' times. */
export interface Markers {
    readonly ledgers: ReadonlyMap<string, number>
    readonly machine: string
    readonly config: string
}

const newestEvent = (db: DatabaseSync): number => Number(db.prepare("SELECT MAX(id) AS id FROM events").get()?.id ?? 0)

/**
 * The host store's marker: the newest host and provider event, each Supervisor row's start and end, the circuits', quotas' and
 * windows' newest times and the registry's size. A read of the host store rewrites its meta row, so its file times prove nothing.
 */
const machineMarker = (): string =>
    JSON.stringify(
        readMachine(
            (db) =>
                db
                    .prepare(
                        "SELECT (SELECT MAX(id) FROM host_events) AS host, (SELECT MAX(id) FROM provider_events) AS provider, " +
                            "(SELECT group_concat(id || ':' || IFNULL(terminal, '') || ':' || IFNULL(ended_at, ''), ',') FROM project_supervisors WHERE ended_at IS NULL) AS supervisors, " +
                            "(SELECT MAX(updated_at) FROM provider_health) AS health, (SELECT MAX(observed_at) FROM pool_quota) AS quota, " +
                            "(SELECT MAX(observed_at) FROM pool_windows) AS windows, (SELECT MAX(updated_at) FROM pool_concurrency) AS pools, (SELECT COUNT(*) FROM ledgers) AS ledgers",
                    )
                    .get() ?? null,
            null,
        ),
    )

const configMarker = (): string => {
    const dir = locateOps()
    return SETTINGS_FILES.map((file) => String(statSync(join(dir, `${file}.yaml`), { throwIfNoEntry: false })?.mtimeMs ?? 0)).join(",")
}

/** The events of one ledger after `since`, as the changes they announce: the workflow or task they name, and the inbox. */
const ledgerChanges = (db: DatabaseSync, project: string, since: number): LiveEvent[] => {
    const rows = db.prepare("SELECT kind, subject FROM events WHERE id > ? ORDER BY id").all(since)
    if (rows.length === 0) return []
    const workflows = new Set(listWorkflows(db).map((workflow) => workflow.id))
    const taskOf = db.prepare("SELECT workflow_id FROM tasks WHERE id = ?")
    const changes: LiveEvent[] = []
    for (const row of rows) {
        const subject = typeof row.subject === "string" ? row.subject : null
        if (INBOX_KINDS.has(String(row.kind))) changes.push({ type: "inbox" })
        if (subject === null) continue
        if (workflows.has(subject)) {
            changes.push({ type: "workflow", project, workflow: subject })
            continue
        }
        const owner = taskOf.get(subject)?.workflow_id
        if (owner === undefined) continue
        changes.push({ type: "task", project, task: subject })
        if (typeof owner === "string") changes.push({ type: "workflow", project, workflow: owner })
    }
    return changes
}

/** Each distinct change once, in the order first seen. */
const distinct = (changes: readonly LiveEvent[]): LiveEvent[] => [...new Map(changes.map((change) => [JSON.stringify(change), change])).values()]

/**
 * One poll: the markers now, and the changes since `before` (none on the first poll, which only learns where each store stands).
 * Any change at all announces the overview too.
 */
export const poll = async (before: Markers | undefined): Promise<{ readonly markers: Markers; readonly changes: readonly LiveEvent[] }> => {
    const ledgers = new Map<string, number>()
    const changes: LiveEvent[] = []
    for (const place of await places()) {
        const known = before?.ledgers.get(place.repo)
        const newest = readLedger(
            place.repo,
            (db) => {
                const id = newestEvent(db)
                if (known !== undefined && id > known) changes.push(...ledgerChanges(db, place.project.key, known))
                return id
            },
            0,
        )
        ledgers.set(place.repo, newest)
        if (before !== undefined && known === undefined) changes.push({ type: "overview" })
    }
    const markers: Markers = { ledgers, machine: machineMarker(), config: configMarker() }
    if (before === undefined) return { markers, changes: [] }
    if (markers.config !== before.config) changes.push({ type: "config" })
    if (markers.machine !== before.machine || changes.length > 0) changes.unshift({ type: "overview" })
    return { markers, changes: distinct(changes) }
}
