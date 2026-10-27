import { addFeedback } from "../../harness/feedback.js"
import { BOTH_EDITIONS, WRITERS, defineVerb } from "../../shared/verb.js"

/**
 * `starci feedback add <words>`: records one owner feedback, open, in the host ledger (machine.sqlite under the state base,
 * never a repository): an id, the owner's words exactly as given, the day given and its status. It closes only on a target
 * (`feedback close`), and `feedback check` is red once it stays open past ops/liveness.yaml feedback.openMaxDays.
 */
export const feedbackAddVerb = defineVerb({
    path: ["feedback", "add"],
    summary: "record one owner feedback, open, with the owner's verbatim words and the day given, in the host ledger",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/feedback-add@1",
    flags: {
        words: { kind: "string", summary: "the owner's words, verbatim", required: true, positional: true },
        on: { kind: "string", summary: "the day the owner gave it, YYYY-MM-DD (default today)" },
        id: { kind: "string", summary: "the id to record it under (default fb-<day>-<n>)" },
    },
    run: (_context, flags) => {
        const { item, created } = addFeedback(flags.words, flags.on, flags.id)
        return Promise.resolve({ data: { item, created }, message: `${item.id} ${created ? "recorded" : "already recorded"} (${item.status}, given ${item.givenOn})` })
    },
})
