import type { AttemptError } from "./attempt.ts"
import { windowEnd } from "./classify.ts"
import { DEFAULT_CAPABILITIES, identityOf, modelMatches } from "./config.ts"
import type { BreakerSettings, ResolvedPolicy, Settings } from "./config.ts"
import type { Emitter } from "./events.ts"
import type { RateLimitInfo } from "./headers.ts"
import { presetOf } from "./providers.ts"
import { fingerprintOf, resolveSecret } from "./secrets.ts"
import { EMPTY_RECORD, toHealthRecord } from "./store.ts"
import type { HealthRecord, StateStore } from "./store.ts"
import type {
    BreakerState,
    Capability,
    DisabledReason,
    ErrorClass,
    HealthSnapshot,
    KeyConfig,
    LaneStats,
    ModelConfig,
    ProviderConfig,
    ResetTarget,
    StatsSnapshot,
    Usage,
} from "./types.ts"

/** One routable (provider, key, model) triple, the rank of its tier in the call's policy and its weight there. */
export interface Lane {
    readonly provider: ProviderConfig
    readonly key: KeyConfig
    readonly model: ModelConfig
    readonly rank: number
    /** The candidate's weight in its tier (1 for a model named by `model` or `fallbacks`). */
    readonly weight: number
    /** `provider/key/model`, the lane's name in local counters. */
    readonly id: string
    /** `provider/key`, the pair a retry moves away from. */
    readonly pair: string
}

/** What one call needs from a lane. */
export interface Need {
    readonly capabilities: readonly Capability[]
    /** An estimate of the prompt's tokens (four characters a token). */
    readonly promptTokens: number
    /** `max_tokens` or `max_completion_tokens`, 0 when unbounded. */
    readonly outputTokens: number
    /** True keeps every lane on the first lane's model identity (an embeddings call, a pinned profile). */
    readonly oneIdentity: boolean
    /** The vector length an embeddings call asked for; a model declared at another is no candidate. */
    readonly dimensions: number | null
}

/** What a call has tried so far: lanes, key pairs and providers. */
export interface Tried {
    readonly lanes: ReadonlySet<string>
    readonly pairs: ReadonlySet<string>
    readonly providers: ReadonlySet<string>
}

/** A lane picked for an attempt, with the probe leases it holds while a breaker is half-open. */
export interface Pick {
    readonly lane: Lane
    readonly leases: readonly string[]
}

/** Why the lanes that are out are out, when every one of them is out for its key or its provider's budget. */
export interface Blacklisted {
    /** `quota` when any lane is out for a spent quota or budget, else `auth` (a refused or missing secret). */
    readonly reason: "quota" | "auth"
    /** The aliases, `provider/key`, that are blacklisted, and the providers past their budget. */
    readonly keys: readonly string[]
    readonly budgets: readonly string[]
}

/** No lane is usable now: `waitUntil` is when the earliest one may be (Infinity: never within reach). */
export interface Blocked {
    readonly waitUntil: number
    /** True when a lane waits only on in-process concurrency or a probe another attempt holds. */
    readonly busy: boolean
    /** Set when every lane is out because its key is blacklisted or its provider's budget is spent. */
    readonly blacklisted: Blacklisted | null
}

const FOREVER = Number.MAX_SAFE_INTEGER
/** The latency samples a lane needs before its EWMA ranks it: one cold call (a JIT warm-up, a first TLS handshake) never decides. */
const LATENCY_SAMPLES = 3
/** How far a lane latency leaves out drifts toward the best EWMA per pick: a 2.5x-slow lane is retried about every tenth pick. */
const LATENCY_DRIFT = 0.1

interface LaneCounters {
    attempts: number
    successes: number
    failures: Partial<Record<ErrorClass, number>>
    promptTokens: number
    completionTokens: number
    cost: number
}

/** Why a lane is out: its key is blacklisted, its provider's budget is spent, or something that clears soon. */
type Block = "blacklist-quota" | "blacklist-auth" | "budget" | "soon"

interface Status {
    readonly usable: boolean
    readonly until: number
    readonly low: boolean
    readonly probes: readonly string[]
    readonly block: Block | null
}

function breakerState(record: HealthRecord, now: number): BreakerState {
    if (record.breaker === "closed") return "closed"
    return record.openUntil > now ? "open" : "half-open"
}

/** The cost of a usage on a model, or undefined when the model has no cost or the provider reported no usage. */
export function costOf(model: ModelConfig, usage: Usage | undefined): number | undefined {
    if (model.cost === undefined || usage === undefined) return undefined
    const completion = usage.completion_tokens ?? 0
    return (usage.prompt_tokens * model.cost.input + completion * model.cost.output) / 1_000_000
}

/** The UTC day (`YYYY-MM-DD`) and month (`YYYY-MM`) of a time. */
function periods(now: number): { day: string; month: string } {
    const day = new Date(now).toISOString().slice(0, 10)
    return { day, month: day.slice(0, 7) }
}

/** When a provider past its budget is a candidate again: the next UTC day or month, or 0 when it is within it. */
function budgetUntil(provider: ProviderConfig, record: HealthRecord, now: number): number {
    const budget = provider.budget
    if (budget === undefined) return 0
    const { day, month } = periods(now)
    const date = new Date(now)
    let until = 0
    if (budget.costPerMonth !== undefined && record.spendMonth === month && record.spendMonthCost >= budget.costPerMonth) until = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    else if (budget.costPerDay !== undefined && record.spendDay === day && record.spendDayCost >= budget.costPerDay) until = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
    return until
}

/**
 * The pool's state: shared breaker, blacklist, headroom and budget records in the store; in-flight counts, latency
 * EWMAs and round-robin weights in this process. It answers which lane an attempt takes and records how the attempt ended.
 */
export class PoolState {
    readonly #providers: readonly ProviderConfig[]
    readonly #settings: Settings
    readonly #store: StateStore
    readonly #emitter: Emitter
    readonly #inflightKey = new Map<string, number>()
    readonly #inflightProvider = new Map<string, number>()
    readonly #ewma = new Map<string, number>()
    readonly #samples = new Map<string, number>()
    readonly #roundRobin = new Map<string, number>()
    readonly #counters = new Map<string, LaneCounters>()
    readonly #waiters = new Set<() => void>()
    readonly totals = { requests: 0, succeeded: 0, failed: 0, attempts: 0 }

    /** Binds the state to a pool's providers, settings, store and emitter. */
    constructor(providers: readonly ProviderConfig[], settings: Settings, store: StateStore, emitter: Emitter) {
        this.#providers = providers
        this.#settings = settings
        this.#store = store
        this.#emitter = emitter
    }

    #keyId(provider: string, alias: string): string {
        return `${this.#settings.namespace}:key:${provider}/${alias}`
    }

    #providerId(provider: string): string {
        return `${this.#settings.namespace}:provider:${provider}`
    }

    #laneId(provider: string, alias: string, model: string): string {
        return `${this.#settings.namespace}:lane:${provider}/${alias}/${model}`
    }

    async #read(id: string): Promise<HealthRecord> {
        // A record an older version or another adapter wrote is read field by field, its missing fields empty.
        const stored = await this.#store.get(id)
        return stored === undefined ? EMPTY_RECORD : (toHealthRecord(stored) ?? EMPTY_RECORD)
    }

    /**
     * Every lane that serves one of the policy's candidates with the capabilities, context window and budget the call
     * needs, tier by tier. With `need.oneIdentity`, a lane whose model identity differs from the first lane's is left out.
     */
    lanes(policy: ResolvedPolicy, need: Need): Lane[] {
        const lanes: Lane[] = []
        let identity: string | undefined
        policy.tiers.forEach((tier, rank) => {
            for (const ref of tier) {
                for (const provider of this.#providers) {
                    if (policy.providers !== null && !policy.providers.has(provider.id)) continue
                    if (ref.provider !== null && ref.provider !== provider.id) continue
                    for (const model of provider.models) {
                        if (!modelMatches(model, ref.model)) continue
                        const capabilities = model.capabilities ?? DEFAULT_CAPABILITIES
                        if (!need.capabilities.every((capability) => capabilities.includes(capability))) continue
                        if (model.contextWindow !== undefined && need.promptTokens + need.outputTokens > model.contextWindow) continue
                        if (policy.maxCost !== null && model.cost !== undefined) {
                            const worst = (need.promptTokens * model.cost.input + need.outputTokens * model.cost.output) / 1_000_000
                            if (worst > policy.maxCost) continue
                        }
                        if (need.dimensions !== null && model.dimensions !== undefined && model.dimensions !== need.dimensions) continue
                        if (need.oneIdentity) {
                            identity ??= identityOf(model)
                            if (identityOf(model) !== identity) continue
                        }
                        for (const key of provider.keys) {
                            const id = `${provider.id}/${key.alias}/${model.id}`
                            if (lanes.some((lane) => lane.id === id)) continue
                            lanes.push({ provider, key, model, rank, weight: ref.weight, id, pair: `${provider.id}/${key.alias}` })
                        }
                    }
                }
            }
        })
        return lanes
    }

    async #status(lane: Lane, need: Need, now: number): Promise<Status> {
        const [key, provider, headroom] = await Promise.all([
            this.#read(this.#keyId(lane.provider.id, lane.key.alias)),
            this.#read(this.#providerId(lane.provider.id)),
            this.#read(this.#laneId(lane.provider.id, lane.key.alias, lane.model.id)),
        ])
        const blocks: number[] = []
        let block: Block | null = null
        if (key.disabledUntil > now) {
            blocks.push(key.disabledUntil >= FOREVER ? Infinity : key.disabledUntil)
            block = key.disabledReason === "quota" ? "blacklist-quota" : "blacklist-auth"
        }
        const budget = budgetUntil(lane.provider, provider, now)
        if (budget > now) {
            blocks.push(budget)
            block ??= "budget"
        }
        const soon = blocks.length
        const probes: string[] = []
        const breakers: { record: HealthRecord; id: string }[] = [
            { record: key, id: this.#keyId(lane.provider.id, lane.key.alias) },
            { record: provider, id: this.#providerId(lane.provider.id) },
        ]
        for (const { record, id } of breakers) {
            const state = breakerState(record, now)
            if (state === "open") blocks.push(record.openUntil)
            if (state === "half-open") probes.push(`${id}:probe`)
        }
        if (headroom.cooldownUntil > now) blocks.push(headroom.cooldownUntil)
        if (headroom.remainingRequests === 0 && headroom.requestsResetAt > now) blocks.push(headroom.requestsResetAt)
        if (headroom.remainingTokens !== null && headroom.remainingTokens < need.promptTokens + need.outputTokens && headroom.tokensResetAt > now) {
            blocks.push(headroom.tokensResetAt)
        }
        if (block === null && blocks.length > soon) block = "soon"
        if (blocks.length > 0) return { usable: false, until: Math.max(...blocks), low: false, probes, block }
        const low = headroom.remainingRequests !== null && headroom.remainingRequests <= this.#settings.lowHeadroom && headroom.requestsResetAt > now
        return { usable: true, until: now, low, probes, block: null }
    }

    /**
     * Lifts the blacklist of every key among the lanes whose secret changed since it was blacklisted (a missing secret
     * that is now set counts): a new secret is a new key, and deserves a try at once.
     */
    async #restore(lanes: readonly Lane[], now: number): Promise<void> {
        const seen = new Set<string>()
        for (const lane of lanes) {
            if (seen.has(lane.pair)) continue
            seen.add(lane.pair)
            const id = this.#keyId(lane.provider.id, lane.key.alias)
            const record = await this.#read(id)
            if (record.disabledUntil <= now || record.disabledReason === null || record.fingerprint === null) continue
            if (fingerprintOf(await resolveSecret(lane.key)) === record.fingerprint) continue
            await this.#store.set(id, { ...record, disabledUntil: 0, disabledReason: null, disabledCode: null, fingerprint: null })
            this.#emitter.emit("key-restored", { type: "key-restored", provider: lane.provider.id, key: lane.key.alias, was: record.disabledReason, reason: "secret_changed" })
        }
    }

    #busy(lane: Lane): boolean {
        return (
            (this.#inflightKey.get(lane.pair) ?? 0) >= (lane.key.maxConcurrency ?? Infinity) ||
            (this.#inflightProvider.get(lane.provider.id) ?? 0) >= (lane.provider.maxConcurrency ?? Infinity)
        )
    }

    #hold(lane: Lane, delta: 1 | -1): void {
        this.#inflightKey.set(lane.pair, Math.max(0, (this.#inflightKey.get(lane.pair) ?? 0) + delta))
        this.#inflightProvider.set(lane.provider.id, Math.max(0, (this.#inflightProvider.get(lane.provider.id) ?? 0) + delta))
    }

    /**
     * Picks the lane for the next attempt and holds its in-flight slot. Tiers, in order: a lane not yet tried by this
     * call, the policy's candidate order, a key not yet tried, a provider not yet tried, enough headroom. So a retry
     * moves to another key or provider of the same model first, then to the next tier, and only then back to a tried
     * lane. Within the first non-empty tier: the fewest in-flight requests, then latency within the tolerance of the
     * best EWMA, then smooth weighted round-robin. The concurrency check and the hold run without an await between
     * them, so concurrent calls never overshoot a cap.
     */
    async pick(lanes: readonly Lane[], need: Need, tried: Tried, leaseMs: number): Promise<Pick | Blocked> {
        const now = Date.now()
        await this.#restore(lanes, now)
        const statuses = await Promise.all(lanes.map((lane) => this.#status(lane, need, now)))
        let usable: { lane: Lane; status: Status; tier: number[] }[] = []
        let waitUntil = Infinity
        const out = { keys: new Set<string>(), budgets: new Set<string>(), quota: false, other: false }
        lanes.forEach((lane, index) => {
            const status = statuses[index]
            if (status === undefined) return
            if (!status.usable) {
                waitUntil = Math.min(waitUntil, status.until)
                if (status.block === "blacklist-quota" || status.block === "blacklist-auth") out.keys.add(lane.pair)
                if (status.block === "budget") out.budgets.add(lane.provider.id)
                if (status.block === "blacklist-quota" || status.block === "budget") out.quota = true
                if (status.block === "soon") out.other = true
                return
            }
            const tier = [
                tried.lanes.has(lane.id) ? 1 : 0,
                lane.rank,
                tried.pairs.has(lane.pair) ? 1 : 0,
                tried.providers.has(lane.provider.id) ? 1 : 0,
                status.low ? 1 : 0,
            ]
            usable.push({ lane, status, tier })
        })
        usable.sort((a, b) => compareTiers(a.tier, b.tier))
        let busy = false
        const anyUsable = usable.length > 0
        for (;;) {
            const free = usable.filter((entry) => !this.#busy(entry.lane))
            if (free.length < usable.length) busy = true
            const first = free[0]
            if (first === undefined) break
            const group = free.filter((entry) => compareTiers(entry.tier, first.tier) === 0)
            const chosen = this.#choose(group.map((entry) => entry.lane))
            const entry = group.find((candidate) => candidate.lane === chosen) ?? first
            this.#hold(entry.lane, 1)
            const leases: string[] = []
            let held = true
            for (const lease of entry.status.probes) {
                if (await this.#store.lease(lease, leaseMs)) leases.push(lease)
                else held = false
            }
            if (held) return { lane: entry.lane, leases }
            for (const lease of leases) await this.#store.release(lease)
            this.#hold(entry.lane, -1)
            busy = true
            usable = usable.filter((candidate) => candidate !== entry)
        }
        const reason: Blacklisted["reason"] = out.quota ? "quota" : "auth"
        const blacklisted = !anyUsable && !out.other && (out.keys.size > 0 || out.budgets.size > 0) ? { reason, keys: [...out.keys], budgets: [...out.budgets] } : null
        return { waitUntil: busy ? Math.min(waitUntil, now) : waitUntil, busy, blacklisted }
    }

    #choose(group: readonly Lane[]): Lane | undefined {
        const load = (lane: Lane): number => this.#inflightKey.get(lane.pair) ?? 0
        const least = Math.min(...group.map(load))
        let pool = group.filter((lane) => load(lane) === least)
        // Latency ranks only lanes with LATENCY_SAMPLES samples, so one cold call never decides; a lane it leaves out drifts
        // toward the best EWMA each time, so it is tried again instead of losing its turn for good on samples it can no longer add.
        const measured = (lane: Lane): number | undefined => ((this.#samples.get(lane.id) ?? 0) >= LATENCY_SAMPLES ? this.#ewma.get(lane.id) : undefined)
        const known = pool.map(measured).filter((value): value is number => value !== undefined)
        if (known.length > 0) {
            const best = Math.min(...known)
            const limit = best * this.#settings.latencyTolerance + this.#settings.latencySlackMs
            const fast = pool.filter((lane) => (measured(lane) ?? best) <= limit)
            for (const lane of pool) if (!fast.includes(lane)) this.#ewma.set(lane.id, LATENCY_DRIFT * best + (1 - LATENCY_DRIFT) * (this.#ewma.get(lane.id) ?? best))
            pool = fast
        }
        // Smooth weighted round-robin (nginx): each lane gains its weight, the leader is picked and pays the total.
        let total = 0
        let best: Lane | undefined
        let bestWeight = -Infinity
        for (const lane of pool) {
            const weight = (lane.provider.weight ?? 1) * (lane.key.weight ?? 1) * (lane.model.weight ?? 1) * lane.weight
            total += weight
            const current = (this.#roundRobin.get(lane.id) ?? 0) + weight
            this.#roundRobin.set(lane.id, current)
            if (current > bestWeight) {
                bestWeight = current
                best = lane
            }
        }
        if (best !== undefined) this.#roundRobin.set(best.id, bestWeight - total)
        return best
    }

    /** Counts an attempt on its lane (the in-flight slot is already held by `pick`). */
    count(lane: Lane): void {
        this.totals.attempts++
        this.#count(lane).attempts++
    }

    /** Ends an in-flight attempt, frees its probe leases and wakes every call waiting for capacity. */
    async release(lane: Lane, leases: readonly string[]): Promise<void> {
        this.#hold(lane, -1)
        for (const lease of leases) await this.#store.release(lease)
        for (const wake of [...this.#waiters]) wake()
    }

    /** Resolves on the next release or after `ms`, whichever comes first, or rejects when the signal aborts. */
    waitForCapacity(ms: number, signal: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const done = (): void => {
                clearTimeout(timer)
                this.#waiters.delete(done)
                signal.removeEventListener("abort", aborted)
                resolve()
            }
            const aborted = (): void => {
                clearTimeout(timer)
                this.#waiters.delete(done)
                reject(new Error("aborted"))
            }
            const timer = setTimeout(done, Math.max(0, ms))
            if (signal.aborted) {
                aborted()
                return
            }
            this.#waiters.add(done)
            signal.addEventListener("abort", aborted, { once: true })
        })
    }

    #count(lane: Lane): LaneCounters {
        let counters = this.#counters.get(lane.id)
        if (counters === undefined) {
            counters = { attempts: 0, successes: 0, failures: {}, promptTokens: 0, completionTokens: 0, cost: 0 }
            this.#counters.set(lane.id, counters)
        }
        return counters
    }

    async #headroom(lane: Lane, info: RateLimitInfo | null, cooldownUntil: number): Promise<void> {
        const id = this.#laneId(lane.provider.id, lane.key.alias, lane.model.id)
        const current = await this.#read(id)
        const known = info !== null && (info.remainingRequests !== null || info.remainingTokens !== null)
        if (!known && cooldownUntil === current.cooldownUntil) return
        await this.#store.set(id, {
            ...current,
            remainingRequests: info?.remainingRequests ?? current.remainingRequests,
            requestsResetAt: info !== null && info.remainingRequests !== null ? info.requestsResetAt : current.requestsResetAt,
            remainingTokens: info?.remainingTokens ?? current.remainingTokens,
            tokensResetAt: info !== null && info.remainingTokens !== null ? info.tokensResetAt : current.tokensResetAt,
            cooldownUntil,
        })
    }

    async #breakerSuccess(id: string, scope: "key" | "provider", lane: Lane, now: number): Promise<void> {
        const record = await this.#read(id)
        if (record.breaker === "closed" && record.failures === 0) return
        await this.#store.set(id, { ...record, breaker: "closed", failures: 0, openUntil: 0, cooldownMs: 0 })
        if (record.breaker === "open") this.#emitBreaker(scope, lane, breakerState(record, now), "closed")
    }

    async #breakerFailure(id: string, scope: "key" | "provider", lane: Lane, settings: BreakerSettings, now: number, retryAt: number): Promise<void> {
        const record = await this.#read(id)
        const from = breakerState(record, now)
        const failures = record.failures + 1
        if (from === "open") {
            await this.#store.set(id, { ...record, failures })
            return
        }
        const opens = from === "half-open" || failures >= settings.failureThreshold
        if (!opens) {
            await this.#store.set(id, { ...record, failures })
            return
        }
        const cooldownMs = from === "half-open" ? Math.min(settings.maxCooldownMs, Math.max(record.cooldownMs, settings.cooldownMs) * 2) : settings.cooldownMs
        await this.#store.set(id, { ...record, breaker: "open", failures, cooldownMs, openUntil: Math.max(now + cooldownMs, retryAt) })
        this.#emitBreaker(scope, lane, from, "open")
    }

    #emitBreaker(scope: "key" | "provider", lane: Lane, from: BreakerState, to: BreakerState): void {
        this.#emitter.emit("breaker", {
            type: "breaker",
            scope,
            provider: lane.provider.id,
            ...(scope === "key" ? { key: lane.key.alias } : {}),
            from,
            to,
        })
    }

    async #spend(lane: Lane, cost: number | undefined, now: number): Promise<void> {
        if (lane.provider.budget === undefined || cost === undefined || cost <= 0) return
        const id = this.#providerId(lane.provider.id)
        const record = await this.#read(id)
        const { day, month } = periods(now)
        await this.#store.set(id, {
            ...record,
            spendDay: day,
            spendDayCost: (record.spendDay === day ? record.spendDayCost : 0) + cost,
            spendMonth: month,
            spendMonthCost: (record.spendMonth === month ? record.spendMonthCost : 0) + cost,
        })
    }

    /** Records a success: closes the lane's breakers, stores its headroom and spend, and feeds its latency EWMA. */
    async succeeded(lane: Lane, info: RateLimitInfo | null, latencyMs: number, usage: Usage | undefined): Promise<number | undefined> {
        const now = Date.now()
        await this.#breakerSuccess(this.#keyId(lane.provider.id, lane.key.alias), "key", lane, now)
        await this.#breakerSuccess(this.#providerId(lane.provider.id), "provider", lane, now)
        await this.#headroom(lane, info, 0)
        const previous = this.#ewma.get(lane.id)
        const alpha = this.#settings.ewmaAlpha
        this.#ewma.set(lane.id, previous === undefined ? latencyMs : alpha * latencyMs + (1 - alpha) * previous)
        this.#samples.set(lane.id, (this.#samples.get(lane.id) ?? 0) + 1)
        const counters = this.#count(lane)
        counters.successes++
        const cost = costOf(lane.model, usage)
        counters.promptTokens += usage?.prompt_tokens ?? 0
        counters.completionTokens += usage?.completion_tokens ?? 0
        counters.cost += cost ?? 0
        await this.#spend(lane, cost, now)
        return cost
    }

    /** Blacklists a key: until a time, or (FOREVER) until its secret changes, and says so on `key-disabled`. */
    async #blacklist(lane: Lane, reason: DisabledReason, until: number, fingerprint: string, code: string | undefined): Promise<void> {
        const id = this.#keyId(lane.provider.id, lane.key.alias)
        const record = await this.#read(id)
        await this.#store.set(id, { ...record, disabledUntil: until, disabledReason: reason, disabledCode: code ?? null, fingerprint })
        this.#emitter.emit("key-disabled", {
            type: "key-disabled",
            provider: lane.provider.id,
            key: lane.key.alias,
            reason,
            until: until >= FOREVER ? null : until,
            ...(code === undefined ? {} : { code }),
        })
    }

    /**
     * Records a failure by class: a 429 cools the lane down (retry-after or the default); a spent quota blacklists the
     * key until its window ends (the provider's, a retry-after, else `quotaBlacklistMs`) or its secret changes; a
     * refused or missing secret blacklists it until the secret changes (or `authDisableMs`); a transient failure counts
     * toward the key's and the provider's breakers (honouring retry-after). Any other class touches no shared state.
     * `secret` is the value the attempt sent, kept only as its fingerprint.
     */
    async failed(lane: Lane, error: AttemptError, secret: string | undefined): Promise<void> {
        const now = Date.now()
        const counters = this.#count(lane)
        const errorClass = error.errorClass
        counters.failures[errorClass] = (counters.failures[errorClass] ?? 0) + 1
        const info = error.info
        const retryAt = info?.retryAt ?? 0
        if (errorClass === "rate_limit") {
            await this.#headroom(lane, info, retryAt > now ? retryAt : now + this.#settings.rateLimitCooldownMs)
            return
        }
        if (errorClass === "quota") {
            // The provider's window, else its request-limit reset (Groq's daily requests), else the pool's TTL; a later retry-after wins.
            const reset = info !== null && info.remainingRequests === 0 && info.requestsResetAt > now ? info.requestsResetAt : now + this.#settings.quotaBlacklistMs
            const window = error.window === undefined ? reset : windowEnd(error.window, now)
            await this.#blacklist(lane, "quota", Math.max(window, retryAt), fingerprintOf(secret), error.code)
            return
        }
        if (errorClass === "auth") {
            const until = this.#settings.authDisableMs === null ? FOREVER : now + this.#settings.authDisableMs
            await this.#blacklist(lane, error.missingKey ? "missing" : "auth", until, fingerprintOf(error.missingKey ? undefined : secret), error.code)
            return
        }
        if (errorClass === "transient" || errorClass === "timeout" || errorClass === "network" || errorClass === "stream") {
            await this.#breakerFailure(this.#keyId(lane.provider.id, lane.key.alias), "key", lane, this.#settings.keyBreaker, now, retryAt)
            await this.#breakerFailure(this.#providerId(lane.provider.id), "provider", lane, this.#settings.providerBreaker, now, retryAt)
            if (retryAt > now) await this.#headroom(lane, info, retryAt)
        }
    }

    /** Reads every record into a health snapshot. */
    async health(): Promise<HealthSnapshot> {
        const now = Date.now()
        const providers = await Promise.all(
            this.#providers.map(async (provider) => {
                const record = await this.#read(this.#providerId(provider.id))
                const keys = await Promise.all(
                    provider.keys.map(async (key) => {
                        const keyRecord = await this.#read(this.#keyId(provider.id, key.alias))
                        const models = await Promise.all(
                            provider.models.map(async (model) => {
                                const lane = await this.#read(this.#laneId(provider.id, key.alias, model.id))
                                return {
                                    model: model.id,
                                    remainingRequests: lane.remainingRequests,
                                    remainingTokens: lane.remainingTokens,
                                    cooldownUntil: lane.cooldownUntil > now ? lane.cooldownUntil : 0,
                                    latencyEwmaMs: this.#ewma.get(`${provider.id}/${key.alias}/${model.id}`) ?? null,
                                }
                            }),
                        )
                        const disabled = keyRecord.disabledUntil > now
                        return {
                            alias: key.alias,
                            breaker: breakerState(keyRecord, now),
                            failures: keyRecord.failures,
                            disabled,
                            disabledReason: disabled ? keyRecord.disabledReason : null,
                            disabledUntil: disabled && keyRecord.disabledUntil < FOREVER ? keyRecord.disabledUntil : null,
                            inflight: this.#inflightKey.get(`${provider.id}/${key.alias}`) ?? 0,
                            models,
                        }
                    }),
                )
                const { day, month } = periods(now)
                const spend = provider.budget === undefined ? {} : { spend: { day: record.spendDay === day ? record.spendDayCost : 0, month: record.spendMonth === month ? record.spendMonthCost : 0 } }
                return { id: provider.id, kind: presetOf(provider).kind, breaker: breakerState(record, now), failures: record.failures, inflight: this.#inflightProvider.get(provider.id) ?? 0, ...spend, keys }
            }),
        )
        return { at: now, providers }
    }

    /** Returns this process's counters. */
    stats(): StatsSnapshot {
        const lanes: LaneStats[] = []
        for (const [id, counters] of this.#counters) {
            const [provider = "", key = "", ...model] = id.split("/")
            lanes.push({ provider, key, model: model.join("/"), ...counters, failures: { ...counters.failures } })
        }
        return { ...this.totals, lanes }
    }

    /** Deletes the records of the target and forgets its local latency and round-robin state. */
    async reset(target: ResetTarget): Promise<void> {
        const ns = this.#settings.namespace
        const prefixes: string[] = []
        if (target.provider === undefined) prefixes.push(`${ns}:`)
        else if (target.key === undefined) prefixes.push(`${ns}:provider:${target.provider}`, `${ns}:key:${target.provider}/`, `${ns}:lane:${target.provider}/`)
        else prefixes.push(`${ns}:key:${target.provider}/${target.key}`, `${ns}:lane:${target.provider}/${target.key}/`)
        for (const prefix of prefixes) {
            for (const id of await this.#store.keys(prefix)) {
                if (prefix.endsWith("/") || prefix.endsWith(":") || id === prefix) await this.#store.delete(id)
            }
        }
        const local = target.provider === undefined ? "" : target.key === undefined ? `${target.provider}/` : `${target.provider}/${target.key}/`
        for (const map of [this.#ewma, this.#samples, this.#roundRobin]) {
            for (const id of [...map.keys()]) if (id.startsWith(local)) map.delete(id)
        }
    }
}

function compareTiers(a: readonly number[], b: readonly number[]): number {
    for (let index = 0; index < a.length; index++) {
        const diff = (a[index] ?? 0) - (b[index] ?? 0)
        if (diff !== 0) return diff
    }
    return 0
}
