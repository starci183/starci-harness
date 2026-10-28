import { randomBytes } from "node:crypto"
import { basename } from "node:path"
import { Refusal } from "../shared/errors.js"
import { now } from "./ledger.js"
import { readMachine, textOf, withMachine } from "./machine.js"
import type { Project } from "./work.js"

/**
 * An owner request in a project's mailbox (machine.sqlite `owner_requests`): who handed it (`supervisor ask`, role owner or debug),
 * its text and when; closed by the Supervisor command (`cmdId`) whose `answers` name it, with that command's workflow and repository.
 */
export interface OwnerRequest {
    readonly id: string
    readonly project: string
    readonly projectRoot: string
    readonly by: string
    readonly text: string
    readonly at: string
    readonly closedBy: string | null
    readonly closedAt: string | null
    readonly workflow: string | null
    readonly repository: string | null
}

const ID = /^r-[0-9a-f]{12}$/

/** True for the id of an owner request (`r-` and twelve hex digits); a ledger decision's id starts with `d-`. */
export const isOwnerRequestId = (id: string): boolean => ID.test(id)

const toRequest = (row: Record<string, unknown>): OwnerRequest => ({
    id: String(row.id),
    project: String(row.project),
    projectRoot: String(row.project_root),
    by: String(row.by),
    text: String(row.text),
    at: String(row.at),
    closedBy: textOf(row.closed_by),
    closedAt: textOf(row.closed_at),
    workflow: textOf(row.workflow_id),
    repository: textOf(row.repository),
})

/** Records an owner request for a project's Supervisor and returns it. */
export const recordOwnerRequest = (project: Project, by: string, text: string): OwnerRequest => {
    const request: OwnerRequest = { id: `r-${randomBytes(6).toString("hex")}`, project: project.key, projectRoot: project.root, by, text, at: now(), closedBy: null, closedAt: null, workflow: null, repository: null }
    withMachine((db) => db.prepare("INSERT INTO owner_requests (id, project, project_root, by, text, at) VALUES (?, ?, ?, ?, ?, ?)").run(request.id, request.project, request.projectRoot, by, text, request.at))
    return request
}

/** A project's open owner requests, oldest first. */
export const openOwnerRequests = (project: string): OwnerRequest[] =>
    readMachine((db) => db.prepare("SELECT * FROM owner_requests WHERE project = ? AND closed_at IS NULL ORDER BY at, id").all(project), []).map(toRequest)

/** The projects holding an open owner request: their Supervisor is kept even after the owner's `supervisor stop`. */
export const ownerRequestProjects = (): Project[] =>
    readMachine((db) => db.prepare("SELECT project, MIN(project_root) AS project_root FROM owner_requests WHERE closed_at IS NULL GROUP BY project").all(), []).map((row) => ({
        key: String(row.project),
        root: String(row.project_root),
        name: basename(String(row.project_root)),
    }))

/**
 * Refuses the owner requests a Supervisor command's `answers` name unless each is a request of the command's project still open
 * (OWNER_REQUEST_UNKNOWN), or closed by this same cmdId already (a replay); a request another command closed is STALE.
 */
export const assertOwnerRequests = (project: string, ids: readonly string[], cmdId: string): void => {
    if (ids.length === 0) return
    const known = readMachine((db) => ids.map((id) => db.prepare("SELECT * FROM owner_requests WHERE id = ?").get(id)), [])
    ids.forEach((id, index) => {
        const row = known[index]
        const request = row === undefined ? undefined : toRequest(row)
        if (request?.project !== project) throw new Refusal("OWNER_REQUEST_UNKNOWN", `answers names ${id}, which is no owner request of this project; read it with supervisor next`)
        if (request.closedBy !== null && request.closedBy !== cmdId) throw new Refusal("STALE", `owner request ${id} was closed already by ${request.closedBy}; re-read with supervisor next`)
    })
}

/** Closes the owner requests a Supervisor command answered, recording the command, its workflow and repository; idempotent. */
export const closeOwnerRequests = (ids: readonly string[], by: { readonly cmdId: string; readonly workflow: string; readonly repository: string }): void => {
    if (ids.length === 0) return
    withMachine((db) => {
        for (const id of ids) db.prepare("UPDATE owner_requests SET closed_by = ?, closed_at = ?, workflow_id = ?, repository = ? WHERE id = ? AND closed_at IS NULL").run(by.cmdId, now(), by.workflow, by.repository, id)
    })
}
