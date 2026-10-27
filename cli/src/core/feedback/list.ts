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
        const lines = items.map((item) => {
            const aimed = item.target === null ? "" : " -> " + String(item.targetKind) + " " + item.target
            return `${item.id} ${item.status} ${item.givenOn}${aimed}: ${item.words}`
        })
        if (lines.length > 0) return Promise.resolve({ data: { status, items }, message: lines.join("\n") })
        const which = status === "all" ? "" : status + " "
        return Promise.resolve({ data: { status, items }, message: `no ${which}feedback` })
    },
})
