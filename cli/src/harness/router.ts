import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { captureToolSync } from "../shared/exec.js"
import { readCircuit, readQuota } from "./circuit.js"
import type { CircuitState, QuotaReading } from "./circuit.js"
import { now, openExistingLedger } from "./ledger.js"
import { readMachine, runningWorkers, textOf, withMachine } from "./machine.js"
import type { RunningWorkers } from "./machine.js"
import { loadOps } from "./ops.js"
import { poolConcurrency } from "./pools.js"
import type { PoolConcurrency } from "./pools.js"
import { difficultyRank, loadRouting, parseDifficulty, providerOfAgent } from "./routing.js"
import type { Difficulty, MemberSpec, Routing } from "./routing.js"
import { getTask } from "./tasks.js"

/** An owner or workflow bias: each entry names an agent (`codex`), a model, an `agent/model` member or a provider. */
export interface RouteBias {
    readonly only?: readonly string[] | undefined
    readonly avoid?: readonly string[] | undefined
    readonly prefer?: readonly string[] | undefined
}

/** A member that ran an attempt of this task's lineage. */
export interface RouteMember {
    readonly agent: string
    readonly model: string
}

/**
 * What the router needs to pick: the label, an optional measured difficulty (a name or 1..4; the label's floor raises it), the
 * 1-based attempt number in the task's lineage, the contract-red attempts so far (their members, or just
 * their count) and the workflow's bias.
 */
export interface RouteInput {
    readonly label: string
    readonly difficulty?: Difficulty | number | undefined
    readonly attempt: number
    readonly previousRed?: number | readonly RouteMember[] | undefined
    readonly workflowBias?: RouteBias | undefined
}

/** One member a step dropped, and why. */
export interface DroppedMember {
    readonly member: string
    readonly step: string
    readonly reason: string
}

/** The whole decision: how the tier was chosen, the chain after each step, every dropped member and the chosen one. */
export interface RouteRecord {
    readonly at: string
    readonly label: string
    readonly attempt: number
    readonly difficulty: Difficulty | null
    readonly floor: Difficulty
    readonly reds: number
    readonly tierFrom: string
    readonly baseTier: string
    readonly tier: string
    readonly escalated: boolean
    readonly bias: RouteBias
    readonly hostTools: Readonly<Record<string, boolean>>
    readonly chain: readonly string[]
    readonly steps: { readonly step: string; readonly kept: readonly string[]; readonly note?: string }[]
    readonly dropped: DroppedMember[]
    chosen: { readonly member: string; readonly by: string } | null
}

/** The router's answer: the agent, model and effort to launch, where they draw from, and the record that explains it. */
export interface RoutePick {
    readonly agent: string
    readonly model: string
    readonly effort?: string
    readonly provider: string
    readonly pool: string
    readonly tier: string
    readonly record: RouteRecord
}

/** A refused pick, carrying the decision record so the caller can show where every member went. */
export class RouteRefusal extends Refusal {
    public readonly record: RouteRecord
    public readonly resetAt: string | null

    public constructor(code: string, message: string, record: RouteRecord, resetAt: string | null = null) {
        super(code, message)
        this.name = "RouteRefusal"
        this.record = record
        this.resetAt = resetAt
    }
}

/** A tier member with the facts every step reads. */
interface Candidate {
    readonly id: string
    readonly spec: MemberSpec
    readonly pool: string
    readonly provider: string
    readonly circuit: CircuitState
    readonly concurrency: PoolConcurrency
    readonly running: number
    readonly runningMember: number
    readonly quota: QuotaReading
}

/** Everything outside the input the decision reads, gathered once. */
interface Facts {
    readonly routing: Routing
    readonly floor: Difficulty
    readonly labelTools: readonly string[]
    readonly hostTools: Readonly<Record<string, boolean>>
    readonly recent: (tier: string) => readonly string[]
    readonly candidates: (tier: string) => Candidate[]
}

const memberId = (member: { readonly agent: string; readonly model: string }): string => `${member.agent}/${member.model}`

const hostProbed = new Map<string, boolean>()

/** Whether a host tool answers on this machine; probed once per process. */
const hostHas = (routing: Routing, tool: string): boolean => {
    const known = hostProbed.get(tool)
    if (known !== undefined) return known
    const [command, ...args] = routing.hostProbes[tool] ?? []
    let ok = true
    if (command !== undefined) {
        try {
            ok = captureToolSync(command, args, process.cwd()).exitCode === 0
        } catch {
            ok = false
        }
    }
    hostProbed.set(tool, ok)
    return ok
}

const RECENT_PICKS = 20

const gatherFacts = (label: string, at: string): Facts => {
    const routing = loadRouting()
    const spec = loadOps().labels[label]
    if (spec === undefined) throw new Refusal("LABEL_UNKNOWN", `no label ${label} in ops/labels.yaml`)
    const hostTools = Object.fromEntries(spec.hostTools.filter((tool) => tool in routing.hostProbes).map((tool) => [tool, hostHas(routing, tool)]))
    const running: RunningWorkers = runningWorkers()
    const snapshot = (db: DatabaseSync | undefined): { recent: Map<string, string[]>; candidates: Map<string, Candidate[]> } => {
        const recent = new Map<string, string[]>()
        const candidates = new Map<string, Candidate[]>()
        for (const [tier, members] of Object.entries(routing.tiers)) {
            const rows = db?.prepare("SELECT member FROM route_picks WHERE tier = ? ORDER BY id DESC LIMIT ?").all(tier, RECENT_PICKS) ?? []
            recent.set(tier, rows.map((row) => textOf(row.member) ?? ""))
            candidates.set(
                tier,
                members.map((member) => {
                    const pool = member.agent
                    return {
                        id: memberId(member),
                        spec: member,
                        pool,
                        provider: providerOfAgent(routing, member.agent),
                        circuit: readCircuit(db, providerOfAgent(routing, member.agent), at),
                        concurrency: poolConcurrency(db, routing, pool),
                        running: running.byAgent.get(member.agent) ?? 0,
                        runningMember: running.byMember.get(memberId(member)) ?? 0,
                        quota: readQuota(db, routing, pool, at),
                    }
                }),
            )
        }
        return { recent, candidates }
    }
    const facts = readMachine<ReturnType<typeof snapshot> | undefined>(snapshot, undefined) ?? snapshot(undefined)
    return {
        routing,
        floor: spec.floor,
        labelTools: spec.hostTools,
        hostTools,
        recent: (tier) => facts.recent.get(tier) ?? [],
        candidates: (tier) => facts.candidates.get(tier) ?? [],
    }
}

const named = (candidate: Candidate, names: readonly string[] | undefined): boolean =>
    (names ?? []).some((name) => name === candidate.spec.agent || name === candidate.spec.model || name === candidate.id || name === candidate.provider)

/** Why a member fails the hard filter (pool role, tools, lineage exclusion, open circuit, capacity), or null when it passes. */
const hardReason = (candidate: Candidate, input: RouteInput, facts: Facts, redsByPool: ReadonlyMap<string, number>): string | null => {
    const pool = facts.routing.pools[candidate.pool]
    if (pool === undefined) return `no pool ${candidate.pool}`
    if (!pool.labels.includes(input.label)) return `pool ${candidate.pool} does not take ${input.label} work`
    const lacking = facts.labelTools.filter((tool) => !pool.tools.includes(tool))
    if (lacking.length > 0) return `pool ${candidate.pool} has no ${lacking.join(", ")}`
    const missing = facts.labelTools.filter((tool) => facts.hostTools[tool] === false)
    if (missing.length > 0) return `host has no ${missing.join(", ")}`
    const reds = redsByPool.get(candidate.pool) ?? 0
    if (reds >= 2) return `excluded by this task's lineage: ${String(reds)} contract-red attempts on pool ${candidate.pool}`
    if (candidate.circuit.open) return `provider ${candidate.provider} circuit open (${candidate.circuit.failureKind ?? "?"}) until ${candidate.circuit.openUntil ?? "?"}`
    const limit = Math.min(pool.maxParallel, candidate.concurrency.cap)
    if (candidate.running >= limit) return `pool ${candidate.pool} full: ${String(candidate.running)} running of ${String(limit)} (maxParallel ${String(pool.maxParallel)}, AIMD cap ${String(candidate.concurrency.cap)})`
    return null
}

/** The quota verdict of a member: null when it may be used; unknown or stale readings are never a reason. */
const tokenReason = (candidate: Candidate, routing: Routing, biased: boolean): string | null => {
    const { quota } = candidate
    if (!quota.fresh || quota.usedPercent === null) return null
    const used = quota.usedPercent
    const { reservePercent, biasPercent, exhaustedPercent } = routing.quota
    if (used >= exhaustedPercent) return `quota exhausted (${String(used)}%)`
    if (used >= biasPercent) return `quota at ${String(used)}%, at or over ${String(biasPercent)}%`
    if (used >= reservePercent && !biased) return `quota at ${String(used)}%, in the ${String(reservePercent)}% reserve`
    return null
}

const quotaNote = (candidates: readonly Candidate[]): string | undefined => {
    const unknown = candidates.filter((candidate) => !candidate.quota.fresh).map((candidate) => candidate.id)
    return unknown.length === 0 ? undefined : `quota unknown (kept): ${unknown.join(", ")}`
}

const earliest = (times: readonly (string | null)[]): string | null => times.filter((time): time is string => time !== null).sort()[0] ?? null

const redMembers = (previousRed: RouteInput["previousRed"]): readonly RouteMember[] => (typeof previousRed === "number" || previousRed === undefined ? [] : previousRed)

/** Runs the decision over gathered facts; pure but for its facts. */
const decide = (input: RouteInput, facts: Facts, at: string): RoutePick | RouteRefusal => {
    const { routing } = facts
    const difficulty = input.difficulty === undefined ? null : parseDifficulty(routing, input.difficulty)
    const effective = difficulty !== null && difficultyRank(routing, difficulty) > difficultyRank(routing, facts.floor) ? difficulty : facts.floor
    const labelTier = routing.labelTiers[input.label]
    const baseTier = labelTier ?? routing.difficultyTier[effective]
    const reds = typeof input.previousRed === "number" ? input.previousRed : redMembers(input.previousRed).length
    const order = routing.tierOrder.indexOf(baseTier)
    const raised = reds >= routing.escalateAfterReds ? routing.tierOrder[order + 1] : undefined
    const tier = raised ?? baseTier
    const bias: RouteBias = input.workflowBias ?? {}
    const candidates = facts.candidates(tier)
    const record: RouteRecord = {
        at,
        label: input.label,
        attempt: input.attempt,
        difficulty,
        floor: facts.floor,
        reds,
        tierFrom: labelTier === undefined ? `difficulty ${effective} (max of ${difficulty ?? "none"} and floor ${facts.floor})` : `labelTiers.${input.label}`,
        baseTier,
        tier,
        escalated: raised !== undefined,
        bias,
        hostTools: facts.hostTools,
        chain: candidates.map((candidate) => candidate.id),
        steps: [],
        dropped: [],
        chosen: null,
    }
    const snapshot = (step: string, kept: readonly Candidate[], note?: string): void => {
        record.steps.push({ step, kept: kept.map((candidate) => candidate.id), ...(note === undefined ? {} : { note }) })
    }
    const drop = (candidate: Candidate, step: string, reason: string): void => {
        record.dropped.push({ member: candidate.id, step, reason })
    }
    if (reds >= routing.escalateAfterReds && raised === undefined) snapshot("tier", candidates, `already at the top tier ${tier}; ${String(reds)} contract-red attempts escalate no further`)

    // 1. Hard filter: nothing a bias can restore.
    const redsByPool = new Map<string, number>()
    for (const member of redMembers(input.previousRed)) redsByPool.set(member.agent, (redsByPool.get(member.agent) ?? 0) + 1)
    const hard = candidates.filter((candidate) => {
        const reason = hardReason(candidate, input, facts, redsByPool)
        if (reason !== null) drop(candidate, "hard-filter", reason)
        return reason === null
    })
    snapshot("hard-filter", hard)
    if (hard.length === 0) {
        const steps = record.dropped.map((row) => row.reason)
        const circuitOnly = steps.every((reason) => reason.startsWith("provider "))
        const fullOnly = steps.every((reason) => reason.startsWith("pool ") && reason.includes(" full: "))
        const reasons = record.dropped.map((row) => `${row.member}: ${row.reason}`).join("; ")
        if (circuitOnly) return new RouteRefusal("PROVIDERS_UNAVAILABLE", `every member of tier ${tier} has its provider circuit open: ${reasons}`, record, earliest(candidates.map((candidate) => candidate.circuit.openUntil)))
        if (fullOnly) return new RouteRefusal("POOLS_FULL", `every pool of tier ${tier} is at its concurrency; the task waits in the queue: ${reasons}`, record)
        return new RouteRefusal("ROUTE_NO_MEMBER", `no member of tier ${tier} can take ${input.label} work: ${reasons}`, record)
    }

    // 2. Lineage: a pool with one contract-red attempt of this task goes to the back, so the retry goes to another member.
    const demoted = hard.filter((candidate) => (redsByPool.get(candidate.pool) ?? 0) === 1)
    const lineage = [...hard.filter((candidate) => !demoted.includes(candidate)), ...demoted]
    snapshot("lineage", lineage, demoted.length === 0 ? undefined : `demoted after one contract-red: ${demoted.map((candidate) => candidate.id).join(", ")}`)

    // 3. Owner bias: only keeps, avoid removes, prefer moves to the front; a bias that empties the chain refuses.
    let biased = (bias.only ?? []).length > 0 ? lineage.filter((candidate) => named(candidate, bias.only)) : lineage
    for (const candidate of lineage) if (!biased.includes(candidate)) drop(candidate, "bias", "not named by only")
    for (const candidate of biased.filter((member) => named(member, bias.avoid))) drop(candidate, "bias", "avoided")
    biased = biased.filter((candidate) => !named(candidate, bias.avoid))
    biased = [...biased.filter((candidate) => named(candidate, bias.prefer)), ...biased.filter((candidate) => !named(candidate, bias.prefer))]
    snapshot("bias", biased)
    if (biased.length === 0) return new RouteRefusal("ROUTE_BIAS_EMPTY", `the bias leaves no member of tier ${tier}: ${record.dropped.filter((row) => row.step === "bias").map((row) => `${row.member} ${row.reason}`).join("; ")}`, record)
    const biasActive = (bias.only ?? []).length > 0 || (bias.prefer ?? []).length > 0
    const isBiased = (candidate: Candidate): boolean => named(candidate, bias.prefer) || named(candidate, bias.only)

    // 4. Balance: a head picked maxStreak times in a row, or over maxSharePercent of the tier's running seats, yields to the
    //    next member with tokens. An active bias is the owner's choice and is not balanced away.
    let balanced = biased
    let yielded: string | null = null
    let balanceNote: string | undefined = biasActive ? "bias active: not balanced" : undefined
    const head = biased[0]
    if (!biasActive && head !== undefined && biased.length > 1) {
        const recent = facts.recent(tier)
        const streak = recent.findIndex((member) => member !== head.id)
        const inRow = streak === -1 ? recent.length : streak
        const total = biased.reduce((sum, candidate) => sum + candidate.runningMember, 0)
        const share = total === 0 ? 0 : (head.runningMember / total) * 100
        let reason: string | null = null
        if (inRow >= routing.balance.maxStreak) reason = `${head.id} was picked ${String(inRow)} times in a row`
        else if (share > routing.balance.maxSharePercent) reason = `${head.id} holds ${String(Math.round(share))}% of the tier's running seats`
        const next = reason === null ? undefined : biased.slice(1).find((candidate) => tokenReason(candidate, routing, isBiased(candidate)) === null)
        if (reason !== null && next !== undefined) {
            balanced = [next, ...biased.filter((candidate) => candidate !== next)]
            yielded = `${reason}; yields to ${next.id}`
            balanceNote = yielded
        } else if (reason !== null) {
            balanceNote = `${reason}, but no next member has quota; kept`
        }
    }
    snapshot("balance", balanced, balanceNote)

    // 5. Quota: skip a member at the reserve (a biased one may go to biasPercent), never use an exhausted one; unknown is kept.
    const ordered = balanced.filter((candidate) => {
        const reason = tokenReason(candidate, routing, isBiased(candidate))
        if (reason !== null) drop(candidate, "quota", reason)
        return reason === null
    })
    snapshot("quota", ordered, quotaNote(balanced))
    const chosen = ordered[0]
    if (chosen === undefined) {
        const resetAt = earliest(balanced.map((candidate) => candidate.quota.resetsAt))
        return new RouteRefusal("TOKENS_OUT", `every member of tier ${tier} is out of quota${resetAt === null ? "" : `; the earliest reset is ${resetAt}`}: ${record.dropped.filter((row) => row.step === "quota").map((row) => `${row.member} ${row.reason}`).join("; ")}`, record, resetAt)
    }
    let by = "chain-order"
    if (biasActive && isBiased(chosen)) by = "bias"
    else if (yielded !== null && chosen === balanced[0]) by = "balance"
    else if (record.dropped.some((row) => row.step === "quota")) by = "quota"
    else if (demoted.length > 0 && chosen !== hard[0]) by = "lineage"
    record.chosen = { member: chosen.id, by }
    return {
        agent: chosen.spec.agent,
        model: chosen.spec.model,
        ...(chosen.spec.effort === undefined ? {} : { effort: chosen.spec.effort }),
        provider: chosen.provider,
        pool: chosen.pool,
        tier,
        record,
    }
}

const PICK_RETENTION_DAYS = 7

/**
 * Picks the agent, model and effort of one dispatch: tier = labelTiers[label] ?? difficultyTier[max(difficulty, floor)],
 * raised one step by the second contract-red; then the tier's chain through the hard filter, lineage, bias, balance and quota
 * steps. Returns the pick (its record is what the attempt stores as pick_json) or a RouteRefusal; never throws for a
 * routing answer. A pick is remembered for the balance step unless `record` is false (a dry run or an explain).
 */
export const pickRoute = (input: RouteInput, options: { readonly record?: boolean } = {}): RoutePick | RouteRefusal => {
    const at = now()
    let decided: RoutePick | RouteRefusal
    try {
        decided = decide(input, gatherFacts(input.label, at), at)
    } catch (error: unknown) {
        if (error instanceof Refusal) return new RouteRefusal(error.code, error.message, emptyRecord(input, at))
        throw error
    }
    if (decided instanceof RouteRefusal || options.record === false) return decided
    const pick = decided
    withMachine((db) => {
        db.prepare("INSERT INTO route_picks (at, tier, member, pool, label, chosen_by) VALUES (?, ?, ?, ?, ?, ?)").run(at, pick.tier, memberId(pick), pick.pool, input.label, pick.record.chosen?.by ?? "")
        db.prepare("DELETE FROM route_picks WHERE at < ?").run(new Date(Date.parse(at) - PICK_RETENTION_DAYS * 86_400_000).toISOString())
    })
    return pick
}

const emptyRecord = (input: RouteInput, at: string): RouteRecord => ({
    at,
    label: input.label,
    attempt: input.attempt,
    difficulty: null,
    floor: "easy",
    reds: 0,
    tierFrom: "",
    baseTier: "",
    tier: "",
    escalated: false,
    bias: input.workflowBias ?? {},
    hostTools: {},
    chain: [],
    steps: [],
    dropped: [],
    chosen: null,
})

/** Stores a pick on its attempt (attempts.pick_json), so a dispatch of that attempt reuses it and status can show it. */
export const recordPick = (db: DatabaseSync, attemptId: string, pick: RoutePick): void => {
    db.prepare("UPDATE attempts SET pick_json = ? WHERE id = ?").run(JSON.stringify(pick), attemptId)
}

/** A task's lineage as the router reads it: the attempts of the task and the tasks it retries, and their contract-red members. */
export interface Lineage {
    readonly label: string
    readonly attempts: number
    readonly reds: readonly RouteMember[]
}

/** Walks a task's retry chain in its ledger; every attempt counts toward the attempt number, every red verdict is a red. */
export const lineageOf = (db: DatabaseSync, taskId: string): Lineage => {
    const task = getTask(db, taskId)
    const reds: RouteMember[] = []
    let attempts = 0
    const seen = new Set<string>()
    let current: string | null = task.id
    while (current !== null && !seen.has(current)) {
        seen.add(current)
        for (const row of db.prepare("SELECT agent, model, verdict FROM attempts WHERE task_id = ? ORDER BY seq").all(current)) {
            attempts += 1
            const agent = textOf(row.agent)
            const model = textOf(row.model)
            if (textOf(row.verdict) === "red" && agent !== null && model !== null) reds.push({ agent, model })
        }
        current = getTask(db, current).retryOf
    }
    return { label: task.label, attempts, reds }
}

/** Routes the next attempt of a queued task from its ledger: its label, attempt number and contract-red lineage. */
export const routeTask = (root: string, taskId: string, options: { readonly bias?: RouteBias | undefined; readonly record?: boolean } = {}): RoutePick | Refusal => {
    const db = openExistingLedger(root)
    if (db === undefined) return new Refusal("TASK_UNKNOWN", `no task ${taskId}: this project has no ledger yet`)
    let lineage: Lineage
    try {
        lineage = lineageOf(db, taskId)
    } catch (error: unknown) {
        if (error instanceof Refusal) return error
        throw error
    } finally {
        db.close()
    }
    return pickRoute({ label: lineage.label, attempt: lineage.attempts + 1, previousRed: lineage.reds, workflowBias: options.bias }, { record: options.record ?? true })
}

/** The decision path as text lines, for route explain and dry runs. */
export const describeRoute = (answer: RoutePick | RouteRefusal): string[] => {
    const record = answer.record
    const lines = [
        `label ${record.label}, attempt ${String(record.attempt)}, difficulty ${record.difficulty ?? "-"}, floor ${record.floor}, contract-red ${String(record.reds)}`,
        `tier ${record.tier}${record.escalated ? ` (escalated from ${record.baseTier} after ${String(record.reds)} contract-red)` : ""} from ${record.tierFrom}`,
        `chain: ${record.chain.join(" > ") || "-"}`,
        ...(Object.keys(record.hostTools).length === 0 ? [] : [`host tools: ${Object.entries(record.hostTools).map(([tool, ok]) => `${tool} ${ok ? "ok" : "missing"}`).join(", ")}`]),
        ...record.steps.map((step) => `  ${step.step}: ${step.kept.join(" > ") || "(none)"}${step.note === undefined ? "" : `  [${step.note}]`}`),
        ...record.dropped.map((row) => `  dropped ${row.member} at ${row.step}: ${row.reason}`),
    ]
    if (answer instanceof RouteRefusal) return [...lines, `refused ${answer.code}: ${answer.message}`]
    return [...lines, `chosen ${answer.agent} ${answer.model}${answer.effort === undefined ? "" : ` (effort ${answer.effort})`} by ${record.chosen?.by ?? "?"}; pool ${answer.pool}, provider ${answer.provider}`]
}
