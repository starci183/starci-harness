import { daysBetween, dayOf, listFeedback, loadFeedbackRules } from "../../harness/feedback.js"
import { now } from "../../harness/ledger.js"
import { asRefusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { resolveTarget } from "./targets.js"

/** One reason `feedback check` is red. */
interface FeedbackFinding {
    readonly code: "FEEDBACK_OPEN_OVERDUE" | "FEEDBACK_TARGET_GONE"
    readonly id: string
    readonly detail: string
}

/**
 * `starci feedback check`: red (exit 1) when an owner feedback stays open longer than ops/liveness.yaml feedback.openMaxDays
 * (FEEDBACK_OPEN_OVERDUE), or when the target a closed item rests on no longer resolves (FEEDBACK_TARGET_GONE): a closure holds
 * only while what closed it exists.
 */
export const feedbackCheckVerb = defineVerb({
    path: ["feedback", "check"],
    summary: "fail when an owner feedback stays open past feedback.openMaxDays of ops/liveness.yaml, or a closed one's target no longer resolves",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/feedback-check@1",
    flags: {},
    run: () => {
        const rules = loadFeedbackRules()
        const today = dayOf(now())
        const items = listFeedback()
        const findings: FeedbackFinding[] = []
        for (const item of items) {
            if (item.status === "open") {
                const age = daysBetween(item.givenOn, today)
                if (age > rules.openMaxDays) findings.push({ code: "FEEDBACK_OPEN_OVERDUE", id: item.id, detail: `open ${String(age)} days (bound ${String(rules.openMaxDays)}): ${item.words}` })
                continue
            }
            if (item.targetKind === null || item.target === null) continue
            try {
                resolveTarget(item.targetKind, item.target)
            } catch (error: unknown) {
                findings.push({ code: "FEEDBACK_TARGET_GONE", id: item.id, detail: asRefusal(error).message })
            }
        }
        const open = items.filter((item) => item.status === "open").length
        const summary = `${String(items.length)} feedback item(s), ${String(open)} open, bound ${String(rules.openMaxDays)} days`
        const message = findings.length === 0 ? `green: ${summary}` : [`red: ${summary}`, ...findings.map((finding) => `${finding.code}: ${finding.id} ${finding.detail}`)].join("\n")
        return Promise.resolve({ data: { openMaxDays: rules.openMaxDays, total: items.length, open, findings }, message, exitCode: findings.length === 0 ? 0 : 1 })
    },
})
