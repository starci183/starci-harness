import { createHash, randomBytes } from "node:crypto"
import { basename } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { awaitsOwner, escalationOf, openDecisions } from "./coordinator-commands.js"
import type { Decision } from "./coordinator-commands.js"
import { now, openExistingLedger } from "./ledger.js"
import { readMachine, textOf, withMachine } from "./machine.js"
import { askSupervisor } from "./owner-ask.js"
import { registeredRepositories } from "./project-workers.js"
import { inOrder } from "./sequential.js"
import { projectOf } from "./work.js"
import type { Project } from "./work.js"

/**
 * What a ticket is about. A defect goes to Debug's queue: of the harness itself, a `@starci` package, a launch, a verify, the
 * router, or anything else. A question goes to the owner: an unclear product rule, flow or spec (`question:business`), an unclear
 * design or code choice (`question:code`), a gap or contradiction in the SRS or SDS (`question:spec`).
 */
export const TICKET_KINDS = ["harness-defect", "package", "launch", "verify", "routing", "other", "question:business", "question:code", "question:spec"] as const

/** A ticket's kind. */
export type TicketKind = (typeof TICKET_KINDS)[number]

/** True for the question kinds, which the owner answers; every other kind is a defect Debug closes. */
export const isQuestion = (kind: TicketKind): boolean => kind.startsWith("question:")

/** `blocking` stops a workflow or a Supervisor's work until it is resolved; `normal` does not. */
export const TICKET_SEVERITIES = ["blocking", "normal"] as const

/** A ticket's severity. */
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number]

/** A ticket's states: open and in-progress (Debug took it) are live; fixed, wontfix, duplicate and answered (a question) end it. */
export const TICKET_STATES = ["open", "in-progress", "fixed", "wontfix", "duplicate", "answered"] as const

/** A ticket's state. */
export type TicketState = (typeof TICKET_STATES)[number]

/** A ticket id's prefix (`tk-` and twelve hex digits), apart from a task's `t-`, a decision's `d-` and a request's `r-`. */
export const TICKET_PREFIX = "tk-"

const LIVE: readonly TicketState[] = ["open", "in-progress"]

/** True while the ticket still owes an answer or a fix. */
export const isLive = (state: TicketState): boolean => LIVE.includes(state)

/** What a ticket carries as evidence: the task, workflow, seat, attempt and decision it came from, the question, and a red output's tail (redacted). */
export interface TicketEvidence {
    readonly task?: string
    readonly workflow?: string
    readonly seat?: string
    readonly attempt?: string
    readonly decision?: string
    readonly question?: string
    /** An owner escalation's topic (OWNER_TOPICS of harness/coordinator-commands.ts). */
    readonly topic?: string
    readonly tail?: string
}

/** A ticket as the host store keeps it. */
export interface Ticket {
    readonly id: string
    readonly fingerprint: string
    readonly project: Project
    readonly workflow: string | null
    readonly kind: TicketKind
    readonly severity: TicketSeverity
    readonly title: string
    readonly evidence: TicketEvidence
    readonly tried: string | null
    /** A question's proposed default, which the owner may simply accept, and the other answers its asker listed. */
    readonly proposedDefault: string | null
    readonly options: readonly string[]
    readonly state: TicketState
    /** The role that opened it, and its seat (the caller's Orca terminal), when it has one. */
    readonly openedBy: string
    readonly openedSeat: string | null
    /** Every role that reported it, the opener first: a repeat from another role lands here, never in a second ticket. */
    readonly reporters: readonly string[]
    readonly takenBy: string | null
    readonly fixedBy: string | null
    /** A question's answer. */
    readonly answer: string | null
    /** Why it closed as it did: the wontfix reason, or why the answer holds. */
    readonly reason: string | null
    readonly duplicateOf: string | null
    /** Who fixed, answered or otherwise closed it. */
    readonly closedBy: string | null
    readonly occurrences: number
    /** 1, and one more each time a repeat reopens a fixed ticket. */
    readonly round: number
    readonly openedAt: string
    readonly lastSeenAt: string
    readonly takenAt: string | null
    readonly closedAt: string | null
}

/** A task or decision waiting on a ticket: released, and its project's Supervisor woken, when the ticket closes or is answered. */
export interface TicketWaiter {
    readonly repo: string
    /** `task:<id>` or `decision:<id>`. */
    readonly subject: string
    readonly project: Project
    readonly workflow: string | null
    readonly releasedAt: string | null
    readonly requestId: string | null
}

/** A waiter as `openTicket` links it. */
export type WaiterInput = Pick<TicketWaiter, "repo" | "subject" | "project" | "workflow">

const projectOfRow = (key: unknown, root: unknown): Project => {
    const path = textOf(root) ?? ""
    return { key: textOf(key) ?? "", root: path, name: basename(path) }
}

const toTicket = (row: Record<string, unknown>): Ticket => ({
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    project: projectOfRow(row.project, row.project_root),
    workflow: textOf(row.workflow_id),
    kind: String(row.kind) as TicketKind,
    severity: String(row.severity) as TicketSeverity,
    title: String(row.title),
    evidence: JSON.parse(String(row.evidence_json)) as TicketEvidence,
    tried: textOf(row.tried),
    proposedDefault: textOf(row.proposed_default),
    options: JSON.parse(String(row.options_json)) as string[],
    state: String(row.state) as TicketState,
    openedBy: String(row.opened_by),
    openedSeat: textOf(row.opened_seat),
    reporters: JSON.parse(String(row.reporters_json)) as string[],
    takenBy: textOf(row.taken_by),
    fixedBy: textOf(row.fixed_by),
    answer: textOf(row.answer),
    reason: textOf(row.reason),
    duplicateOf: textOf(row.duplicate_of),
    closedBy: textOf(row.closed_by),
    occurrences: Number(row.occurrences),
    round: Number(row.round),
    openedAt: String(row.opened_at),
    lastSeenAt: String(row.last_seen_at),
    takenAt: textOf(row.taken_at),
    closedAt: textOf(row.closed_at),
})

const toWaiter = (row: Record<string, unknown>): TicketWaiter => ({
    repo: String(row.repo),
    subject: String(row.subject),
    project: projectOfRow(row.project, row.project_root),
    workflow: textOf(row.workflow_id),
    releasedAt: textOf(row.released_at),
    requestId: textOf(row.request_id),
})

const ERROR_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/
const MODULE = /\b(?:cli\/src|ops|policy|packages|contexts|skills|bench)\/[\w./-]*\.(?:ts|mts|mjs|js|ya?ml|md|json)\b/

/** The first refusal or error code a text names (`TELEGRAM_API`), or null. */
export const errorCodeOf = (text: string): string | null => ERROR_CODE.exec(text)?.[0] ?? null

/** The first harness module a text names (`cli/src/harness/wave.ts`), forward slashes, or null. */
export const moduleOf = (text: string): string | null => MODULE.exec(text.replaceAll("\\", "/"))?.[0] ?? null

/** A title with its ids, hashes and numbers blanked and its punctuation dropped, so two reports of one defect or question read alike. */
const normalTitle = (title: string): string =>
    title
        .toLowerCase()
        .replaceAll(/\b[a-z]{1,3}-[0-9a-f]{6,}\b/g, "<id>")
        .replaceAll(/\b[0-9a-f]{7,40}\b/g, "<sha>")
        .replaceAll(/\d+/g, "#")
        .replaceAll(/[^\w#<>]+/g, " ")
        .trim()

/**
 * The dedupe key of a ticket. A defect's is its kind, the normalized error code and the module it names (read from the title, the
 * evidence tail and what was tried unless given), and with neither code nor module its normalized title; a question's is its kind
 * and normalized title, so the same question asked for two tasks is one ticket.
 */
export const fingerprintOf = (kind: TicketKind, title: string, text: string, code?: string, module?: string): string => {
    const question = isQuestion(kind)
    const errorCode = question ? "" : ((code ?? errorCodeOf(`${title}\n${text}`))?.toUpperCase() ?? "")
    const place = question ? "" : ((module ?? moduleOf(`${title}\n${text}`))?.replaceAll("\\", "/").toLowerCase() ?? "")
    const rest = errorCode === "" && place === "" ? normalTitle(title) : ""
    return createHash("sha256").update(`${kind}\0${errorCode}\0${place}\0${rest}`).digest("hex").slice(0, 16)
}

/** What `openTicket` files. */
export interface TicketInput {
    readonly kind: TicketKind
    readonly severity: TicketSeverity
    readonly title: string
    readonly evidence: TicketEvidence
    readonly tried: string | null
    readonly proposedDefault: string | null
    readonly options: readonly string[]
    readonly project: Project
    readonly workflow: string | null
    /** The reporting role, and its seat when it has one. */
    readonly by: string
    readonly seat?: string | null
    readonly code?: string
    readonly module?: string
    /** The tasks and decisions that wait on the fix or the answer. */
    readonly waiters: readonly WaiterInput[]
}

/** How `openTicket` ended: a new ticket, a repeat of a live or ended one (occurrences bumped), or a fixed one reopened by its repeat. */
export type TicketOutcome = "opened" | "repeat" | "reopened"

const ticketRow = (db: DatabaseSync, id: string): Ticket | undefined => {
    const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id)
    return row === undefined ? undefined : toTicket(row)
}

/** The ticket a duplicate points at, followed to its end. */
const followDuplicates = (db: DatabaseSync, ticket: Ticket): Ticket => {
    let current = ticket
    for (let hops = 0; hops < 16 && current.state === "duplicate" && current.duplicateOf !== null; hops += 1) {
        const next = ticketRow(db, current.duplicateOf)
        if (next === undefined) break
        current = next
    }
    return current
}

/** Links a waiter to a ticket; to an ended one (wontfix, answered) it is released at once, since no close is left to release it. */
const link = (db: DatabaseSync, ticket: Ticket, waiter: WaiterInput): void => {
    const at = now()
    db.prepare("INSERT INTO ticket_waiters (ticket_id, repo, subject, project, project_root, workflow_id, linked_at, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").run(
        ticket.id,
        waiter.repo,
        waiter.subject,
        waiter.project.key,
        waiter.project.root,
        waiter.workflow,
        at,
        isLive(ticket.state) ? null : at,
    )
}

/**
 * Files a ticket, deduped by its fingerprint (`fingerprintOf`): a defect or question with no ticket yet opens one; a repeat of a
 * live ticket, of a wontfix one or of an answered question bumps its occurrences (and raises it to blocking when the repeat is);
 * a repeat of a `fixed` defect reopens it for another round, the fix it regressed kept in `fixedBy`; a duplicate's repeat lands
 * on the ticket it duplicates. Each waiter is linked to the ticket, released at once when it has ended without a fix to wait for
 * (wontfix, or a question answered already, whose answer the caller reads from the ticket).
 */
export const openTicket = (input: TicketInput): { readonly ticket: Ticket; readonly outcome: TicketOutcome } =>
    withMachine((db) => {
        const fingerprint = fingerprintOf(input.kind, input.title, `${input.evidence.tail ?? ""}\n${input.evidence.question ?? ""}\n${input.tried ?? ""}`, input.code, input.module)
        const at = now()
        const known = db.prepare("SELECT * FROM tickets WHERE fingerprint = ? ORDER BY opened_at DESC, id DESC LIMIT 1").get(fingerprint)
        const target = known === undefined ? undefined : followDuplicates(db, toTicket(known))
        let outcome: TicketOutcome
        let id: string
        if (target === undefined) {
            id = `${TICKET_PREFIX}${randomBytes(6).toString("hex")}`
            db.prepare(
                "INSERT INTO tickets (id, fingerprint, project, project_root, workflow_id, kind, severity, title, evidence_json, tried, proposed_default, options_json, state, opened_by, opened_seat, reporters_json, occurrences, round, opened_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 1, 1, ?, ?)",
            ).run(id, fingerprint, input.project.key, input.project.root, input.workflow, input.kind, input.severity, input.title, JSON.stringify(input.evidence), input.tried, input.proposedDefault, JSON.stringify(input.options), input.by, input.seat ?? null, JSON.stringify([input.by]), at, at)
            outcome = "opened"
        } else if (target.state === "fixed") {
            id = target.id
            db.prepare(
                "UPDATE tickets SET state = 'open', round = round + 1, occurrences = occurrences + 1, severity = CASE WHEN ? = 'blocking' THEN 'blocking' ELSE severity END, evidence_json = ?, tried = COALESCE(?, tried), taken_by = NULL, taken_at = NULL, closed_by = NULL, closed_at = NULL, opened_at = ?, last_seen_at = ? WHERE id = ?",
            ).run(input.severity, JSON.stringify(input.evidence), input.tried, at, at, id)
            outcome = "reopened"
        } else {
            id = target.id
            db.prepare("UPDATE tickets SET occurrences = occurrences + 1, severity = CASE WHEN ? = 'blocking' THEN 'blocking' ELSE severity END, proposed_default = COALESCE(proposed_default, ?), last_seen_at = ? WHERE id = ?").run(input.severity, input.proposedDefault, at, id)
            outcome = "repeat"
        }
        if (target !== undefined && !target.reporters.includes(input.by)) db.prepare("UPDATE tickets SET reporters_json = ? WHERE id = ?").run(JSON.stringify([...target.reporters, input.by]), id)
        const ticket = ticketRow(db, id)
        if (ticket === undefined) throw new Refusal("TICKET_LOST", `ticket ${id} vanished from the host store`)
        for (const waiter of input.waiters) link(db, ticket, waiter)
        return { ticket, outcome }
    })

/** One ticket by id, refused TICKET_UNKNOWN. */
export const getTicket = (id: string): Ticket => {
    const ticket = readMachine((db) => ticketRow(db, id), undefined)
    if (ticket === undefined) throw new Refusal("TICKET_UNKNOWN", `no ticket ${id} on this host (starci ticket list)`)
    return ticket
}

/** One ticket by id, or undefined. */
export const findTicket = (id: string): Ticket | undefined => readMachine((db) => ticketRow(db, id), undefined)

/** The tasks and decisions that wait, or waited, on a ticket. */
export const waitersOf = (id: string): TicketWaiter[] =>
    readMachine((db) => db.prepare("SELECT * FROM ticket_waiters WHERE ticket_id = ? ORDER BY linked_at, subject").all(id), []).map(toWaiter)

/** True when a decision of the ledger of `repo` already waits on a ticket. */
export const decisionTicketed = (repo: string, decisionId: string): boolean =>
    readMachine((db) => db.prepare("SELECT 1 FROM ticket_waiters WHERE repo = ? AND subject = ?").get(repo, `decision:${decisionId}`) !== undefined, false)

/**
 * The ended tickets that released a task or escalation of a workflow, oldest first: the answers and fixes every later attempt of
 * the workflow's tasks is told in its brief (harness/brief.ts), so no worker guesses again what was answered.
 */
export const releasedTicketsOfWorkflow = (workflowId: string): Ticket[] =>
    readMachine((db) => db.prepare("SELECT DISTINCT t.* FROM ticket_waiters w JOIN tickets t ON t.id = w.ticket_id WHERE w.released_at IS NOT NULL AND w.workflow_id = ? ORDER BY t.closed_at, t.id").all(workflowId), []).map(toTicket)

/** The tickets that ended since `since`, newest first (the bridge's "Đã đóng hôm nay"). */
export const ticketsClosedSince = (since: string): Ticket[] =>
    readMachine((db) => db.prepare("SELECT * FROM tickets WHERE closed_at IS NOT NULL AND closed_at >= ? ORDER BY closed_at DESC, id").all(since), []).map(toTicket)

/**
 * Reopens an ended defect for another round (the owner's "Mở lại" when a fix did not hold), its fix kept in `fixedBy`; refused
 * TICKET_NOT_CLOSED for a live ticket and TICKET_IS_QUESTION for an answered question.
 */
export const reopenTicket = (id: string): Ticket =>
    withMachine((db) => {
        const ticket = ticketRow(db, id)
        if (ticket === undefined) throw new Refusal("TICKET_UNKNOWN", `no ticket ${id} on this host (starci ticket list)`)
        if (isLive(ticket.state)) throw new Refusal("TICKET_NOT_CLOSED", `ticket ${id} is ${ticket.state} already`)
        if (isQuestion(ticket.kind)) throw new Refusal("TICKET_IS_QUESTION", `ticket ${id} is an answered question; ask it again with ticket open`)
        db.prepare("UPDATE tickets SET state = 'open', round = round + 1, taken_by = NULL, taken_at = NULL, closed_by = NULL, closed_at = NULL, opened_at = ?, last_seen_at = ? WHERE id = ?").run(now(), now(), id)
        return ticketRow(db, id) ?? ticket
    })

/** Debug's queue order: blocking first, then the most occurrences, then the oldest. */
const QUEUE_ORDER = "CASE severity WHEN 'blocking' THEN 0 ELSE 1 END, occurrences DESC, opened_at, id"

/** The tickets of a state (every state when unset) and project (by key or name), in Debug's queue order. */
export const listTickets = (filter: { readonly state?: TicketState; readonly project?: string }): Ticket[] =>
    readMachine((db) => (filter.state === undefined ? db.prepare(`SELECT * FROM tickets ORDER BY ${QUEUE_ORDER}`).all() : db.prepare(`SELECT * FROM tickets WHERE state = ? ORDER BY ${QUEUE_ORDER}`).all(filter.state)), [])
        .map(toTicket)
        .filter((ticket) => filter.project === undefined || ticket.project.key === filter.project || ticket.project.name.toLowerCase() === filter.project.toLowerCase())

const liveTicket = (db: DatabaseSync, id: string): Ticket => {
    const ticket = ticketRow(db, id)
    if (ticket === undefined) throw new Refusal("TICKET_UNKNOWN", `no ticket ${id} on this host (starci ticket list)`)
    if (!isLive(ticket.state)) throw new Refusal("TICKET_CLOSED", `ticket ${ticket.id} is ${ticket.state}${ticket.closedBy === null ? "" : ` (by ${ticket.closedBy})`}; a repeat of it reopens a fixed defect`)
    return ticket
}

/** Debug takes a live defect: in-progress, by whom and when. A question is the owner's to answer, refused TICKET_IS_QUESTION. */
export const takeTicket = (id: string, by: string): Ticket =>
    withMachine((db) => {
        const ticket = liveTicket(db, id)
        if (isQuestion(ticket.kind)) throw new Refusal("TICKET_IS_QUESTION", `ticket ${id} is a ${ticket.kind}: the owner answers it (ticket answer, or a reply on Telegram)`)
        db.prepare("UPDATE tickets SET state = 'in-progress', taken_by = ?, taken_at = ? WHERE id = ?").run(by, now(), id)
        return ticketRow(db, id) ?? ticket
    })

/** How a ticket ends: fixed by a harness commit, not fixed and why, a duplicate of another ticket, or a question answered and why. */
export type Resolution =
    | { readonly state: "fixed"; readonly fixedBy: string }
    | { readonly state: "wontfix"; readonly reason: string }
    | { readonly state: "duplicate"; readonly of: string }
    | { readonly state: "answered"; readonly answer: string; readonly why: string }

/** An ended ticket and the waiters its end released (a duplicate's live target takes its waiters instead). */
export interface Closed {
    readonly ticket: Ticket
    readonly released: readonly TicketWaiter[]
    readonly movedTo: string | null
}

/**
 * Ends a live ticket, recording who ended it and why. Fixed, wontfix or answered releases every waiter not released yet; a
 * duplicate of a live ticket hands its waiters and occurrences to it, and a duplicate of an ended one releases them. Only a
 * question is answered (TICKET_NOT_QUESTION otherwise), and only a defect is fixed (TICKET_IS_QUESTION). Refused TICKET_CLOSED
 * for a ticket ended already.
 */
export const closeTicket = (id: string, resolution: Resolution, by: string): Closed =>
    withMachine((db) => {
        const ticket = liveTicket(db, id)
        const at = now()
        let movedTo: string | null = null
        if (resolution.state === "duplicate") {
            const named = ticketRow(db, resolution.of)
            if (named === undefined) throw new Refusal("TICKET_UNKNOWN", `no ticket ${resolution.of} to be a duplicate of`)
            const target = followDuplicates(db, named)
            if (target.id === id) throw new Refusal("TICKET_DUPLICATE_SELF", `ticket ${id} cannot be a duplicate of itself (${resolution.of} leads back to it)`)
            if (isLive(target.state)) {
                movedTo = target.id
                db.prepare("UPDATE tickets SET occurrences = occurrences + ?, severity = CASE WHEN ? = 'blocking' THEN 'blocking' ELSE severity END WHERE id = ?").run(ticket.occurrences, ticket.severity, target.id)
                db.prepare("INSERT INTO ticket_waiters (ticket_id, repo, subject, project, project_root, workflow_id, linked_at) SELECT ?, repo, subject, project, project_root, workflow_id, linked_at FROM ticket_waiters WHERE ticket_id = ? AND released_at IS NULL ON CONFLICT DO NOTHING").run(target.id, id)
                db.prepare("DELETE FROM ticket_waiters WHERE ticket_id = ? AND released_at IS NULL").run(id)
            }
            db.prepare("UPDATE tickets SET state = 'duplicate', duplicate_of = ?, closed_by = ?, closed_at = ? WHERE id = ?").run(target.id, by, at, id)
        } else if (resolution.state === "answered") {
            if (!isQuestion(ticket.kind)) throw new Refusal("TICKET_NOT_QUESTION", `ticket ${id} is a ${ticket.kind} defect: Debug closes it with ticket close`)
            db.prepare("UPDATE tickets SET state = 'answered', answer = ?, reason = ?, closed_by = ?, closed_at = ? WHERE id = ?").run(resolution.answer, resolution.why, by, at, id)
        } else if (resolution.state === "fixed") {
            if (isQuestion(ticket.kind)) throw new Refusal("TICKET_IS_QUESTION", `ticket ${id} is a ${ticket.kind}: it is answered (ticket answer), not fixed`)
            db.prepare("UPDATE tickets SET state = 'fixed', fixed_by = ?, reason = NULL, closed_by = ?, closed_at = ? WHERE id = ?").run(resolution.fixedBy, by, at, id)
        } else {
            db.prepare("UPDATE tickets SET state = 'wontfix', reason = ?, closed_by = ?, closed_at = ? WHERE id = ?").run(resolution.reason, by, at, id)
        }
        const released = db.prepare("SELECT * FROM ticket_waiters WHERE ticket_id = ? AND released_at IS NULL ORDER BY linked_at, subject").all(id).map(toWaiter)
        db.prepare("UPDATE ticket_waiters SET released_at = ? WHERE ticket_id = ? AND released_at IS NULL").run(at, id)
        const closed = ticketRow(db, id)
        if (closed === undefined) throw new Refusal("TICKET_LOST", `ticket ${id} vanished from the host store`)
        return { ticket: closed, released, movedTo }
    })

/** How an ended ticket reads in one line: fixed by its commit, wontfix and why, a duplicate of which ticket, or answered by whom, what and why. */
export const closeLine = (ticket: Ticket): string => {
    if (ticket.state === "fixed") return `fixed by ${ticket.fixedBy ?? "-"}`
    if (ticket.state === "wontfix") return `wontfix: ${ticket.reason ?? "-"}`
    if (ticket.state === "duplicate") return `duplicate of ${ticket.duplicateOf ?? "-"}`
    if (ticket.state === "answered") return `answered by ${ticket.closedBy ?? "-"}: ${ticket.answer ?? "-"}${ticket.reason === null ? "" : ` (why: ${ticket.reason})`}`
    return ticket.state
}

/** One project's Supervisor woken by an end, with the owner request that names what it may resume. */
export interface Woken {
    readonly project: string
    readonly request: string
    readonly mail: string
    readonly subjects: readonly string[]
}

/**
 * Wakes the Supervisor of every project an end released a waiter of, and of the ticket's own project when the Supervisor opened
 * it: an owner request by the closer (`askSupervisor`) naming the ticket, how it ended (the fix, or the answer with who gave it
 * and why), and each released decision and task, which the Supervisor relays as a goal-change or stop answering the request and
 * each released escalation. A project with no registered key (no Supervisor) is skipped; a duplicate whose waiters moved wakes none.
 */
export const wakeOnClose = async (closed: Closed, by: string, cwd: string): Promise<Woken[]> => {
    const { ticket } = closed
    if (closed.movedTo !== null) return []
    const projects = new Map<string, { readonly project: Project; readonly waiters: TicketWaiter[] }>()
    for (const waiter of closed.released) {
        const entry = projects.get(waiter.project.key) ?? { project: waiter.project, waiters: [] }
        entry.waiters.push(waiter)
        projects.set(waiter.project.key, entry)
    }
    if (ticket.openedBy === "supervisor" && !projects.has(ticket.project.key)) projects.set(ticket.project.key, { project: ticket.project, waiters: [] })
    const due = [...projects.values()].filter((entry) => entry.project.key !== "")
    return inOrder(due, async ({ project, waiters }) => {
        const named = waiters.map((waiter) => `${waiter.subject}${waiter.workflow === null ? "" : ` (workflow ${waiter.workflow})`}`)
        const text = [
            `Ticket ${ticket.id} (${ticket.kind}) is ${closeLine(ticket)}. Ticket: ${ticket.title}.`,
            named.length === 0 ? "Resume the work you held for it." : `Released: ${named.join(", ")}. Resume them: answer each released escalation with a goal-change or stop naming it and this request.`,
        ].join(" ")
        const { request, mail } = await askSupervisor(project, by, text, cwd)
        withMachine((db) => {
            for (const waiter of waiters) db.prepare("UPDATE ticket_waiters SET request_id = ? WHERE ticket_id = ? AND repo = ? AND subject = ?").run(request.id, ticket.id, waiter.repo, waiter.subject)
        })
        return { project: project.name, request: request.id, mail, subjects: waiters.map((waiter) => waiter.subject) }
    })
}

/**
 * Files an open escalation the Supervisor cannot rule as its ticket (or links it to the live ticket of the same defect or
 * question), once, the escalation waiting on it: a `harness` one as a blocking `harness-defect` for Debug; an `owner` one
 * `awaitsOwner` holds (no default the Supervisor may take) as a blocking `question:business` the owner answers on Telegram, its
 * topic kept in the evidence and its `default` as the proposed default. The question is the title, the workflow the workflow.
 * Returns the ticket and how it was filed, or null for any other decision and for one that waits on a ticket already.
 */
export const ticketEscalation = (repo: string, project: Project, decision: Decision): { readonly ticket: Ticket; readonly outcome: TicketOutcome } | null => {
    const escalation = escalationOf(decision)
    if (escalation === null || !awaitsOwner(decision) || decisionTicketed(repo, decision.id)) return null
    const harness = escalation.kind === "harness"
    const text = escalation.question ?? decision.subject
    const flat = text.replaceAll(/\s+/g, " ").trim()
    return openTicket({
        kind: harness ? "harness-defect" : "question:business",
        severity: "blocking",
        title: flat.length <= 200 ? flat : `${flat.slice(0, 199)}…`,
        evidence: { workflow: decision.workflowId, decision: decision.id, question: text, ...(escalation.topic === undefined ? {} : { topic: escalation.topic }) },
        tried: escalation.reason ?? null,
        proposedDefault: harness ? null : (escalation.default ?? null),
        options: [],
        project,
        workflow: decision.workflowId,
        by: "supervisor",
        seat: process.env.ORCA_TERMINAL_HANDLE ?? null,
        waiters: [{ repo, subject: `decision:${decision.id}`, project, workflow: decision.workflowId }],
    })
}

/**
 * A task the harness left awaiting the owner: a verify that reached no verdict settleNoVerdictMax times, or one a live suite's
 * custody stopped (`owner`: a key the owner seals, core/task/verify.ts).
 */
interface AwaitingTask {
    readonly id: string
    readonly workflow: string | null
    readonly label: string
    readonly reason: string
    readonly owner: boolean
}

/**
 * Files a task left awaiting the owner as its ticket, once, the task waiting on it: a blocking `verify` defect for Debug's queue
 * (its verify gave up on a persistent cause it names, which the owner is told on Telegram as every blocking defect is), titled
 * with the task and that cause; a custody block is the owner's instead, a blocking `question:business` on credentials. Null for a
 * task that waits on a ticket already.
 */
const ticketAwaitingTask = (repo: string, project: Project, task: AwaitingTask): { readonly ticket: Ticket; readonly outcome: TicketOutcome } | null => {
    if (readMachine((db) => db.prepare("SELECT 1 FROM ticket_waiters WHERE repo = ? AND subject = ?").get(repo, `task:${task.id}`) !== undefined, false)) return null
    const flat = `task ${task.id} (${task.label}${task.workflow === null ? "" : `, workflow ${task.workflow}`}) is awaiting the owner: ${task.reason}`.replaceAll(/\s+/g, " ").trim()
    return openTicket({
        kind: task.owner ? "question:business" : "verify",
        severity: "blocking",
        title: flat.length <= 200 ? flat : `${flat.slice(0, 199)}…`,
        evidence: { task: task.id, ...(task.workflow === null ? {} : { workflow: task.workflow }), question: task.reason, ...(task.owner ? { topic: "credentials" } : {}) },
        tried: null,
        proposedDefault: null,
        options: [],
        project,
        workflow: task.workflow,
        by: "supervisor",
        seat: process.env.ORCA_TERMINAL_HANDLE ?? null,
        waiters: [{ repo, subject: `task:${task.id}`, project, workflow: task.workflow }],
    })
}

/**
 * Files every open escalation of one repository's ledger the Supervisor cannot rule (`ticketEscalation`), with or without a topic,
 * and every task the harness left awaiting the owner (`ticketAwaitingTask`), as one line each.
 */
export const ticketEscalations = (repo: string, project: Project): string[] => {
    const db = openExistingLedger(repo)
    if (db === undefined) return []
    let decisions: Decision[]
    let awaiting: AwaitingTask[]
    try {
        decisions = openDecisions(db, "supervisor")
        awaiting = db
            .prepare("SELECT t.id, t.workflow_id, t.label, (SELECT json_extract(e.data_json, '$.reason') FROM events e WHERE e.subject = t.id AND e.kind = 'verify-stuck' ORDER BY e.id DESC LIMIT 1) AS reason, (SELECT json_extract(e.data_json, '$.owner') FROM events e WHERE e.subject = t.id AND e.kind = 'verify-stuck' ORDER BY e.id DESC LIMIT 1) AS owner FROM tasks t WHERE t.status = 'awaiting_owner' ORDER BY t.updated_at, t.id")
            .all()
            .map((row) => ({ id: String(row.id), workflow: textOf(row.workflow_id), label: String(row.label), reason: textOf(row.reason) ?? "its verify reached no verdict", owner: Number(row.owner ?? 0) === 1 }))
    } finally {
        db.close()
    }
    const key = repo.replaceAll("\\", "/")
    return [
        ...decisions.flatMap((decision) => {
            const filed = ticketEscalation(key, project, decision)
            return filed === null ? [] : [`escalation ${decision.id} filed as ticket ${filed.ticket.id} (${filed.ticket.kind}, ${filed.outcome}, seen ${String(filed.ticket.occurrences)} times)`]
        }),
        ...awaiting.flatMap((task) => {
            const filed = ticketAwaitingTask(key, project, task)
            return filed === null ? [] : [`task ${task.id} awaiting the owner filed as ticket ${filed.ticket.id} (${filed.ticket.kind}, ${filed.outcome}, seen ${String(filed.ticket.occurrences)} times)`]
        }),
    ]
}

/**
 * The tick's ticket round: every registered repository's open escalations the Supervisor cannot rule are filed as tickets
 * (`ticketEscalations`), so a defect reaches Debug's queue and a question the owner's chat even while no Supervisor runs `next`.
 */
export const ticketHostEscalations = async (): Promise<string[]> => {
    const lines = await inOrder(registeredRepositories(), async (repo) => {
        try {
            return ticketEscalations(repo, await projectOf(repo, false))
        } catch {
            return []
        }
    })
    return lines.flat()
}
