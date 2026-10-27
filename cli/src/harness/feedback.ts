import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { now } from "./ledger.js"
import { readMachine, withMachine } from "./machine.js"
import { locateOps } from "./ops.js"

/**
 * The kinds of target that close an owner feedback: a commit touching packages/grammar, cli/ or app/ of the harness checkout,
 * a rule of contexts/hfs/rules.yaml with a built enforcer, a contexts anchor the search corpus resolves, or a bench scenario.
 */
export const FEEDBACK_TARGET_KINDS = ["grammar", "cli", "app", "rule", "context", "bench"] as const
/** One kind of closing target. */
export type FeedbackTargetKind = (typeof FEEDBACK_TARGET_KINDS)[number]

/** One owner feedback as the ledger keeps it: the owner's words verbatim, the day given, and what closed it. */
export interface FeedbackItem {
    readonly id: string
    readonly words: string
    readonly givenOn: string
    readonly status: "open" | "closed"
    readonly recordedAt: string
    readonly targetKind: FeedbackTargetKind | null
    readonly target: string | null
    readonly evidence: string | null
    readonly closedAt: string | null
}

/**
 * The owner feedback ledger, host-wide in machine.sqlite (feedback is the owner's, not one project's). Additive: created when
 * missing, never altered. A feedback is given once per day and wording (`owner_feedback_once`).
 */
const TABLE = `
CREATE TABLE IF NOT EXISTS owner_feedback (
  id TEXT PRIMARY KEY, words TEXT NOT NULL, given_on TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  recorded_at TEXT NOT NULL, target_kind TEXT, target TEXT, evidence TEXT, closed_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS owner_feedback_once ON owner_feedback (given_on, words);
`

const feedbackRulesSchema = z.strictObject({ openMaxDays: z.number().int().positive() })

/** The `feedback` block of ops/liveness.yaml: how many days an owner feedback may stay open before `feedback check` is red. */
export type FeedbackRules = z.infer<typeof feedbackRulesSchema>

/** Loads and validates the `feedback` block of ops/liveness.yaml (STARCI_OPS_DIR honoured). */
export const loadFeedbackRules = (dir: string = locateOps()): FeedbackRules => {
    const file = join(dir, "liveness.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = z.looseObject({ feedback: feedbackRulesSchema }).safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} feedback block is invalid: ${z.prettifyError(parsed.error)}`)
    return parsed.data.feedback
}

const itemOf = (row: Record<string, unknown>): FeedbackItem => ({
    id: String(row.id),
    words: String(row.words),
    givenOn: String(row.given_on),
    status: row.status === "closed" ? "closed" : "open",
    recordedAt: String(row.recorded_at),
    targetKind: FEEDBACK_TARGET_KINDS.find((kind) => kind === row.target_kind) ?? null,
    target: typeof row.target === "string" ? row.target : null,
    evidence: typeof row.evidence === "string" ? row.evidence : null,
    closedAt: typeof row.closed_at === "string" ? row.closed_at : null,
})

const onFeedback = <T>(work: (db: DatabaseSync) => T): T =>
    withMachine((db) => {
        db.exec(TABLE)
        return work(db)
    })

const find = (db: DatabaseSync, id: string): FeedbackItem | undefined => {
    const row = db.prepare("SELECT * FROM owner_feedback WHERE id = ?").get(id)
    return row === undefined ? undefined : itemOf(row)
}

/** Every feedback item, oldest given first; an empty list when the host store does not exist yet. */
export const listFeedback = (): FeedbackItem[] =>
    readMachine(
        (db) => {
            db.exec(TABLE)
            return db.prepare("SELECT * FROM owner_feedback ORDER BY given_on, id").all().map(itemOf)
        },
        [] as FeedbackItem[],
    )

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The calendar day of an ISO time, UTC. */
export const dayOf = (iso: string): string => iso.slice(0, 10)

/** Whole days from `day` to `today` (both YYYY-MM-DD). */
export const daysBetween = (day: string, today: string): number => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)

/**
 * Records one owner feedback, open, with the words exactly as given. The same words on the same day answer the item already
 * recorded (`created` false), so a relayed message recorded twice is one item. Ids are `fb-<day>-<n>` unless `id` is given.
 */
export const addFeedback = (words: string, givenOn: string | undefined, id: string | undefined): { readonly item: FeedbackItem; readonly created: boolean } => {
    if (words.trim() === "") throw new Refusal("FEEDBACK_WORDS_EMPTY", "a feedback carries the owner's words; none were given")
    const today = dayOf(now())
    const day = givenOn ?? today
    if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new Refusal("FEEDBACK_DATE_INVALID", `--on ${day} is no YYYY-MM-DD day`)
    if (day > today) throw new Refusal("FEEDBACK_DATE_INVALID", `--on ${day} is after today (${today})`)
    if (id !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Refusal("FEEDBACK_ID_INVALID", `--id ${id} is not lower-case letters, digits and dashes`)
    return onFeedback((db) => {
        const same = db.prepare("SELECT * FROM owner_feedback WHERE given_on = ? AND words = ?").get(day, words)
        if (same !== undefined) {
            const item = itemOf(same)
            if (id !== undefined && id !== item.id) throw new Refusal("FEEDBACK_DUPLICATE", `these words of ${day} are already ${item.id}`)
            return { item, created: false }
        }
        const prefix = `fb-${day}-`
        const count = Number(db.prepare("SELECT COUNT(*) AS n FROM owner_feedback WHERE id LIKE ?").get(`${prefix}%`)?.n ?? 0)
        const chosen = id ?? `${prefix}${String(count + 1)}`
        if (find(db, chosen) !== undefined) throw new Refusal("FEEDBACK_DUPLICATE", `${chosen} already names other words`)
        db.prepare("INSERT INTO owner_feedback (id, words, given_on, status, recorded_at) VALUES (?, ?, ?, 'open', ?)").run(chosen, words, day, now())
        const item = find(db, chosen)
        if (item === undefined) throw new Refusal("FEEDBACK_UNKNOWN", `${chosen} was not recorded`)
        return { item, created: true }
    })
}

/**
 * Closes one feedback on a target the caller has already resolved (`evidence` says what it found). Closing a closed item on the
 * same target answers it unchanged; on another target it is refused, since a closure is a fact, not a choice to revise.
 */
export const closeFeedback = (id: string, kind: FeedbackTargetKind, target: string, evidence: string): { readonly item: FeedbackItem; readonly changed: boolean } =>
    onFeedback((db) => {
        const item = find(db, id)
        if (item === undefined) throw new Refusal("FEEDBACK_UNKNOWN", `no feedback ${id}; starci feedback list names them`)
        if (item.status === "closed") {
            if (item.targetKind === kind && item.target === target) return { item, changed: false }
            throw new Refusal("FEEDBACK_ALREADY_CLOSED", `${id} is closed on ${String(item.targetKind)} ${String(item.target)}`)
        }
        db.prepare("UPDATE owner_feedback SET status = 'closed', target_kind = ?, target = ?, evidence = ?, closed_at = ? WHERE id = ?").run(kind, target, evidence, now(), id)
        const closed = find(db, id)
        if (closed === undefined) throw new Refusal("FEEDBACK_UNKNOWN", `${id} vanished while closing`)
        return { item: closed, changed: true }
    })

/** The open items and, of them, those older than the liveness bound: what `feedback check` and `supervisor tick` report. */
export const openFeedback = (rules: FeedbackRules, today: string = dayOf(now())): { readonly open: readonly FeedbackItem[]; readonly overdue: readonly FeedbackItem[] } => {
    const open = listFeedback().filter((item) => item.status === "open")
    return { open, overdue: open.filter((item) => daysBetween(item.givenOn, today) > rules.openMaxDays) }
}
