import { closeTicket, getTicket, wakeOnClose } from "../../harness/tickets.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci ticket answer <id>`: the owner answers a question ticket (a Telegram reply to its notice does the same), with the answer
 * or by accepting its proposed default, and why. The answer is recorded with who gave it, every task and escalation waiting on it
 * is released, the Supervisor is woken with an owner request naming them (`wakeOnClose` in harness/tickets.ts), and a new attempt
 * of a released task reads the answer in its brief.
 */
export const ticketAnswerVerb = defineVerb({
    path: ["ticket", "answer"],
    summary: "answer a question ticket (--answer <text> or --accept-default) and say why; releases what waits on it and wakes its Supervisor",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: ["owner"],
    schema: "starci/ticket-close@1",
    flags: {
        id: { kind: "string", required: true, positional: true, summary: "the ticket id (tk-...)" },
        answer: { kind: "string", summary: "the answer" },
        "accept-default": { kind: "boolean", summary: "the proposed default is the answer" },
        reason: { kind: "string", summary: "why the answer holds" },
    },
    run: async (context, flags) => {
        const ticket = getTicket(flags.id)
        const given = flags.answer?.trim() ?? ""
        if ((given === "") === !flags["accept-default"]) throw new Refusal("CLI_USAGE", "ticket answer takes exactly one of --answer <text> or --accept-default", EXIT_USAGE)
        const answer = flags["accept-default"] ? ticket.proposedDefault : given
        if (answer === null) throw new Refusal("TICKET_NO_DEFAULT", `ticket ${ticket.id} proposes no default; answer it with --answer`)
        const by = callerRole() ?? "owner"
        const why = flags.reason?.trim() ?? ""
        const closed = closeTicket(ticket.id, { state: "answered", answer, why: why === "" ? (flags["accept-default"] ? "the proposed default accepted" : "the owner's call") : why }, by)
        const woken = await wakeOnClose(closed, by, context.cwd)
        const wake = woken.map((one) => `; ${one.project}: ${one.request} (${one.mail})`).join("")
        return { data: { ticket: closed.ticket, released: closed.released, movedTo: null, woken }, message: `ticket ${ticket.id} answered: ${answer}; released ${String(closed.released.length)}${wake}` }
    },
})
