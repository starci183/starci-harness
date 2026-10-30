import { listTickets, TICKET_KINDS, TICKET_STATES } from "../../harness/tickets.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { FEEDBACK_KIND, listFeedbackItems } from "./feedback.js"

/**
 * `starci ticket list [--status] [--kind] [--project]`: the host's tickets in Debug's queue order (blocking first, then by
 * occurrences); changes nothing. `--kind feedback` lists the owner feedback instead, and `--status overdue` judges it (exit 1
 * when an item stays open too long or a closed one's target no longer resolves: core/ticket/feedback.ts).
 */
export const ticketListVerb = defineVerb({
    path: ["ticket", "list"],
    summary: "list the harness tickets, blocking first and then by occurrences (Debug's queue: --status open); --kind feedback lists the owner feedback, --status overdue judges it",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/ticket-list@1",
    flags: {
        status: { kind: "string", summary: `only tickets in this state: ${TICKET_STATES.join(", ")} (feedback: open, closed, all or overdue)` },
        kind: { kind: "string", summary: `only tickets of this kind: ${TICKET_KINDS.join(", ")}, or ${FEEDBACK_KIND}` },
        project: { kind: "string", summary: "only tickets of this project (its name or key)" },
    },
    run: (_context, flags) => {
        if (flags.kind === FEEDBACK_KIND) {
            if (flags.project !== undefined) throw new Refusal("CLI_USAGE", "owner feedback is host-wide; --project does not narrow it", EXIT_USAGE)
            return Promise.resolve(listFeedbackItems(flags.status))
        }
        const kind = flags.kind === undefined ? undefined : TICKET_KINDS.find((known) => known === flags.kind)
        if (flags.kind !== undefined && kind === undefined) throw new Refusal("CLI_USAGE", `--kind takes ${TICKET_KINDS.join(", ")} or ${FEEDBACK_KIND}, not ${flags.kind}`, EXIT_USAGE)
        const state = flags.status === undefined ? undefined : TICKET_STATES.find((known) => known === flags.status)
        if (flags.status !== undefined && state === undefined) throw new Refusal("CLI_USAGE", `--status takes ${TICKET_STATES.join(", ")}, not ${flags.status}`, EXIT_USAGE)
        const tickets = listTickets({ ...(state === undefined ? {} : { state }), ...(flags.project === undefined ? {} : { project: flags.project }) }).filter((ticket) => kind === undefined || ticket.kind === kind)
        const rows = tickets.map((ticket) => [ticket.id, ticket.state, ticket.severity, String(ticket.occurrences), ticket.kind, ticket.project.name || "-", ticket.takenBy ?? "-", ticket.title])
        return Promise.resolve({ data: { tickets }, message: tickets.length === 0 ? "no ticket" : formatTable([["TICKET", "STATE", "SEVERITY", "SEEN", "KIND", "PROJECT", "TAKEN", "TITLE"], ...rows]) })
    },
})
