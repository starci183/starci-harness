import { listFeedback } from "../../harness/feedback.js"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

const STATUSES = ["open", "closed", "all"] as const

/** `starci feedback list`: the owner feedback of the host ledger, oldest first, open only unless --status says otherwise. */
export const feedbackListVerb = defineVerb({
    path: ["feedback", "list"],
    summary: "list the owner feedback of the host ledger with its words, day, status and closing target",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/feedback-list@1",
    flags: {
        status: { kind: "string", summary: "open (default), closed or all" },
    },
    run: (_context, flags) => {
        const status = STATUSES.find((item) => item === (flags.status ?? "open"))
        if (status === undefined) throw new Refusal("CLI_USAGE", `--status ${String(flags.status)} is not one of ${STATUSES.join(", ")}`)
        const items = listFeedback().filter((item) => status === "all" || item.status === status)
        const lines = items.map((item) => `${item.id} ${item.status} ${item.givenOn}${item.target === null ? "" : ` -> ${String(item.targetKind)} ${item.target}`}: ${item.words}`)
        return Promise.resolve({ data: { status, items }, message: lines.length === 0 ? `no ${status === "all" ? "" : `${status} `}feedback` : lines.join("\n") })
    },
})
