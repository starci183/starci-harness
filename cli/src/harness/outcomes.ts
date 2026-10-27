import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { now } from "./ledger.js"
import { readMachine, textOf, withMachine } from "./machine.js"
import type { Qualification, Routing } from "./routing.js"

/**
 * How one ended attempt counts for its member: a green or red verdict, a timeout (fenced past its budget), stalled (given up
 * by the stall ladder: idle at its prompt with its work pending), lost (the worker went away), a launch that certainly
 * failed, or a model mismatch. A cancelled or unjudged attempt does not count.
 */
export type OutcomeClass = "green" | "red" | "timeout" | "lost" | "stalled" | "launch" | "mismatch"

const CLASSES: readonly OutcomeClass[] = ["green", "red", "timeout", "lost", "stalled", "launch", "mismatch"]

const BY_OUTCOME: Readonly<Record<string, OutcomeClass>> = { timeout: "timeout", orphaned: "lost", stalled: "stalled", "launch-failed": "launch", "model-mismatch": "mismatch" }

/** The class of an attempt from its verdict, else its ended outcome; null while it has neither. */
export const classOf = (verdict: string | null, outcome: string | null): OutcomeClass | null => {
    if (verdict === "green" || verdict === "red") return verdict
    return outcome === null ? null : (BY_OUTCOME[outcome] ?? null)
}

const windowStart = (routing: Routing, at: string): string => new Date(Date.parse(at) - routing.outcomes.windowDays * 86_400_000).toISOString()

interface Ended {
    readonly ledger: string
    readonly attemptId: string
    readonly member: string
    readonly pool: string
    readonly label: string
    readonly kind: OutcomeClass
    readonly minutes: number | null
    readonly endedAt: string
}

const endedOf = (file: string, since: string): Ended[] => {
    let ledger: DatabaseSync | undefined
    try {
        ledger = new DatabaseSync(file, { readOnly: true, timeout: 5000 })
        const rows = ledger
            .prepare("SELECT a.id, a.agent, a.model, a.outcome, a.verdict, a.started_at, a.ended_at, t.label FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE a.ended_at IS NOT NULL AND a.ended_at >= ?")
            .all(since)
        return rows.flatMap((row): Ended[] => {
            const kind = classOf(textOf(row.verdict), textOf(row.outcome))
            const agent = textOf(row.agent)
            const endedAt = textOf(row.ended_at) ?? ""
            if (kind === null || agent === null) return []
            const minutes = (Date.parse(endedAt) - Date.parse(textOf(row.started_at) ?? endedAt)) / 60_000
            return [{ ledger: file, attemptId: textOf(row.id) ?? "", member: `${agent}/${textOf(row.model) ?? "?"}`, pool: agent, label: textOf(row.label) ?? "", kind, minutes: Number.isFinite(minutes) ? minutes : null, endedAt }]
        })
    } catch {
        // A ledger that cannot be opened or read now (locked, damaged) is read again by the next pick.
        return []
    } finally {
        ledger?.close()
    }
}

/**
 * Records every ended attempt of the outcomes window from every registered ledger into member_outcomes (an attempt whose
 * verdict arrives later is updated in place), and forgets what fell out of the window. Returns how many rows it wrote.
 */
export const recordMemberOutcomes = (routing: Routing, at: string = now()): number => {
    const since = windowStart(routing, at)
    const files = readMachine((db) => db.prepare("SELECT file FROM ledgers WHERE state != 'retired'").all().map((row) => textOf(row.file) ?? ""), [])
    const ended = files.filter((file) => file !== "" && existsSync(file)).flatMap((file) => endedOf(file, since))
    if (files.length === 0) return 0
    return withMachine((db) => {
        const upsert = db.prepare(
            `INSERT INTO member_outcomes (ledger, attempt_id, member, pool, label, class, minutes, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(ledger, attempt_id) DO UPDATE SET member = excluded.member, pool = excluded.pool, label = excluded.label, class = excluded.class,
             minutes = excluded.minutes, ended_at = excluded.ended_at`,
        )
        for (const row of ended) upsert.run(row.ledger, row.attemptId, row.member, row.pool, row.label, row.kind, row.minutes, row.endedAt)
        db.prepare("DELETE FROM member_outcomes WHERE ended_at < ?").run(since)
        return ended.length
    })
}

/**
 * Records a coordinator seat the stall ladder gave up on as a `stalled` outcome of its member, with its role as the label: a
 * Kernel or Supervisor has no attempt row, so its seat is the evidence (keyed `seat:<id>` beside the ledger's attempts).
 */
export const recordSeatOutcome = (seat: { readonly ledger: string; readonly id: string; readonly agent: string; readonly model: string | null; readonly role: string; readonly startedAt: string }, at: string = now()): void => {
    const minutes = (Date.parse(at) - Date.parse(seat.startedAt)) / 60_000
    withMachine((db) =>
        db
            .prepare(
                `INSERT INTO member_outcomes (ledger, attempt_id, member, pool, label, class, minutes, ended_at) VALUES (?, ?, ?, ?, ?, 'stalled', ?, ?)
                 ON CONFLICT(ledger, attempt_id) DO NOTHING`,
            )
            .run(seat.ledger, `seat:${seat.id}`, `${seat.agent}/${seat.model ?? "?"}`, seat.agent, seat.role, Number.isFinite(minutes) ? minutes : null, at),
    )
}

/** A member's evidence for one label in the outcomes window: its counts per class and the mean minutes of its worked attempts. */
export interface MemberEvidence {
    readonly green: number
    readonly red: number
    readonly timeout: number
    readonly lost: number
    readonly stalled: number
    readonly launch: number
    readonly mismatch: number
    readonly meanMinutes: number | null
}

const EMPTY: MemberEvidence = { green: 0, red: 0, timeout: 0, lost: 0, stalled: 0, launch: 0, mismatch: 0, meanMinutes: null }

/** The evidence of every member and label in the outcomes window, keyed `member label`; the `*` label is a member's whole record. */
export const memberEvidence = (db: DatabaseSync | undefined, routing: Routing, at: string = now()): ReadonlyMap<string, MemberEvidence> => {
    const rows = db?.prepare("SELECT member, label, class, minutes FROM member_outcomes WHERE ended_at >= ?").all(windowStart(routing, at)) ?? []
    const counts = new Map<string, { evidence: Record<OutcomeClass, number>; minutes: number[] }>()
    for (const row of rows) {
        const kind = CLASSES.find((known) => known === textOf(row.class))
        if (kind === undefined) continue
        for (const key of [`${textOf(row.member) ?? ""} ${textOf(row.label) ?? ""}`, `${textOf(row.member) ?? ""} *`]) {
            const entry = counts.get(key) ?? { evidence: { green: 0, red: 0, timeout: 0, lost: 0, stalled: 0, launch: 0, mismatch: 0 }, minutes: [] }
            entry.evidence[kind] += 1
            const minutes = row.minutes === null ? null : Number(row.minutes)
            if (minutes !== null && (kind === "green" || kind === "red" || kind === "timeout")) entry.minutes.push(minutes)
            counts.set(key, entry)
        }
    }
    return new Map(
        [...counts].map(([key, { evidence, minutes }]) => [key, { ...evidence, meanMinutes: minutes.length === 0 ? null : minutes.reduce((sum, value) => sum + value, 0) / minutes.length }]),
    )
}

/** The evidence of a member for a label (none is all zero). */
export const evidenceOf = (evidence: ReadonlyMap<string, MemberEvidence>, member: string, label: string): MemberEvidence => evidence.get(`${member} ${label}`) ?? EMPTY

/** A member's qualification for a label in a tier: high or standard from its verdicts, a startStandard tier's member standard until its verdicts say otherwise, else probation. */
export const qualificationOf = (routing: Routing, evidence: MemberEvidence, tier: string): Qualification => {
    const verified = evidence.green + evidence.red
    const greenPercent = verified === 0 ? 0 : (evidence.green / verified) * 100
    const { standard, high, startStandard } = routing.qualification
    if (verified >= high.verified && greenPercent >= high.greenPercent) return "high"
    if (verified >= standard.verified && greenPercent >= standard.greenPercent) return "standard"
    return verified < standard.verified && startStandard.includes(tier) ? "standard" : "probation"
}

/** The Beta posterior of a member's green rate for a label: the prior plus its greens, and its reds, timeouts, lost and stalled workers. */
export const posteriorOf = (routing: Routing, evidence: MemberEvidence): { readonly alpha: number; readonly beta: number } => ({
    alpha: routing.scoring.prior.green + evidence.green,
    beta: routing.scoring.prior.red + evidence.red + evidence.timeout + evidence.lost + evidence.stalled,
})

/** A standard normal draw (Box-Muller) from a uniform source. */
const normal = (random: () => number): number => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())

/** A Gamma(shape, 1) draw (Marsaglia and Tsang), shape > 0. */
const gamma = (shape: number, random: () => number): number => {
    if (shape < 1) return gamma(shape + 1, random) * random() ** (1 / shape)
    const d = shape - 1 / 3
    const c = 1 / Math.sqrt(9 * d)
    for (;;) {
        const x = normal(random)
        const v = (1 + c * x) ** 3
        if (v > 0 && Math.log(1 - random()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v
    }
}

/** A Beta(alpha, beta) draw: Thompson sampling's sample of a member's green rate. */
export const sampleBeta = (alpha: number, beta: number, random: () => number): number => {
    const a = gamma(alpha, random)
    return a / (a + gamma(beta, random))
}
