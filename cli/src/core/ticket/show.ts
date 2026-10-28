import { closeLine, getTicket, isLive, waitersOf } from "../../harness/tickets.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"

/** `starci ticket show <id>`: one ticket with its evidence, what was tried, its fix and the tasks and decisions waiting on it; changes nothing. */
export const ticketShowVerb = defineVerb({
    path: ["ticket", "show"],
    summary: "show one ticket: evidence, what was tried, its proposed default, its state, fix or answer, and the tasks and decisions waiting on it",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/ticket-show@1",
    flags: {
        id: { kind: "string", required: true, positional: true, summary: "the ticket id (tk-...)" },
    },
    run: (_context, flags) => {
        const ticket = getTicket(flags.id)
        const waiters = waitersOf(ticket.id)
        const evidence = ticket.evidence
        const lines = [
            `${ticket.id} ${isLive(ticket.state) ? ticket.state : closeLine(ticket)}: ${ticket.severity} ${ticket.kind}, seen ${String(ticket.occurrences)} times, round ${String(ticket.round)}`,
            `title: ${ticket.title}`,
            `project: ${ticket.project.name || "-"}${ticket.workflow === null ? "" : `, workflow ${ticket.workflow}`}; opened by ${ticket.openedBy}${ticket.openedSeat === null ? "" : ` (${ticket.openedSeat})`} at ${ticket.openedAt}, reported by ${ticket.reporters.join(", ")}, last seen ${ticket.lastSeenAt}${ticket.takenBy === null ? "" : `; taken by ${ticket.takenBy} at ${ticket.takenAt ?? "-"}`}`,
            ...(ticket.fixedBy !== null && ticket.state !== "fixed" ? [`regressed after fix ${ticket.fixedBy}`] : []),
            ...(["task", "attempt", "seat", "decision"] as const).flatMap((key) => (evidence[key] === undefined ? [] : [`${key}: ${evidence[key]}`])),
            ...(evidence.question === undefined ? [] : [`question: ${evidence.question}`]),
            ...(ticket.tried === null ? [] : [`tried: ${ticket.tried}`]),
            ...(ticket.proposedDefault === null ? [] : [`proposed default: ${ticket.proposedDefault}`]),
            ...waiters.map((waiter) => `waiter ${waiter.subject} (${waiter.repo}): ${waiter.releasedAt === null ? "waiting" : `released ${waiter.releasedAt}${waiter.requestId === null ? "" : ` by ${waiter.requestId}`}`}`),
            ...(evidence.tail === undefined ? [] : ["evidence:", evidence.tail]),
        ]
        return Promise.resolve({ data: { ticket, waiters }, message: lines.join("\n") })
    },
})
