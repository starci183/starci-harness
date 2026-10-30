import { closeLine, closeTicket, wakeOnClose } from "../../harness/tickets.js"
import type { Resolution } from "../../harness/tickets.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { FEEDBACK_TARGET_KINDS } from "../../harness/feedback.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import type { Role } from "../../shared/verb.js"
import { assertKindRole, closeFeedbackItem, FEEDBACK_KIND } from "./feedback.js"

/** Who closes a ticket: Debug and the owner (feedback is every writer's: `assertKindRole`). */
const TICKET_CLOSERS: readonly Role[] = ["debug", "owner"]

const SHA = /^[0-9a-f]{7,40}$/

/** The one resolution the flags name, refused CLI_USAGE for none or several. */
const resolutionOf = (flags: { readonly "fixed-by"?: string | undefined; readonly wontfix: boolean; readonly reason?: string | undefined; readonly duplicate?: string | undefined }): Resolution => {
    const named = [flags["fixed-by"] !== undefined, flags.wontfix, flags.duplicate !== undefined].filter(Boolean).length
    if (named !== 1) throw new Refusal("CLI_USAGE", "ticket close takes exactly one of --fixed-by <sha>, --wontfix --reason <why>, --duplicate <id>", EXIT_USAGE)
    const fixedBy = flags["fixed-by"]
    if (fixedBy !== undefined) {
        if (!SHA.test(fixedBy)) throw new Refusal("TICKET_FIX_INVALID", `--fixed-by names the harness commit that fixed it (7 to 40 lowercase hex digits), not ${fixedBy}`)
        return { state: "fixed", fixedBy }
    }
    if (flags.duplicate !== undefined) return { state: "duplicate", of: flags.duplicate }
    const reason = flags.reason?.trim() ?? ""
    if (reason === "") throw new Refusal("CLI_USAGE", "--wontfix needs --reason <why it is not fixed>", EXIT_USAGE)
    return { state: "wontfix", reason }
}

/**
 * `starci ticket close <id>`: Debug (or the owner) closes a live ticket, a defect fixed by a harness commit, or any ticket wontfix
 * with a reason or as a duplicate of another (a question is answered with `ticket answer`). Every task and decision waiting on it is released and its project's Supervisor woken with an owner request
 * naming them (`wakeOnClose` in harness/tickets.ts); a duplicate of a live ticket hands its waiters over instead.
 */
export const ticketCloseVerb = defineVerb({
    path: ["ticket", "close"],
    summary: "close a ticket: --fixed-by <sha>, --wontfix --reason, or --duplicate <id>; releases what waits on it and wakes its Supervisor; --kind feedback closes an owner feedback on a target that resolves",
    editions: BOTH_EDITIONS,
    effect: "host",
    roles: EVERYONE,
    schema: "starci/ticket-close@1",
    flags: {
        id: { kind: "string", required: true, positional: true, summary: "the ticket id (tk-...), or with --kind feedback the feedback id" },
        kind: { kind: "string", summary: `${FEEDBACK_KIND}: the id is an owner feedback's (default: a ticket's)` },
        "fixed-by": { kind: "string", summary: "the harness commit that fixed it" },
        wontfix: { kind: "boolean", summary: "it is not fixed; --reason says why" },
        reason: { kind: "string", summary: "why it is not fixed (with --wontfix)" },
        duplicate: { kind: "string", summary: "the ticket it duplicates" },
        "target-kind": { kind: "string", summary: `feedback: the kind of target that closes it: ${FEEDBACK_TARGET_KINDS.join(", ")}` },
        target: { kind: "string", summary: "feedback: a commit sha (grammar, cli, app), a rule id R<n> (rule) or an anchor id (context)" },
    },
    run: async (context, flags) => {
        const feedback = flags.kind === FEEDBACK_KIND
        if (flags.kind !== undefined && !feedback) throw new Refusal("CLI_USAGE", `--kind takes ${FEEDBACK_KIND} or nothing (a ticket), not ${flags.kind}`, EXIT_USAGE)
        assertKindRole(feedback, TICKET_CLOSERS, "ticket close")
        if (feedback) return closeFeedbackItem(flags.id, flags["target-kind"], flags.target)
        if (flags["target-kind"] !== undefined || flags.target !== undefined) throw new Refusal("CLI_USAGE", "--target-kind and --target close a feedback: add --kind feedback", EXIT_USAGE)
        const resolution = resolutionOf(flags)
        const by = callerRole() ?? "debug"
        const closed = closeTicket(flags.id, resolution, by)
        const woken = await wakeOnClose(closed, by, context.cwd)
        const released = closed.movedTo === null ? `released ${String(closed.released.length)}` : `waiters moved to ${closed.movedTo}`
        const wake = woken.map((one) => `; ${one.project}: ${one.request} (${one.mail})`).join("")
        return { data: { ticket: closed.ticket, released: closed.released, movedTo: closed.movedTo, woken }, message: `ticket ${closed.ticket.id} ${closeLine(closed.ticket)}; ${released}${wake}` }
    },
})
