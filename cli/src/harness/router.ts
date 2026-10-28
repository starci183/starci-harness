import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { captureToolSync } from "../shared/exec.js"
import { CONSUMER_FENCED_OUTCOME } from "./budget.js"
import { readCircuit, readQuota, recordProbe } from "./circuit.js"
import type { CircuitState, QuotaReading } from "./circuit.js"
import { now, openExistingLedger } from "./ledger.js"
import { readMachine, runningWorkers, textOf, withMachine } from "./machine.js"
import type { RunningWorkers } from "./machine.js"
import { loadOps } from "./ops.js"
import { evidenceOf, memberEvidence, posteriorOf, qualificationOf, recordMemberOutcomes, sampleBeta } from "./outcomes.js"
import type { MemberEvidence } from "./outcomes.js"
import { poolConcurrency } from "./pools.js"
import type { PoolConcurrency } from "./pools.js"
import { difficultyRank, loadRouting, parseDifficulty, providerOfAgent, QUALIFICATIONS } from "./routing.js"
import type { CoordinatorRole, Difficulty, MemberSpec, PoolSpec, Qualification, Routing } from "./routing.js"
import { getTask } from "./tasks.js"
import { paceOf, refreshUsage } from "./usage.js"

/** A member that ran an attempt of this task's lineage. */
export interface RouteMember {
    readonly agent: string
    readonly model: string
}

/**
 * What the router needs to pick: the label, an optional measured difficulty (a name or 1..4; the label's floor raises it), the
 * 1-based attempt number in the task's lineage, the contract-red attempts so far (their members, or just their count) and the
 * task's risk tags (any of routing.yaml qualification.riskTags makes it high-risk), and the members of its lineage the stall ladder
 * gave up on (a task's stalled attempts; a coordinator has no lineage).
 */
export interface RouteInput {
    readonly label: string
    readonly coordinator?: CoordinatorRole | undefined
    readonly difficulty?: Difficulty | number | undefined
    readonly attempt: number
    readonly previousRed?: number | readonly RouteMember[] | undefined
    readonly risk?: readonly string[] | undefined
    readonly stalled?: readonly RouteMember[] | undefined
    /** The providers that authored the dependency work of the labels the label's op names in `independentOf`: never picked. */
    readonly authors?: readonly string[] | undefined
}

/** One member a step dropped, and why. */
export interface DroppedMember {
    readonly member: string
    readonly step: string
    readonly reason: string
}

/** How one member scored: its qualification, its evidence, expected success over expected cost, and its Thompson sample when exploring. */
export interface MemberScore {
    readonly member: string
    readonly qualification: Qualification
    readonly green: number
    readonly red: number
    readonly worker: number
    readonly expected: number
    readonly minutes: number
    readonly pace: number | null
    readonly cost: number
    readonly score: number
    readonly sample: number | null
}

/** The exploration decision of a pick: the roll against the share, and the share explore picks already hold of the tier's recent picks. */
export interface ExploreDecision {
    readonly sharePercent: number
    readonly roll: number
    readonly recent: number
    readonly recentExplore: number
    readonly exploring: boolean
}

/** The whole decision: how the tier was chosen, the chain after each step, every dropped member, the scores and the chosen one. */
export interface RouteRecord {
    readonly at: string
    readonly label: string
    readonly attempt: number
    readonly difficulty: Difficulty | null
    readonly floor: Difficulty
    readonly reds: number
    readonly risk: readonly string[]
    readonly highRisk: boolean
    readonly tierFrom: string
    readonly baseTier: string
    tier: string
    readonly escalated: boolean
    readonly hostTools: Readonly<Record<string, boolean>>
    chain: readonly string[]
    readonly steps: { readonly step: string; readonly kept: readonly string[]; readonly note?: string }[]
    readonly dropped: DroppedMember[]
    scores: readonly MemberScore[]
    explore: ExploreDecision | null
    probe: string | null
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
    readonly coordinators: number
    readonly runningMember: number
    readonly quota: QuotaReading
    readonly pace: number | null
}

/** A recorded pick of a tier: its member and why it was chosen. */
interface RecentPick {
    readonly member: string
    readonly by: string
}

/** Everything outside the input the decision reads, gathered once; `random` is the decision's only source of chance. */
interface Facts {
    readonly routing: Routing
    readonly floor: Difficulty
    readonly labelTools: readonly string[]
    readonly hostTools: Readonly<Record<string, boolean>>
    readonly recent: (tier: string) => readonly RecentPick[]
    readonly candidates: (tier: string) => Candidate[]
    readonly evidence: ReadonlyMap<string, MemberEvidence>
    readonly probing: ReadonlySet<string>
    readonly random: () => number
}

const memberId = (member: { readonly agent: string; readonly model: string }): string => `${member.agent}/${member.model}`

const hostProbed = new Map<string, boolean>()

/** Whether a host tool answers on this machine; probed once per process. */
export const hostHas = (routing: Routing, tool: string): boolean => {
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

const gatherFacts = (input: RouteInput, at: string): Facts => {
    const routing = loadRouting()
    const spec = input.coordinator === undefined ? loadOps().labels[input.label] : { floor: "easy" as const, hostTools: [] }
    if (spec === undefined) throw new Refusal("LABEL_UNKNOWN", `no label ${input.label} in ops/ops/`)
    const hostTools = Object.fromEntries(spec.hostTools.filter((tool) => tool in routing.hostProbes).map((tool) => [tool, hostHas(routing, tool)]))
    const running: RunningWorkers = runningWorkers()
    const snapshot = (db: DatabaseSync | undefined): { recent: Map<string, RecentPick[]>; candidates: Map<string, Candidate[]>; evidence: ReadonlyMap<string, MemberEvidence> } => {
        const recent = new Map<string, RecentPick[]>()
        const candidates = new Map<string, Candidate[]>()
        for (const [tier, members] of Object.entries(routing.tiers)) {
            const rows = db?.prepare("SELECT member, chosen_by FROM route_picks WHERE tier = ? ORDER BY id DESC LIMIT ?").all(tier, RECENT_PICKS) ?? []
            recent.set(tier, rows.map((row) => ({ member: textOf(row.member) ?? "", by: textOf(row.chosen_by) ?? "" })))
            candidates.set(
                tier,
                members.map((member) => {
                    const pool = member.agent
                    const provider = providerOfAgent(routing, member.agent)
                    return {
                        id: memberId(member),
                        spec: member,
                        pool,
                        provider,
                        circuit: readCircuit(db, provider, at),
                        concurrency: poolConcurrency(db, routing, pool),
                        running: running.byAgent.get(member.agent) ?? 0,
                        coordinators: running.coordinatorsByAgent.get(member.agent) ?? 0,
                        runningMember: running.byMember.get(memberId(member)) ?? 0,
                        quota: readQuota(db, routing, pool, at),
                        pace: paceOf(db, routing, pool, at),
                    }
                }),
            )
        }
        return { recent, candidates, evidence: memberEvidence(db, routing, at) }
    }
    const facts = readMachine<ReturnType<typeof snapshot> | undefined>(snapshot, undefined) ?? snapshot(undefined)
    return {
        routing,
        floor: spec.floor,
        labelTools: spec.hostTools,
        hostTools,
        recent: (tier) => facts.recent.get(tier) ?? [],
        candidates: (tier) => facts.candidates.get(tier) ?? [],
        evidence: facts.evidence,
        probing: new Set(),
        random: Math.random,
    }
}

const earliest = (times: readonly (string | null)[]): string | null => times.filter((time): time is string => time !== null).sort((a, b) => (a < b ? -1 : Number(a > b)))[0] ?? null

const redMembers = (previousRed: RouteInput["previousRed"]): readonly RouteMember[] => (typeof previousRed === "number" || previousRed === undefined ? [] : previousRed)

/** What the steps of one decision share: the record it writes and how a step notes its kept and dropped members. */
interface Stage {
    readonly routing: Routing
    readonly record: RouteRecord
    readonly snapshot: (step: string, kept: readonly Candidate[], note?: string) => void
    readonly drop: (candidate: Candidate, step: string, reason: string) => void
}

/** The dropped members of one step as `member reason` text. */
const droppedText = (record: RouteRecord, step: string): string =>
    record.dropped
        .filter((row) => row.step === step)
        .map((row) => row.member + " " + row.reason)
        .join("; ")

/** A member's qualification for the input's label in its tier. */
const qualificationIn = (facts: Facts, input: RouteInput, candidate: Candidate, tier: string): Qualification =>
    qualificationOf(facts.routing, evidenceOf(facts.evidence, candidate.id, input.label), tier)

/** Why a member's circuit keeps it out: open and waiting for its probe, or its one probe already in flight; null when it may run. */
const circuitReason = (candidate: Candidate, facts: Facts, highRisk: boolean): string | null => {
    const { circuit } = candidate
    if (!circuit.open) return null
    const kind = circuit.failureKind ?? "?"
    if (circuit.probe === "in-flight" || facts.probing.has(candidate.provider)) return `provider ${candidate.provider} circuit open (${kind}); its probe is in flight`
    if (circuit.probe === "none") return `provider ${candidate.provider} circuit open (${kind}) until ${circuit.openUntil ?? "?"}; next probe at ${circuit.probeDueAt ?? "?"}`
    return highRisk ? `provider ${candidate.provider} circuit half-open (${kind}); a high-risk task is never a probe` : null
}

/**
 * Why a pool has no slot for this pick, or null. The limit is maxParallel under the AIMD cap; `coordinatorReserve` of it is held
 * for coordinator seats: a coordinator pick takes a slot while its seats hold fewer than the reserve, whatever the workers hold,
 * else while the pool is under its limit; a worker pick counts the reserve as taken (or the coordinators, when they hold more).
 */
const capacityReason = (candidate: Candidate, pool: PoolSpec, coordinator: boolean): string | null => {
    const limit = Math.min(pool.maxParallel, candidate.concurrency.cap)
    const reserve = Math.min(pool.coordinatorReserve, limit)
    const workers = candidate.running - candidate.coordinators
    const caps = `maxParallel ${String(pool.maxParallel)}, AIMD cap ${String(candidate.concurrency.cap)}, coordinatorReserve ${String(reserve)}`
    if (coordinator) {
        if (candidate.coordinators < reserve || candidate.running < limit) return null
        return `pool ${candidate.pool} full: ${String(candidate.running)} running of ${String(limit)}, ${String(candidate.coordinators)} coordinators past the reserve (${caps})`
    }
    const taken = workers + Math.max(candidate.coordinators, reserve)
    return taken < limit ? null : `pool ${candidate.pool} full for workers: ${String(workers)} workers and ${String(Math.max(candidate.coordinators, reserve))} coordinator slots of ${String(limit)} (${caps})`
}

/** Why a member fails the hard filter (pool role, tools, lineage exclusion, circuit, capacity, qualification), or null when it passes. */
const hardReason = (candidate: Candidate, input: RouteInput, facts: Facts, tier: string, highRisk: boolean, redsByPool: ReadonlyMap<string, number>): { readonly step: string; readonly reason: string } | null => {
    const pool = facts.routing.pools[candidate.pool]
    const fail = (reason: string, step = "hard-filter"): { readonly step: string; readonly reason: string } => ({ step, reason })
    if (pool === undefined) return fail(`no pool ${candidate.pool}`)
    if (!pool.labels.includes(input.label)) return fail(`pool ${candidate.pool} does not take ${input.label} work`)
    const lacking = facts.labelTools.filter((tool) => !pool.tools.includes(tool))
    if (lacking.length > 0) return fail(`pool ${candidate.pool} has no ${lacking.join(", ")}`)
    const missing = facts.labelTools.filter((tool) => facts.hostTools[tool] === false)
    if (missing.length > 0) return fail(`host has no ${missing.join(", ")}`)
    const reds = redsByPool.get(candidate.pool) ?? 0
    if (reds >= 2) return fail(`excluded by this task's lineage: ${String(reds)} contract-red attempts on pool ${candidate.pool}`)
    if (input.authors?.includes(candidate.provider) === true) return fail(`provider ${candidate.provider} authored the work this ${input.label} task reads`, "independence")
    const circuit = circuitReason(candidate, facts, highRisk)
    if (circuit !== null) return fail(circuit)
    const capacity = capacityReason(candidate, pool, input.coordinator !== undefined)
    if (capacity !== null) return fail(capacity)
    const minimum = facts.routing.qualification.riskMinimum
    const qualification = qualificationIn(facts, input, candidate, tier)
    if (highRisk && QUALIFICATIONS.indexOf(qualification) < QUALIFICATIONS.indexOf(minimum)) return fail(`${qualification} for ${input.label}; a high-risk task needs ${minimum}`, "qualification")
    return null
}

/** The refusal of a hard filter that kept nobody, named by why the members fell. */
const hardRefusal = (stage: Stage, input: RouteInput, candidates: readonly Candidate[]): RouteRefusal => {
    const { record } = stage
    const tier = record.tier
    const reasons = record.dropped.map((row) => `${row.member}: ${row.reason}`).join("; ")
    if (record.dropped.every((row) => row.reason.startsWith("provider "))) {
        return new RouteRefusal("PROVIDERS_UNAVAILABLE", `every member of tier ${tier} has its provider circuit open: ${reasons}`, record, earliest(candidates.map((candidate) => candidate.circuit.probeDueAt)))
    }
    if (record.dropped.every((row) => row.reason.includes(" full: "))) return new RouteRefusal("POOLS_FULL", `every pool of tier ${tier} is at its concurrency; the task waits in the queue: ${reasons}`, record)
    if (record.dropped.some((row) => row.step === "qualification")) return new RouteRefusal("ROUTE_UNQUALIFIED", `no member of tier ${tier} or above is qualified for high-risk ${input.label} work: ${reasons}`, record)
    return new RouteRefusal("ROUTE_NO_MEMBER", `no member of tier ${tier} can take ${input.label} work: ${reasons}`, record)
}

/** The quota verdict of a member: null when it may be used; unknown or stale readings are never a reason. */
const quotaReason = (candidate: Candidate, routing: Routing): { readonly reserve: boolean; readonly reason: string } | null => {
    const { quota } = candidate
    if (!quota.fresh || quota.usedPercent === null) return null
    const used = quota.usedPercent
    const until = quota.resetsAt === null ? "" : ` until ${quota.resetsAt}`
    if (used >= routing.quota.exhaustedPercent) return { reserve: false, reason: `quota exhausted (${String(used)}%)${until}` }
    if (used >= routing.quota.reservePercent) return { reserve: true, reason: `quota at ${String(used)}%, in the ${String(routing.quota.reservePercent)}% reserve` }
    return null
}

/** The quota step: an exhausted member is never used, one in the reserve only when no member below it is left; unknown is kept. */
const quotaStep = (stage: Stage, members: readonly Candidate[]): Candidate[] => {
    const verdicts = members.map((candidate) => ({ candidate, verdict: quotaReason(candidate, stage.routing) }))
    const roomy = verdicts.some(({ verdict }) => verdict === null)
    const kept = verdicts.filter(({ candidate, verdict }) => {
        const drop = verdict !== null && (!verdict.reserve || roomy)
        if (drop) stage.drop(candidate, "quota", verdict.reason)
        return !drop
    })
    const unknown = members.filter((candidate) => !candidate.quota.fresh).map((candidate) => candidate.id)
    const reserveUsed = kept.filter(({ verdict }) => verdict !== null).map(({ candidate }) => candidate.id)
    const notes = [...(unknown.length === 0 ? [] : [`quota unknown (kept): ${unknown.join(", ")}`]), ...(reserveUsed.length === 0 ? [] : [`no member below the reserve; using it: ${reserveUsed.join(", ")}`])]
    stage.snapshot("quota", kept.map(({ candidate }) => candidate), notes.length === 0 ? undefined : notes.join("; "))
    return kept.map(({ candidate }) => candidate)
}

/** How a member scores for the label: expected success (Beta posterior mean, or a Thompson sample) over expected cost. */
const scoreOf = (facts: Facts, input: RouteInput, candidate: Candidate, tier: string, explore: boolean): MemberScore => {
    const { routing } = facts
    const evidence = evidenceOf(facts.evidence, candidate.id, input.label)
    const { alpha, beta } = posteriorOf(routing, evidence)
    const expected = alpha / (alpha + beta)
    const sample = explore ? sampleBeta(alpha, beta, facts.random) : null
    const minutes = evidence.meanMinutes ?? evidenceOf(facts.evidence, candidate.id, "*").meanMinutes ?? routing.scoring.costMinutes
    const cost = (minutes / routing.scoring.costMinutes) * (1 + routing.scoring.paceWeight * Math.max(0, (candidate.pace ?? 1) - 1))
    return {
        member: candidate.id,
        qualification: qualificationIn(facts, input, candidate, tier),
        green: evidence.green,
        red: evidence.red,
        worker: evidence.timeout + evidence.lost + evidence.stalled,
        expected,
        minutes,
        pace: candidate.pace,
        cost,
        score: (sample ?? expected) / cost,
        sample,
    }
}

/** Whether this pick explores: a roll under the share, while explore picks hold less than the share of the tier's recent picks. */
const exploreOf = (facts: Facts, tier: string): ExploreDecision => {
    const sharePercent = facts.routing.scoring.exploreSharePercent
    const recent = facts.recent(tier)
    const recentExplore = recent.filter((pick) => pick.by === "explore").length
    const roll = facts.random()
    const underShare = recent.length === 0 || (recentExplore / recent.length) * 100 < sharePercent
    return { sharePercent, roll, recent: recent.length, recentExplore, exploring: roll * 100 < sharePercent && underShare }
}

/** Why the scored head should yield: picked too often in a row, or holding too much of the tier's running seats; null when it should not. */
const balanceReason = (routing: Routing, head: Candidate, ordered: readonly Candidate[], recent: readonly RecentPick[]): string | null => {
    const streak = recent.findIndex((pick) => pick.member !== head.id)
    const inRow = streak === -1 ? recent.length : streak
    const total = ordered.reduce((sum, candidate) => sum + candidate.runningMember, 0)
    const share = total === 0 ? 0 : (head.runningMember / total) * 100
    if (inRow >= routing.balance.maxStreak) return `${head.id} was picked ${String(inRow)} times in a row`
    if (share > routing.balance.maxSharePercent) return `${head.id} holds ${String(Math.round(share))}% of the tier's running seats`
    return null
}

/** Where the tier came from, for the record. */
const tierSource = (input: RouteInput, labelTier: string | undefined, effective: string, difficulty: string | null, floor: string): string => {
    if (input.coordinator !== undefined) return "coordinators." + input.coordinator
    return labelTier === undefined ? "difficulty " + effective + " (max of " + (difficulty ?? "none") + " and floor " + floor + ")" : "labelTiers." + input.label
}

const newRecord = (input: RouteInput, at: string): RouteRecord => ({
    at,
    label: input.label,
    attempt: input.attempt,
    difficulty: null,
    floor: "easy",
    reds: 0,
    risk: input.risk ?? [],
    highRisk: false,
    tierFrom: "",
    baseTier: "",
    tier: "",
    escalated: false,
    hostTools: {},
    chain: [],
    steps: [],
    dropped: [],
    scores: [],
    explore: null,
    probe: null,
    chosen: null,
})

/** The tier a decision starts in, the record it writes and the stage its steps share. */
const openStage = (input: RouteInput, facts: Facts, at: string): Stage => {
    const { routing } = facts
    const difficulty = input.difficulty === undefined ? null : parseDifficulty(routing, input.difficulty)
    const effective = difficulty !== null && difficultyRank(routing, difficulty) > difficultyRank(routing, facts.floor) ? difficulty : facts.floor
    const labelTier = routing.labelTiers[input.label]
    const baseTier = input.coordinator === undefined ? labelTier ?? routing.difficultyTier[effective] : routing.coordinators[input.coordinator]
    const reds = typeof input.previousRed === "number" ? input.previousRed : redMembers(input.previousRed).length
    const raised = reds >= routing.escalateAfterReds ? routing.tierOrder[routing.tierOrder.indexOf(baseTier) + 1] : undefined
    const risk = input.risk ?? []
    const record: RouteRecord = {
        ...newRecord(input, at),
        difficulty,
        floor: facts.floor,
        reds,
        highRisk: risk.some((tag) => routing.qualification.riskTags.includes(tag)),
        tierFrom: tierSource(input, labelTier, effective, difficulty, facts.floor),
        baseTier,
        tier: raised ?? baseTier,
        escalated: raised !== undefined,
        hostTools: facts.hostTools,
    }
    const stage: Stage = {
        routing,
        record,
        snapshot: (step, kept, note) => {
            record.steps.push({ step, kept: kept.map((candidate) => candidate.id), ...(note === undefined ? {} : { note }) })
        },
        drop: (candidate, step, reason) => {
            record.dropped.push({ member: candidate.id, step, reason })
        },
    }
    if (reds >= routing.escalateAfterReds && raised === undefined) stage.snapshot("tier", facts.candidates(record.tier), `already at the top tier ${record.tier}; ${String(reds)} contract-red attempts escalate no further`)
    return stage
}

/** The hard filter over the tier, moving a high-risk task up while qualification alone empties a tier; returns the survivors and the tier's members. */
const hardStep = (stage: Stage, input: RouteInput, facts: Facts, redsByPool: ReadonlyMap<string, number>): { readonly hard: Candidate[]; readonly candidates: Candidate[] } => {
    const { record, routing } = stage
    for (;;) {
        const candidates = facts.candidates(record.tier)
        record.chain = candidates.map((candidate) => candidate.id)
        const hard = candidates.filter((candidate) => {
            const reason = hardReason(candidate, input, facts, record.tier, record.highRisk, redsByPool)
            if (reason !== null) stage.drop(candidate, reason.step, `${reason.reason} [tier ${record.tier}]`)
            return reason === null
        })
        stage.snapshot("hard-filter", hard, `tier ${record.tier}`)
        const up = routing.tierOrder[routing.tierOrder.indexOf(record.tier) + 1]
        const climbing = hard.length === 0 ? record.dropped.find((row) => (row.step === "qualification" || row.step === "independence") && row.reason.endsWith(`[tier ${record.tier}]`)) : undefined
        if (climbing === undefined || up === undefined) return { hard, candidates }
        const why = climbing.step === "qualification" ? "is qualified for this high-risk task" : "is independent of the work's authors"
        stage.snapshot(climbing.step, [], `no member of tier ${record.tier} ${why}; looking in tier ${up}`)
        record.tier = up
    }
}

/** Orders the members by score (a demoted one after every other), exploring by Thompson sampling when the roll says so. */
const scoreStep = (stage: Stage, input: RouteInput, facts: Facts, members: readonly Candidate[], demoted: readonly Candidate[]): Candidate[] => {
    const { record } = stage
    const explore = exploreOf(facts, record.tier)
    record.explore = explore
    const scores = new Map(members.map((candidate) => [candidate, scoreOf(facts, input, candidate, record.tier, explore.exploring)]))
    record.scores = [...scores.values()]
    const byScore = (a: Candidate, b: Candidate): number => (scores.get(b)?.score ?? 0) - (scores.get(a)?.score ?? 0) || members.indexOf(a) - members.indexOf(b)
    const ordered = [...members.filter((candidate) => !demoted.includes(candidate)).sort(byScore), ...members.filter((candidate) => demoted.includes(candidate)).sort(byScore)]
    stage.snapshot("score", ordered, explore.exploring ? "exploring: ordered by a Thompson sample" : undefined)
    return ordered
}

/** The member the head yields to when it was picked too often in a row or holds too much of the tier; undefined when it keeps the pick. */
const balanceStep = (stage: Stage, facts: Facts, ordered: readonly Candidate[], demoted: readonly Candidate[]): Candidate | undefined => {
    const head = ordered[0]
    if (head === undefined || ordered.length <= 1) return undefined
    const reason = balanceReason(stage.routing, head, ordered, facts.recent(stage.record.tier))
    // Balance never yields to a member the lineage put behind the head.
    const next = ordered.slice(1).find((candidate) => demoted.includes(head) || !demoted.includes(candidate))
    if (reason === null || next === undefined) return undefined
    stage.snapshot("balance", [next, ...ordered.filter((candidate) => candidate !== next)], `${reason}; yields to ${next.id}`)
    return next
}

/** Runs the decision over gathered facts; pure but for its facts (and their random source). */
const decide = (input: RouteInput, facts: Facts, at: string): RoutePick | RouteRefusal => {
    const stage = openStage(input, facts, at)
    const { record, routing } = stage
    const unknownRisk = record.risk.filter((tag) => !routing.qualification.riskTags.includes(tag))
    if (unknownRisk.length > 0) return new RouteRefusal("ROUTE_RISK_UNKNOWN", `risk tags are ${routing.qualification.riskTags.join(", ")}, not ${unknownRisk.join(", ")}`, record)

    // 1. Hard filter: pool, tools, lineage exclusion, circuit (open waits for its probe), capacity, qualification of a high-risk task.
    const redsByPool = new Map<string, number>()
    for (const member of redMembers(input.previousRed)) redsByPool.set(member.agent, (redsByPool.get(member.agent) ?? 0) + 1)
    const { hard, candidates } = hardStep(stage, input, facts, redsByPool)
    if (hard.length === 0) return hardRefusal(stage, input, candidates)

    // 2. Quota.
    const funded = quotaStep(stage, hard)
    if (funded.length === 0) {
        const resetAt = earliest(hard.map((candidate) => candidate.quota.resetsAt))
        return new RouteRefusal("TOKENS_OUT", `every member of tier ${record.tier} is out of quota${resetAt === null ? "" : "; the earliest reset is " + resetAt}: ${droppedText(record, "quota")}`, record, resetAt)
    }

    // 3. Lineage: a pool with one contract-red attempt of this task, or a member of it the stall ladder gave up on, goes behind
    // every other member of a task's tier (a coordinator's keeps its listed order, step 5).
    const stalledPools = new Set((input.stalled ?? []).map((member) => member.agent))
    const demoted = funded.filter((candidate) => (redsByPool.get(candidate.pool) ?? 0) === 1 || stalledPools.has(candidate.pool))
    stage.snapshot("lineage", funded, demoted.length === 0 ? undefined : `demoted after one contract-red or a stall: ${demoted.map((candidate) => candidate.id).join(", ")}`)

    // 4. Probe: a half-open provider gets this one launch (never a high-risk task's), so no provider stays dark past its probe time.
    const probe = funded.find((candidate) => candidate.circuit.open && candidate.circuit.probe === "due")
    record.probe = probe === undefined ? null : `${probe.provider} (${probe.circuit.failureKind ?? "?"}, ${String(probe.circuit.failedProbes)} failed probes)`

    // 5. Score, exploring by Thompson sampling within its share; 6. balance. A coordinator seat takes its tier's members in
    // the order routing.yaml lists them (owner ruling 2026-10-28: Claude first, another agent only when the hard filter or quota
    // took Claude out, its circuit open), so it is neither scored, explored, balanced nor reordered by its lineage: a relaunch
    // after a failed or stalled coordinator launch stays on that order, and the failure reaches it only through the circuit.
    const ordered = input.coordinator === undefined ? scoreStep(stage, input, facts, funded, demoted) : funded
    const balanced = probe === undefined && input.coordinator === undefined ? balanceStep(stage, facts, ordered, demoted) : undefined
    const chosen = probe ?? balanced ?? ordered[0]
    let by = input.coordinator !== undefined ? "order" : record.explore?.exploring === true ? "explore" : "score"
    if (balanced !== undefined) by = "balance"
    if (probe !== undefined) by = "probe"
    if (chosen === undefined) return new RouteRefusal("ROUTE_NO_MEMBER", `no member of tier ${record.tier} is left`, record)
    record.chosen = { member: chosen.id, by }
    return {
        agent: chosen.spec.agent,
        model: chosen.spec.model,
        ...(chosen.spec.effort === undefined ? {} : { effort: chosen.spec.effort }),
        provider: chosen.provider,
        pool: chosen.pool,
        tier: record.tier,
        record,
    }
}

const PICK_RETENTION_DAYS = 7

/**
 * Picks the agent, model and effort of one dispatch: tier = labelTiers[label] ?? difficultyTier[max(difficulty, floor)],
 * raised one step by the second contract-red; then the hard filter (with qualification for a high-risk task), quota, lineage,
 * probe, score (with bounded exploration) and balance steps. A recorded pick first reads Orca's usage when it is stale and the
 * ledgers' ended attempts, and is remembered for balance and exploration (a probe is marked in flight). Returns the pick or a
 * RouteRefusal; never throws for a routing answer.
 */
export const pickRoute = (input: RouteInput, options: { readonly record?: boolean } = {}): RoutePick | RouteRefusal => {
    const at = now()
    const record = options.record !== false
    let decided: RoutePick | RouteRefusal
    try {
        if (record) {
            refreshUsage({}, at)
            recordMemberOutcomes(loadRouting(), at)
        }
        decided = decide(input, gatherFacts(input, at), at)
    } catch (error: unknown) {
        if (error instanceof Refusal) return new RouteRefusal(error.code, error.message, newRecord(input, at))
        throw error
    }
    if (decided instanceof RouteRefusal || !record) return decided
    const pick = decided
    withMachine((db) => {
        db.prepare("INSERT INTO route_picks (at, tier, member, pool, label, chosen_by) VALUES (?, ?, ?, ?, ?, ?)").run(at, pick.tier, memberId(pick), pick.pool, input.label, pick.record.chosen?.by ?? "")
        db.prepare("DELETE FROM route_picks WHERE at < ?").run(new Date(Date.parse(at) - PICK_RETENTION_DAYS * 86_400_000).toISOString())
        if (pick.record.chosen?.by === "probe") recordProbe(db, pick.provider, { member: memberId(pick), label: input.label }, at)
    })
    return pick
}

/** The router input of a coordinator seat: its role is its label and its tier routing.yaml coordinators.<role>, taken in listed order with no lineage. */
export const coordinatorInput = (role: CoordinatorRole): RouteInput => ({ label: role, coordinator: role, attempt: 1 })

/** Routes a coordinator through the shared circuit, capacity, quota, probe, scoring and balance pipeline. */
export const pickCoordinator = (role: CoordinatorRole, options: { readonly record?: boolean } = {}): RoutePick | RouteRefusal =>
    pickRoute(coordinatorInput(role), { record: options.record ?? true })

/** What `simulateRoute` counted over its picks: each member's picks, how many explored and probed, and the refusals. */
export interface RouteSimulation {
    readonly picks: number
    readonly byMember: Readonly<Record<string, number>>
    readonly byReason: Readonly<Record<string, number>>
    readonly refused: Readonly<Record<string, number>>
}

/**
 * Runs `count` decisions over one snapshot of the facts, each remembering the ones before it as recorded picks would (the
 * balance streak, the exploration share, a probe in flight), and records nothing: how the router spreads a run of picks.
 */
export const simulateRoute = (input: RouteInput, count: number): RouteSimulation => {
    const at = now()
    const facts = gatherFacts(input, at)
    const recent = new Map<string, RecentPick[]>()
    const probing = new Set<string>()
    const byMember: Record<string, number> = {}
    const byReason: Record<string, number> = {}
    const refused: Record<string, number> = {}
    const simulated: Facts = { ...facts, probing, recent: (tier) => [...(recent.get(tier) ?? []), ...facts.recent(tier)].slice(0, RECENT_PICKS) }
    for (let index = 0; index < count; index += 1) {
        const answer = decide(input, simulated, at)
        if (answer instanceof RouteRefusal) {
            refused[answer.code] = (refused[answer.code] ?? 0) + 1
            continue
        }
        const by = answer.record.chosen?.by ?? ""
        byMember[memberId(answer)] = (byMember[memberId(answer)] ?? 0) + 1
        byReason[by] = (byReason[by] ?? 0) + 1
        if (by === "probe") probing.add(answer.provider)
        recent.set(answer.tier, [{ member: memberId(answer), by }, ...(recent.get(answer.tier) ?? [])])
    }
    return { picks: count, byMember, byReason, refused }
}

/** Stores a pick on its attempt (attempts.pick_json), so a dispatch of that attempt reuses it and status can show it. */
export const recordPick = (db: DatabaseSync, attemptId: string, pick: RoutePick): void => {
    db.prepare("UPDATE attempts SET pick_json = ? WHERE id = ?").run(JSON.stringify(pick), attemptId)
}

/** A task's lineage as the router reads it: the attempts of the task and the tasks it retries, their contract-red and stalled members, and its risk tags. */
export interface Lineage {
    readonly label: string
    readonly attempts: number
    readonly reds: readonly RouteMember[]
    readonly stalled: readonly RouteMember[]
    readonly risk: readonly string[]
    readonly authors: readonly string[]
}

/**
 * The providers that authored the dependency work an independent label reads: for each dependency task the task was dispatched on
 * (plan_inputs_json) whose label the op names in `independentOf`, the provider of every attempt it ran.
 */
const authorsOf = (db: DatabaseSync, taskId: string, label: string): string[] => {
    const labels = loadOps().labels[label]?.independentOf ?? []
    if (labels.length === 0) return []
    const inputs: unknown = JSON.parse(textOf(db.prepare("SELECT plan_inputs_json FROM tasks WHERE id = ?").get(taskId)?.plan_inputs_json) ?? "{}")
    const deps = Object.values(typeof inputs === "object" && inputs !== null ? inputs : {}).filter((id): id is string => typeof id === "string")
    const routing = loadRouting()
    const authors = new Set<string>()
    for (const dep of deps) {
        const row = db.prepare("SELECT label FROM tasks WHERE id = ?").get(dep)
        if (!labels.includes(textOf(row?.label) ?? "")) continue
        for (const attempt of db.prepare("SELECT agent FROM attempts WHERE task_id = ? AND agent IS NOT NULL").all(dep)) authors.add(providerOfAgent(routing, textOf(attempt.agent) ?? ""))
    }
    return [...authors].sort((a, b) => a.localeCompare(b))
}

/** The risk tags of a workflow task: its plan node's route in the workflow's current graph; none for a task outside a workflow. */
const riskOf = (db: DatabaseSync, taskId: string): string[] => {
    const row = db
        .prepare("SELECT p.route_json FROM tasks t JOIN workflows w ON w.id = t.workflow_id JOIN plan_nodes p ON p.workflow_id = w.id AND p.graph_version = w.graph_version AND p.plan_key = t.plan_key WHERE t.id = ?")
        .get(taskId)
    const route: unknown = row === undefined ? null : JSON.parse(textOf(row.route_json) ?? "null")
    const risk = typeof route === "object" && route !== null && "risk" in route ? route.risk : undefined
    return Array.isArray(risk) ? risk.filter((tag): tag is string => typeof tag === "string") : []
}

/** The attempt outcomes whose member a retry puts behind every other: given up by the stall ladder, fenced over its budget, or a worker that never started (blocked at a prompt among them). */
const STALLED_OUTCOMES: ReadonlySet<string> = new Set(["stalled", "launch-failed", "blocked-prompt", "over-budget"])

/** Walks a task's retry chain in its ledger; every attempt but a consumer-fenced one counts toward the attempt number, every red verdict is a red, every stalled or failed start a stall. */
export const lineageOf = (db: DatabaseSync, taskId: string): Lineage => {
    const task = getTask(db, taskId)
    const reds: RouteMember[] = []
    const stalled: RouteMember[] = []
    let attempts = 0
    const seen = new Set<string>()
    let current: string | null = task.id
    while (current !== null && !seen.has(current)) {
        seen.add(current)
        for (const row of db.prepare("SELECT agent, model, verdict, outcome FROM attempts WHERE task_id = ? ORDER BY seq").all(current)) {
            // A launch Orca fenced was the harness's error: its attempt never ran and is no step of the lineage.
            if (textOf(row.outcome) === CONSUMER_FENCED_OUTCOME) continue
            attempts += 1
            const agent = textOf(row.agent)
            const model = textOf(row.model)
            if (textOf(row.verdict) === "red" && agent !== null && model !== null) reds.push({ agent, model })
            if (STALLED_OUTCOMES.has(textOf(row.outcome) ?? "") &&agent !== null && model !== null) stalled.push({ agent, model })
        }
        current = getTask(db, current).retryOf
    }
    return { label: task.label, attempts, reds, stalled, risk: task.workflowId === null ? [] : riskOf(db, task.id), authors: authorsOf(db, task.id, task.label) }
}

/** Routes the next attempt of a queued task from its ledger: its label, attempt number, contract-red lineage and risk. */
export const routeTask = (root: string, taskId: string, options: { readonly record?: boolean } = {}): RoutePick | Refusal => {
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
    return pickRoute({ label: lineage.label, attempt: lineage.attempts + 1, previousRed: lineage.reds, stalled: lineage.stalled, risk: lineage.risk, authors: lineage.authors }, { record: options.record ?? true })
}

const fixed = (value: number): string => value.toFixed(2)

/** The scoring of one member as text. */
const scoreLine = (score: MemberScore): string =>
    `  score ${score.member}: ${score.qualification}, green ${String(score.green)} red ${String(score.red)} worker-failed ${String(score.worker)}, expected ${fixed(score.expected)}` +
    `${score.sample === null ? "" : " (sample " + fixed(score.sample) + ")"}, cost ${fixed(score.cost)} (${fixed(score.minutes)} min, pace ${score.pace === null ? "unknown" : fixed(score.pace)}) -> ${fixed(score.score)}`

/** The exploration decision as text. */
const exploreLine = (explore: ExploreDecision | null): string[] =>
    explore === null
        ? []
        : [`explore: roll ${fixed(explore.roll * 100)} vs share ${String(explore.sharePercent)}%, explore picks ${String(explore.recentExplore)} of the last ${String(explore.recent)} -> ${explore.exploring ? "explore" : "exploit"}`]

/** The decision path as text lines, for route explain and dry runs. */
export const describeRoute = (answer: RoutePick | RouteRefusal): string[] => {
    const record = answer.record
    const escalated = record.escalated ? " (escalated from " + record.baseTier + " after " + String(record.reds) + " contract-red)" : ""
    const tools = Object.entries(record.hostTools)
        .map(([tool, ok]) => tool + " " + (ok ? "ok" : "missing"))
        .join(", ")
    const highRisk = record.highRisk ? " (high-risk)" : ""
    const risk = record.risk.length === 0 ? "none" : record.risk.join(", ") + highRisk
    const lines = [
        `label ${record.label}, attempt ${String(record.attempt)}, difficulty ${record.difficulty ?? "-"}, floor ${record.floor}, contract-red ${String(record.reds)}, risk ${risk}`,
        `tier ${record.tier}${escalated} from ${record.tierFrom}`,
        `chain: ${record.chain.join(" > ") || "-"}`,
        ...(Object.keys(record.hostTools).length === 0 ? [] : [`host tools: ${tools}`]),
        ...record.steps.map((step) => `  ${step.step}: ${step.kept.join(" > ") || "(none)"}${step.note === undefined ? "" : "  [" + step.note + "]"}`),
        ...record.dropped.map((row) => `  dropped ${row.member} at ${row.step}: ${row.reason}`),
        `probe: ${record.probe === null ? "none due" : record.probe + " is half-open; this pick is its one probe"}`,
        ...exploreLine(record.explore),
        ...record.scores.map(scoreLine),
    ]
    if (answer instanceof RouteRefusal) return [...lines, `refused ${answer.code}: ${answer.message}`]
    const effort = answer.effort === undefined ? "" : " (effort " + answer.effort + ")"
    return [...lines, `chosen ${answer.agent} ${answer.model}${effort} by ${record.chosen?.by ?? "?"}; pool ${answer.pool}, provider ${answer.provider}`]
}
