import { FEEDBACK_TARGET_KINDS, closeFeedback } from "../../harness/feedback.js"
import { BOTH_EDITIONS, WRITERS, defineVerb } from "../../shared/verb.js"
import { resolveTarget, targetKindOf } from "./targets.js"

/**
 * `starci feedback close <id> --kind <kind> --target <target>`: closes one owner feedback on the change that absorbed it, and
 * only on one that resolves: a commit of the harness checkout touching packages/grammar (grammar), cli/ (cli) or app/ (app), a
 * rule R<n> of contexts/hfs/rules.yaml with a built enforcer (rule), or an anchor of the contexts corpus (context). Anything else is FEEDBACK_TARGET_UNRESOLVED and the item stays open.
 */
export const feedbackCloseVerb = defineVerb({
    path: ["feedback", "close"],
    summary: `close one owner feedback on a target that resolves (${FEEDBACK_TARGET_KINDS.join("|")}): a commit touching that folder, an enforced rule or a contexts anchor`,
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/feedback-close@1",
    flags: {
        id: { kind: "string", summary: "the feedback id, as feedback list prints it", required: true, positional: true },
        kind: { kind: "string", summary: `the target kind: ${FEEDBACK_TARGET_KINDS.join(", ")}`, required: true },
        target: { kind: "string", summary: "a commit sha (grammar, cli, app), a rule id R<n> (rule) or an anchor id (context)", required: true },
    },
    run: (_context, flags) => {
        const kind = targetKindOf(flags.kind)
        const resolved = resolveTarget(kind, flags.target)
        const { item, changed } = closeFeedback(flags.id, kind, resolved.target, resolved.evidence)
        return Promise.resolve({ data: { item, changed }, message: `${item.id} ${changed ? "closed" : "already closed"} on ${kind} ${resolved.target}: ${resolved.evidence}` })
    },
})
