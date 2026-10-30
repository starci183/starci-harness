import { addFeedback, closeFeedback, daysBetween, dayOf, listFeedback, loadFeedbackRules } from "../../harness/feedback.js"
import type { FeedbackItem } from "../../harness/feedback.js"
import { now } from "../../harness/ledger.js"
import { asRefusal, EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { callerRole } from "../../shared/role.js"
import { WRITERS } from "../../shared/verb.js"
import type { Role, VerbResult } from "../../shared/verb.js"
import { resolveTarget, targetKindOf } from "./feedback-targets.js"

/**
 * Owner feedback is the ticket kind `feedback` (`ticket open|list|show|close --kind feedback`): the owner's words kept verbatim in
 * the host ledger (harness/feedback.ts, machine.sqlite, never a repository) with the day given; it closes only on a target that
 * resolves (`ticket close --kind feedback --target-kind --target`), and `ticket list --kind feedback --status overdue` is red once
 * one stays open past ops/liveness.yaml feedback.openMaxDays or a closed one's target no longer resolves.
 */
export const FEEDBACK_KIND = "feedback"

/** The `--status` values of `ticket list --kind feedback`: open (default), closed, all, or overdue (the red findings). */
const FEEDBACK_STATUSES = ["open", "closed", "all", "overdue"] as const

/**
 * Refuses ROLE_REFUSED when STARCI_ROLE names a role the kind does not allow: feedback is recorded and closed by every writing
 * role, every other ticket kind by the roles of its verb (`others`).
 */
export const assertKindRole = (feedback: boolean, others: readonly Role[], spelling: string): void => {
    const role = callerRole()
    const allowed = feedback ? WRITERS : others
    if (role !== undefined && !allowed.includes(role)) throw new Refusal("ROLE_REFUSED", `starci ${spelling}${feedback ? " --kind feedback" : ""} is for ${allowed.join(", ")}; STARCI_ROLE says this caller is ${role}`)
}

/** Records one owner feedback, open, with the words exactly as given; the same words on the same day answer the item already recorded. */
export const openFeedbackItem = (words: string, on: string | undefined, id: string | undefined): VerbResult<unknown> => {
    const { item, created } = addFeedback(words, on, id)
    return { data: { item, created }, message: `${item.id} ${created ? "recorded" : "already recorded"} (${item.status}, given ${item.givenOn})` }
}

/**
 * Closes one owner feedback on the change that absorbed it, and only on one that resolves: a commit of the harness checkout touching
 * packages/grammar (grammar), cli/ (cli) or app/ (app), a rule R<n> of contexts/hfs/rules.yaml with a built enforcer (rule), or an
 * anchor of the contexts corpus (context). Anything else is FEEDBACK_TARGET_UNRESOLVED and the item stays open.
 */
export const closeFeedbackItem = (id: string, kind: string | undefined, target: string | undefined): VerbResult<unknown> => {
    if (kind === undefined || target === undefined) throw new Refusal("CLI_USAGE", "ticket close --kind feedback needs --target-kind <kind> and --target <target>", EXIT_USAGE)
    const targetKind = targetKindOf(kind)
    const resolved = resolveTarget(targetKind, target)
    const { item, changed } = closeFeedback(id, targetKind, resolved.target, resolved.evidence)
    return { data: { item, changed }, message: `${item.id} ${changed ? "closed" : "already closed"} on ${targetKind} ${resolved.target}: ${resolved.evidence}` }
}

const itemLine = (item: FeedbackItem): string => {
    const aimed = item.target === null ? "" : " -> " + String(item.targetKind) + " " + item.target
    return `${item.id} ${item.status} ${item.givenOn}${aimed}: ${item.words}`
}

/** One reason the feedback is red. */
interface FeedbackFinding {
    readonly code: "FEEDBACK_OPEN_OVERDUE" | "FEEDBACK_TARGET_GONE"
    readonly id: string
    readonly detail: string
}

/** The red findings: an item open past feedback.openMaxDays (FEEDBACK_OPEN_OVERDUE), a closed one whose target no longer resolves (FEEDBACK_TARGET_GONE). */
const overdueFeedback = (): VerbResult<unknown> => {
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
    return { data: { status: "overdue", openMaxDays: rules.openMaxDays, total: items.length, open, findings }, message, exitCode: findings.length === 0 ? 0 : 1 }
}

/** The owner feedback of the host ledger, oldest first: open only unless `status` says otherwise; `overdue` judges it (exit 1 when red). */
export const listFeedbackItems = (statusFlag: string | undefined): VerbResult<unknown> => {
    const status = FEEDBACK_STATUSES.find((item) => item === (statusFlag ?? "open"))
    if (status === undefined) throw new Refusal("CLI_USAGE", `--status ${String(statusFlag)} is not one of ${FEEDBACK_STATUSES.join(", ")} for --kind feedback`, EXIT_USAGE)
    if (status === "overdue") return overdueFeedback()
    const items = listFeedback().filter((item) => status === "all" || item.status === status)
    if (items.length > 0) return { data: { status, items }, message: items.map(itemLine).join("\n") }
    return { data: { status, items }, message: `no ${status === "all" ? "" : status + " "}feedback` }
}

/** One owner feedback: its words, day, status and closing target with its evidence. */
export const showFeedbackItem = (id: string): VerbResult<unknown> => {
    const item = listFeedback().find((one) => one.id === id)
    if (item === undefined) throw new Refusal("FEEDBACK_UNKNOWN", `no feedback ${id}; starci ticket list --kind feedback --status all names them`)
    return { data: { item }, message: [itemLine(item), ...(item.evidence === null ? [] : [`evidence: ${item.evidence}`]), ...(item.closedAt === null ? [] : [`closed at ${item.closedAt}`])].join("\n") }
}
