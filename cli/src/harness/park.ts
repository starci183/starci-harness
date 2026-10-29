import { now } from "./ledger.js"
import { readMachine, withMachine } from "./machine.js"

/**
 * A parked project (`project park`): every workflow paused with a `parked` reason, every live seat stopped with its task's work
 * kept, every Kernel and the Supervisor closed, and no Orca terminal of it left. Nothing relaunches anything of it (the tick, its
 * sweeps and `supervisor ensure` read `isProjectParked` and the workflow's reason) until `project unpark`.
 */
export const PROJECT_PARKED = "project-parked"

/** The host event `project unpark` records; the newer of it and `project-parked` says whether a project is parked. */
export const PROJECT_UNPARKED = "project-unparked"

/** The ledger event a parked task's cancel records in its own transaction: revive.ts `harnessCause` reads it as `parked`. */
export const TASK_PARKED = "task-parked"

/** The ledger event recorded on a workflow park paused and whose Kernel it closed, and on its unpark. */
export const WORKFLOW_PARKED = "workflow-parked"

/** The ledger event recorded when unpark relaunched a parked workflow's Kernel and restored its status. */
export const WORKFLOW_UNPARKED = "workflow-unparked"

const PARKED_PREFIX = "parked: was "

/** The reason a parked workflow carries: the status (and reason) it had, which unpark restores. */
export const parkedReason = (status: string, reason: string | null): string => `${PARKED_PREFIX}${status}${reason === null ? "" : `: ${reason}`}`

/** True when a workflow's reason says park paused it. */
export const isParkedReason = (reason: string | null | undefined): boolean => reason?.startsWith(PARKED_PREFIX) === true

/** What a parked reason held: the status the workflow had and its reason then. */
export const parkedFrom = (reason: string): { readonly status: string; readonly reason: string | null } => {
    const rest = reason.slice(PARKED_PREFIX.length)
    const colon = rest.indexOf(": ")
    return colon < 0 ? { status: rest, reason: null } : { status: rest.slice(0, colon), reason: rest.slice(colon + 2) }
}

/** True when the newest park or unpark event of the project is a park. */
export const isProjectParked = (project: string): boolean =>
    readMachine((db) => db.prepare("SELECT kind FROM host_events WHERE kind IN (?, ?) AND subject = ? ORDER BY id DESC LIMIT 1").get(PROJECT_PARKED, PROJECT_UNPARKED, project)?.kind === PROJECT_PARKED, false)

/** Records a park or unpark of a project in the host store and returns the event's id. */
export const recordParkEvent = (kind: typeof PROJECT_PARKED | typeof PROJECT_UNPARKED, project: string, data: unknown): number =>
    withMachine((db) => Number(db.prepare("INSERT INTO host_events (at, kind, subject, data_json) VALUES (?, ?, ?, ?)").run(now(), kind, project, JSON.stringify(data)).lastInsertRowid))

/** Replaces what a park event records once the park has closed everything (it is recorded first, so no tick races the park). */
export const finishParkEvent = (id: number, data: unknown): void => {
    withMachine((db) => db.prepare("UPDATE host_events SET data_json = ? WHERE id = ?").run(JSON.stringify(data), id))
}
