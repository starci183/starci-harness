import { takeTicket } from "../../harness/tickets.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci ticket take <id>`: Debug takes a live ticket from its queue; the ticket goes in-progress under its name. */
export const ticketTakeVerb = defineVerb({
    path: ["ticket", "take"],
    summary: "take a live ticket from Debug's queue: in-progress, under the taker's role",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["debug", "owner"],
    schema: "starci/ticket@1",
    flags: {
        id: { kind: "string", required: true, positional: true, summary: "the ticket id (tk-...)" },
    },
    run: (_context, flags) => {
        const ticket = takeTicket(flags.id, callerRole() ?? "debug")
        return Promise.resolve({ data: { ticket, outcome: "taken" }, message: `ticket ${ticket.id} in-progress, taken by ${ticket.takenBy ?? "-"}: ${ticket.title}` })
    },
})
