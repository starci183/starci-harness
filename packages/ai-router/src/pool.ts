import { DEFAULT_CAPABILITIES, modelMatches } from "./config.ts"
import type { BreakerSettings, ResolvedPolicy, Settings } from "./config.ts"
import type { Emitter } from "./events.ts"
import type { RateLimitInfo } from "./headers.ts"
import { EMPTY_RECORD } from "./store.ts"
import type { HealthRecord, StateStore } from "./store.ts"
import type {
    BreakerState,
    Capability,
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

/** One routable (provider, key, model) triple and the rank of its model in the call's policy. */
export interface Lane {
    readonly provider: ProviderConfig
    readonly key: KeyConfig
    readonly model: ModelConfig
    readonly rank: number
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

/** No lane is usable now: `waitUntil` is when the earliest one may be (Infinity: never within reach). */
export interface Blocked {
    readonly waitUntil: number
    /** True when a lane waits only on in-process concurrency or a probe another attempt holds. */
    readonly busy: boolean
}

const FOREVER = Number.MAX_SAFE_INTEGER

interface LaneCounters {
    attempts: number
    successes: number
    failures: Partial<Record<ErrorClass, number>>
    promptTokens: number
    completionTokens: number
    cost: number
}

interface Status {
    readonly usable: boolean
    readonly until: number
    readonly low: boolean
    readonly probes: readonly string[]
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

/**
 * The pool's state: shared breaker, disabled-key and headroom records in the store; in-flight counts, latency EWMAs and
 * round-robin weights in this process. It answers which lane an attempt takes and records how the attempt ended.
 */
export class PoolState {
    readonly #providers: readonly ProviderConfig[]
    readonly #settings: Settings
    readonly #store: StateStore
    readonly #emitter: Emitter
    readonly #inflightKey = new Map<string, number>()
    readonly #inflightProvider = new Map<string, number>()
    readonly #ewma = new Map<string, number>()
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
        return (await this.#store.get(id)) ?? EMPTY_RECORD
    }

    /** Every lane that serves one of the policy's models with the capabilities, context window and budget the call needs. */
    lanes(policy: ResolvedPolicy, need: Need): Lane[] {
        const lanes: Lane[] = []
        policy.models.forEach((name, rank) => {
            for (const provider of this.#providers) {
                if (policy.providers !== null && !policy.providers.has(provider.id)) continue
                for (const model of provider.models) {
                    if (!modelMatches(model, name)) continue
                    const capabilities = model.capabilities ?? DEFAULT_CAPABILITIES
                    if (!need.capabilities.every((capability) => capabilities.includes(capability))) continue
                    if (model.contextWindow !== undefined && need.promptTokens + need.outputTokens > model.contextWindow) continue
                    if (policy.maxCost !== null && model.cost !== undefined) {
                        const worst = (need.promptTokens * model.cost.input + need.outputTokens * model.cost.output) / 1_000_000
                        if (worst > policy.maxCost) continue
                    }
                    for (const key of provider.keys) {
                        const id = `${provider.id}/${key.alias}/${model.id}`
                        if (lanes.some((lane) => lane.id === id)) continue
                        lanes.push({ provider, key, model, rank, id, pair: `${provider.id}/${key.alias}` })
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
        if (key.disabledUntil > now) blocks.push(key.disabledUntil >= FOREVER ? Infinity : key.disabledUntil)
        const probes: string[] = []
        for (const [record, id] of [[key, this.#keyId(lane.provider.id, lane.key.alias)], [provider, this.#providerId(lane.provider.id)]] as const) {
            const state = breakerState(record, now)
            if (state === "open") blocks.push(record.openUntil)
            if (state === "half-open") probes.push(`${id}:probe`)
        }
        if (headroom.cooldownUntil > now) blocks.push(headroom.cooldownUntil)
        if (headroom.remainingRequests === 0 && headroom.requestsResetAt > now) blocks.push(headroom.requestsResetAt)
        if (headroom.remainingTokens !== null && headroom.remainingTokens < need.promptTokens + need.outputTokens && headroom.tokensResetAt > now) {
            blocks.push(headroom.tokensResetAt)
        }
        if (blocks.length > 0) return { usable: false, until: Math.max(...blocks), low: false, probes }
        const low = headroom.remainingRequests !== null && headroom.remainingRequests <= this.#settings.lowHeadroom && headroom.requestsResetAt > now
        return { usable: true, until: now, low, probes }
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
     * call, the policy's model order, a key not yet tried, a provider not yet tried, enough headroom. So a retry moves
     * to another key or provider of the same model first, then to the next model, and only then back to a tried lane.
     * Within the first non-empty tier:
     * the fewest in-flight requests, then latency within the tolerance of the best EWMA, then smooth weighted
     * round-robin. The concurrency check and the hold run without an await between them, so concurrent calls never
     * overshoot a cap.
     */
    async pick(lanes: readonly Lane[], need: Need, tried: Tried, leaseMs: number): Promise<Pick | Blocked> {
        const now = Date.now()
        const statuses = await Promise.all(lanes.map((lane) => this.#status(lane, need, now)))
        let usable: { lane: Lane; status: Status; tier: number[] }[] = []
        let waitUntil = Infinity
        lanes.forEach((lane, index) => {
            const status = statuses[index]
            if (status === undefined) return
            if (!status.usable) {
                waitUntil = Math.min(waitUntil, status.until)
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
        return { waitUntil: busy ? Math.min(waitUntil, now) : waitUntil, busy }
    }

    #choose(group: readonly Lane[]): Lane | undefined {
        const load = (lane: Lane): number => this.#inflightKey.get(lane.pair) ?? 0
        const least = Math.min(...group.map(load))
        let pool = group.filter((lane) => load(lane) === least)
        const known = pool.map((lane) => this.#ewma.get(lane.id)).filter((value): value is number => value !== undefined)
        if (known.length > 0) {
            const limit = Math.min(...known) * this.#settings.latencyTolerance + this.#settings.latencySlackMs
            pool = pool.filter((lane) => (this.#ewma.get(lane.id) ?? 0) <= limit)
        }
        // Smooth weighted round-robin (nginx): each lane gains its weight, the leader is picked and pays the total.
        let total = 0
        let best: Lane | undefined
        let bestWeight = -Infinity
        for (const lane of pool) {
            const weight = (lane.provider.weight ?? 1) * (lane.key.weight ?? 1) * (lane.model.weight ?? 1)
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
                reject(signal.reason as Error)
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

    /** Records a success: closes the lane's breakers, stores its headroom and feeds its latency EWMA. */
    async succeeded(lane: Lane, info: RateLimitInfo | null, latencyMs: number, usage: Usage | undefined): Promise<number | undefined> {
        const now = Date.now()
        await this.#breakerSuccess(this.#keyId(lane.provider.id, lane.key.alias), "key", lane, now)
        await this.#breakerSuccess(this.#providerId(lane.provider.id), "provider", lane, now)
        await this.#headroom(lane, info, 0)
        const previous = this.#ewma.get(lane.id)
        const alpha = this.#settings.ewmaAlpha
        this.#ewma.set(lane.id, previous === undefined ? latencyMs : alpha * latencyMs + (1 - alpha) * previous)
        const counters = this.#count(lane)
        counters.successes++
        const cost = costOf(lane.model, usage)
        counters.promptTokens += usage?.prompt_tokens ?? 0
        counters.completionTokens += usage?.completion_tokens ?? 0
        counters.cost += cost ?? 0
        return cost
    }

    /**
     * Records a failure by class: a 429 cools the lane down (retry-after or the default), an auth failure disables the
     * key, a transient failure counts toward the key's and the provider's breakers (honouring retry-after). Any other
     * class touches no shared state.
     */
    async failed(lane: Lane, errorClass: ErrorClass, info: RateLimitInfo | null, missingKey: boolean): Promise<void> {
        const now = Date.now()
        const counters = this.#count(lane)
        counters.failures[errorClass] = (counters.failures[errorClass] ?? 0) + 1
        const retryAt = info?.retryAt ?? 0
        if (errorClass === "rate_limit") {
            await this.#headroom(lane, info, retryAt > now ? retryAt : now + this.#settings.rateLimitCooldownMs)
            return
        }
        if (errorClass === "auth") {
            const id = this.#keyId(lane.provider.id, lane.key.alias)
            const record = await this.#read(id)
            const until = this.#settings.authDisableMs === null ? FOREVER : now + this.#settings.authDisableMs
            const reason = missingKey ? "missing" : "auth"
            await this.#store.set(id, { ...record, disabledUntil: until, disabledReason: reason })
            this.#emitter.emit("key-disabled", { type: "key-disabled", provider: lane.provider.id, key: lane.key.alias, reason, until: until >= FOREVER ? null : until })
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
                            inflight: this.#inflightKey.get(`${provider.id}/${key.alias}`) ?? 0,
                            models,
                        }
                    }),
                )
                return { id: provider.id, breaker: breakerState(record, now), failures: record.failures, inflight: this.#inflightProvider.get(provider.id) ?? 0, keys }
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
        for (const map of [this.#ewma, this.#roundRobin]) {
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
