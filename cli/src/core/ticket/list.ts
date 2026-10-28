import { listTickets, TICKET_STATES } from "../../harness/tickets.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"

/** `starci ticket list [--state] [--project]`: the host's tickets in Debug's queue order (blocking first, then by occurrences); changes nothing. */
export const ticketListVerb = defineVerb({
    path: ["ticket", "list"],
    summary: "list the harness tickets, blocking first and then by occurrences (Debug's queue: --state open)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/ticket-list@1",
    flags: {
        state: { kind: "string", summary: `only tickets in this state: ${TICKET_STATES.join(", ")}` },
        project: { kind: "string", summary: "only tickets of this project (its name or key)" },
    },
    run: async (_context, flags) => {
        const state = flags.state === undefined ? undefined : TICKET_STATES.find((known) => known === flags.state)
        if (flags.state !== undefined && state === undefined) throw new Refusal("CLI_USAGE", `--state takes ${TICKET_STATES.join(", ")}, not ${flags.state}`, EXIT_USAGE)
        const tickets = listTickets({ ...(state === undefined ? {} : { state }), ...(flags.project === undefined ? {} : { project: flags.project }) })
        const rows = tickets.map((ticket) => [ticket.id, ticket.state, ticket.severity, String(ticket.occurrences), ticket.kind, ticket.project.name || "-", ticket.takenBy ?? "-", ticket.title])
        return { data: { tickets }, message: tickets.length === 0 ? "no ticket" : formatTable([["TICKET", "STATE", "SEVERITY", "SEEN", "KIND", "PROJECT", "TAKEN", "TITLE"], ...rows]) }
    },
})
