import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { now } from "./ledger.js"
import { readMachine, recordProviderEvent, runningWorkers, textOf, withMachine } from "./machine.js"
import { poolConcurrency, stepConcurrency } from "./pools.js"
import type { ConcurrencyChange, PoolConcurrency } from "./pools.js"
import { loadRouting, minutesMs, poolsOfProvider } from "./routing.js"
import type { FailureKind, Routing } from "./routing.js"

/**
 * What a launch or a worker taught about its provider. A success may close a striking or half-open circuit and lets the pool's
 * concurrency grow; a failure kind strikes and may open the circuit (or re-open a half-open one); `unknown` (an outcome nobody
 * could confirm or deny) is recorded and changes nothing, since unknown is never a failure.
 */
export type ProviderOutcome =
    | { readonly kind: "success"; readonly pool?: string | undefined }
    | { readonly kind: "unknown"; readonly detail?: string | undefined }
    | { readonly kind: FailureKind; readonly pool?: string | undefined; readonly detail?: string | undefined; readonly resetsAt?: string | undefined }

/**
 * The probe of an open circuit: `none` while it waits (until `probeDueAt`), `due` when the next pick may send one launch to
 * it, `in-flight` while that launch's outcome is awaited (other picks still skip the provider).
 */
export type ProbeState = "none" | "due" | "in-flight"

/** A provider's circuit as provider_health keeps it; `open` is true until a success closes it, the cooldown only times the probe. */
export interface CircuitState {
    readonly provider: string
    readonly status: "healthy" | "striking" | "open" | "recovered"
    readonly strikes: number
    readonly failureKind: string | null
    readonly openUntil: string | null
    readonly open: boolean
    readonly probe: ProbeState
    readonly probeDueAt: string | null
    readonly failedProbes: number
    readonly updatedAt: string | null
}

/** What recordOutcome changed: the circuit before and after, whether it opened (and for how long), and each pool's AIMD step. */
export interface OutcomeRecord {
    readonly provider: string
    readonly outcome: ProviderOutcome
    readonly before: CircuitState
    readonly after: CircuitState
    readonly opened: { readonly cooldownMinutes: number; readonly reopens: number; readonly until: string } | null
    readonly concurrency: readonly ConcurrencyChange[]
}

const STATUSES: readonly CircuitState["status"][] = ["healthy", "striking", "open", "recovered"]

const closed = (provider: string): CircuitState => ({ provider, status: "healthy", strikes: 0, failureKind: null, openUntil: null, open: false, probe: "none", probeDueAt: null, failedProbes: 0, updatedAt: null })

const later = (at: string, minutes: number): string => new Date(Date.parse(at) + minutesMs(minutes)).toISOString()

/** The cooldown of an open: the kind's own, times reopenFactor per reopen in the window, capped, never below the kind's own. */
export const cooldownMinutes = (routing: Routing, kind: FailureKind, reopens: number): number => {
    const base = routing.circuit.cooldownMinutes[kind]
    return Math.max(base, Math.min(base * routing.circuit.reopenFactor ** reopens, routing.circuit.capMinutes))
}

/**
 * The half-open state of an open circuit, from its events since it opened: a probe is due at the cooldown's end or
 * probeEveryMinutes after the open (times reopenFactor per failed probe, capped at probeCapMinutes), whichever is first, and
 * a quota circuit's at its reset; a probe sent and not answered within probeLeaseMinutes is in flight.
 */
const probeOf = (db: DatabaseSync, routing: Routing, provider: string, failureKind: string | null, openUntil: string | null, fallbackOpenedAt: string, at: string): Pick<CircuitState, "probe" | "probeDueAt" | "failedProbes"> => {
    const opened = textOf(db.prepare("SELECT MAX(at) AS at FROM provider_events WHERE provider = ? AND kind = 'circuit-open'").get(provider)?.at) ?? fallbackOpenedAt
    const rows = db.prepare("SELECT kind, at FROM provider_events WHERE provider = ? AND kind IN ('probe', 'probe-failed') AND at >= ? ORDER BY id").all(provider, opened)
    const times = (kind: string): string[] => rows.filter((row) => row.kind === kind).map((row) => textOf(row.at) ?? "")
    const failed = times("probe-failed")
    const lastProbe = times("probe").at(-1)
    const lastFailed = failed.at(-1)
    const { probeEveryMinutes, probeCapMinutes, probeLeaseMinutes, reopenFactor } = routing.circuit
    const inFlight = lastProbe !== undefined && (lastFailed === undefined || lastFailed < lastProbe) && Date.parse(lastProbe) + minutesMs(probeLeaseMinutes) > Date.parse(at)
    const interval = Math.min(probeEveryMinutes * reopenFactor ** failed.length, Math.max(probeCapMinutes, probeEveryMinutes))
    // A quota circuit waits for its window's reset: a launch before it proves nothing the reset time does not already say.
    const byInterval = failureKind === "quota" && openUntil !== null ? openUntil : later(lastFailed ?? opened, interval)
    const probeDueAt = openUntil !== null && openUntil < byInterval ? openUntil : byInterval
    const due: ProbeState = probeDueAt <= at ? "due" : "none"
    const probe: ProbeState = inFlight ? "in-flight" : due
    return { probe, probeDueAt, failedProbes: failed.length }
}

/** The circuit of a provider at `at`; a provider with no row is healthy. */
export const readCircuit = (db: DatabaseSync | undefined, provider: string, at: string = now()): CircuitState => {
    const row = db?.prepare("SELECT * FROM provider_health WHERE provider = ?").get(provider)
    if (db === undefined || row === undefined) return closed(provider)
    const openUntil = textOf(row.circuit_open_until)
    const raw = textOf(row.status) ?? "healthy"
    const status = STATUSES.find((known) => known === raw) ?? "healthy"
    const updatedAt = textOf(row.updated_at)
    const base = { provider, status, strikes: Number(row.strikes), failureKind: textOf(row.failure_kind), openUntil, updatedAt }
    if (status !== "open") return { ...base, open: false, probe: "none", probeDueAt: null, failedProbes: 0 }
    return { ...base, open: true, ...probeOf(db, loadRouting(), provider, base.failureKind, openUntil, updatedAt ?? at, at) }
}

const writeCircuit = (db: DatabaseSync, state: Pick<CircuitState, "provider" | "status" | "strikes" | "failureKind" | "openUntil">, at: string): void => {
    db.prepare(
        `INSERT INTO provider_health (provider, status, strikes, failure_kind, circuit_open_until, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET status = excluded.status, strikes = excluded.strikes, failure_kind = excluded.failure_kind,
         circuit_open_until = excluded.circuit_open_until, updated_at = excluded.updated_at`,
    ).run(state.provider, state.status, state.strikes, state.failureKind, state.openUntil, at)
}

/** Closes an open circuit on evidence that the provider answers (a probe's success, or an account reading that says ok). */
export const closeCircuit = (db: DatabaseSync, provider: string, by: string, evidence: unknown, at: string): void => {
    const before = readCircuit(db, provider, at)
    writeCircuit(db, { provider, status: "healthy", strikes: 0, failureKind: null, openUntil: null }, at)
    recordProviderEvent(db, provider, "circuit-close", { by, evidence, was: { kind: before.failureKind, until: before.openUntil, failedProbes: before.failedProbes } }, at)
}

/** Marks the probe of a half-open circuit as sent: the pick that carries it is the one launch the provider gets until it answers. */
export const recordProbe = (db: DatabaseSync, provider: string, data: unknown, at: string): void => {
    recordProviderEvent(db, provider, "probe", data, at)
}

/** How many times the provider's circuit opened within the reopen window before `at`: each one multiplies the next cooldown. */
const reopensBefore = (db: DatabaseSync, routing: Routing, provider: string, at: string): number => {
    const since = new Date(Date.parse(at) - minutesMs(routing.circuit.reopenWindowMinutes)).toISOString()
    return Number(db.prepare("SELECT COUNT(*) AS n FROM provider_events WHERE provider = ? AND kind = 'circuit-open' AND at >= ?").get(provider, since)?.n ?? 0)
}

/** Writes a pool's binding quota reading (pool_quota); every source of a reading goes through here. */
export const writeQuota = (db: DatabaseSync, pool: string, usedPercent: number, resetsAt: string | null, source: string, at: string): void => {
    db.prepare(
        `INSERT INTO pool_quota (pool, used_percent, resets_at, observed_at, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(pool) DO UPDATE SET used_percent = excluded.used_percent, resets_at = excluded.resets_at, observed_at = excluded.observed_at, source = excluded.source`,
    ).run(pool, usedPercent, resetsAt, at, source)
}

const targetPools = (routing: Routing, provider: string, pool: string | undefined): string[] => (pool === undefined ? poolsOfProvider(routing, provider) : [pool])

/** The open time of a failure: the kind's cooldown, or the reset a quota failure names. */
const openFor = (kind: FailureKind, minutes: number, resetsAt: string | undefined, at: string): { readonly minutes: number; readonly until: string } => {
    if (kind === "quota" && resetsAt !== undefined && Date.parse(resetsAt) > Date.parse(at)) {
        const until = new Date(Date.parse(resetsAt)).toISOString()
        return { minutes: Math.ceil((Date.parse(until) - Date.parse(at)) / 60_000), until }
    }
    return { minutes, until: later(at, minutes) }
}

const applyFailure = (db: DatabaseSync, routing: Routing, provider: string, outcome: ProviderOutcome & { readonly kind: FailureKind }, before: CircuitState, at: string): OutcomeRecord["opened"] => {
    const kind = outcome.kind
    if (before.open && before.probe === "none") {
        recordProviderEvent(db, provider, "failure-while-open", { kind, detail: outcome.detail ?? null, until: before.openUntil }, at)
        return null
    }
    let reopens: number
    let event: string
    let strikes: number
    if (before.open) {
        // The half-open probe failed: the circuit re-opens, and its cooldown and next probe back off by the failed probes.
        reopens = before.failedProbes + 1
        event = "probe-failed"
        strikes = before.strikes + 1
    } else {
        strikes = (before.status === "striking" && before.failureKind === kind ? before.strikes : 0) + 1
        if (strikes < (routing.circuit.strikes[kind] ?? 1)) {
            writeCircuit(db, { provider, status: "striking", strikes, failureKind: kind, openUntil: null }, at)
            recordProviderEvent(db, provider, "strike", { kind, strikes, detail: outcome.detail ?? null }, at)
            return null
        }
        reopens = reopensBefore(db, routing, provider, at)
        event = "circuit-open"
    }
    const { minutes, until } = openFor(kind, cooldownMinutes(routing, kind, reopens), outcome.resetsAt, at)
    writeCircuit(db, { provider, status: "open", strikes, failureKind: kind, openUntil: until }, at)
    recordProviderEvent(db, provider, event, { kind, strikes, reopens, cooldownMinutes: minutes, until, detail: outcome.detail ?? null }, at)
    if (kind === "quota") for (const pool of targetPools(routing, provider, outcome.pool)) writeQuota(db, pool, 100, until, "quota-failure", at)
    return { cooldownMinutes: minutes, reopens, until }
}

/**
 * Records one provider outcome on the host store: the circuit (provider_health), its event, and each pool's AIMD step. A
 * rate or capacity failure throttles the pool (or every pool of the provider when none is named); a success lets it grow.
 */
export const recordOutcome = (provider: string, outcome: ProviderOutcome, at: string = now()): OutcomeRecord => {
    const routing = loadRouting()
    return withMachine((db) => {
        const before = readCircuit(db, provider, at)
        let opened: OutcomeRecord["opened"] = null
        const concurrency: ConcurrencyChange[] = []
        if (outcome.kind === "unknown") {
            recordProviderEvent(db, provider, "outcome-unknown", { detail: outcome.detail ?? null }, at)
        } else if (outcome.kind === "success") {
            // A success while the circuit waits for its probe came from a launch started before it opened; the wait stands.
            if (before.open && before.probe !== "none") closeCircuit(db, provider, "probe", { pool: outcome.pool ?? null }, at)
            else if (!before.open && before.status !== "healthy") writeCircuit(db, { provider, status: "healthy", strikes: 0, failureKind: null, openUntil: null }, at)
            recordProviderEvent(db, provider, "success", { pool: outcome.pool ?? null }, at)
            for (const pool of targetPools(routing, provider, outcome.pool)) concurrency.push(stepConcurrency(db, routing, pool, "success", at))
        } else {
            opened = applyFailure(db, routing, provider, outcome, before, at)
            if (outcome.kind === "rate" || outcome.kind === "capacity") {
                for (const pool of targetPools(routing, provider, outcome.pool)) concurrency.push(stepConcurrency(db, routing, pool, "throttle", at))
            }
        }
        return { provider, outcome, before, after: readCircuit(db, provider, at), opened, concurrency }
    })
}

/** The providers ops/routing.yaml knows, from its pools. */
export const knownProviders = (routing: Routing): string[] => [...new Set(Object.values(routing.pools).map((pool) => pool.provider))].sort((a, b) => a.localeCompare(b))

/** Closes a provider's circuit as the Supervisor's recorded action after a probe it ran itself passed; the reason is kept as an event. */
export const recoverProvider = (provider: string, by: string, reason: string, at: string = now()): { readonly before: CircuitState; readonly after: CircuitState } => {
    const routing = loadRouting()
    if (!knownProviders(routing).includes(provider)) throw new Refusal("PROVIDER_UNKNOWN", `no pool of ops/routing.yaml draws on provider ${provider} (known: ${knownProviders(routing).join(", ")})`)
    return withMachine((db) => {
        const before = readCircuit(db, provider, at)
        writeCircuit(db, { provider, status: "recovered", strikes: 0, failureKind: null, openUntil: null }, at)
        recordProviderEvent(db, provider, "circuit-recover", { by, reason, was: before }, at)
        return { before, after: readCircuit(db, provider, at) }
    })
}

/** A pool's quota reading; `fresh` is false when there is none, it is older than maxAgeMinutes, or its window has reset. */
export interface QuotaReading {
    readonly pool: string
    readonly usedPercent: number | null
    readonly resetsAt: string | null
    readonly observedAt: string | null
    readonly source: string | null
    readonly fresh: boolean
}

/** The quota reading of a pool at `at`; an unknown or stale reading is reported with fresh false and never blocks. */
export const readQuota = (db: DatabaseSync | undefined, routing: Routing, pool: string, at: string = now()): QuotaReading => {
    const row = db?.prepare("SELECT * FROM pool_quota WHERE pool = ?").get(pool)
    if (row === undefined) return { pool, usedPercent: null, resetsAt: null, observedAt: null, source: null, fresh: false }
    const observedAt = textOf(row.observed_at)
    const resetsAt = textOf(row.resets_at)
    const age = observedAt === null ? Infinity : Date.parse(at) - Date.parse(observedAt)
    const fresh = age <= minutesMs(routing.quota.maxAgeMinutes) && (resetsAt === null || resetsAt > at)
    return { pool, usedPercent: Number(row.used_percent), resetsAt, observedAt, source: textOf(row.source), fresh }
}

/** Records a quota reading of a pool's window (percent used), from a provider's own answer or an account poll. */
export const recordQuota = (pool: string, usedPercent: number, options: { readonly resetsAt?: string | undefined; readonly source: string }, at: string = now()): QuotaReading => {
    const routing = loadRouting()
    const spec = routing.pools[pool]
    if (spec === undefined) throw new Refusal("POOL_UNKNOWN", `no pool ${pool} in ops/routing.yaml (known: ${Object.keys(routing.pools).join(", ")})`)
    if (!Number.isFinite(usedPercent) || usedPercent < 0) throw new Refusal("CLI_USAGE", `a quota reading is a percent of 0 or more, not ${String(usedPercent)}`, 2)
    return withMachine((db) => {
        writeQuota(db, pool, usedPercent, options.resetsAt ?? null, options.source, at)
        recordProviderEvent(db, spec.provider, "quota-reading", { pool, usedPercent, resetsAt: options.resetsAt ?? null, source: options.source }, at)
        return readQuota(db, routing, pool, at)
    })
}

/** Reads a typed launch error for the failure signals of ops/routing.yaml; a certain failure that names none is `launch`. */
export const classifyFailure = (routing: Routing, text: string): FailureKind => {
    // Auth and quota first: their messages often also say "limit", which must not read as a rate limit.
    const order: readonly FailureKind[] = ["auth", "quota", "rate", "capacity"]
    return order.find((kind) => (routing.failureSignals[kind] ?? []).some((pattern) => new RegExp(pattern, "i").test(text))) ?? "launch"
}

/** One provider as `provider status` shows it: its circuit, its pools (cap, running, quota) and its latest events. */
export interface ProviderView {
    readonly provider: string
    readonly circuit: CircuitState
    readonly pools: readonly (PoolConcurrency & { readonly running: number; readonly quota: QuotaReading })[]
    readonly events: readonly { readonly at: string; readonly kind: string; readonly data: unknown }[]
}

/** Every known provider's circuit, pools and recent events; reads only, and creates no host store. */
export const providerViews = (eventsPerProvider = 5, at: string = now()): ProviderView[] => {
    const routing = loadRouting()
    const running = runningWorkers()
    const views = (db: DatabaseSync | undefined): ProviderView[] =>
        knownProviders(routing).map((provider) => ({
            provider,
            circuit: readCircuit(db, provider, at),
            pools: poolsOfProvider(routing, provider).map((pool) => ({ ...poolConcurrency(db, routing, pool), running: running.byAgent.get(pool) ?? 0, quota: readQuota(db, routing, pool, at) })),
            events: (db?.prepare("SELECT at, kind, data_json FROM provider_events WHERE provider = ? ORDER BY id DESC LIMIT ?").all(provider, eventsPerProvider) ?? []).map((row) => ({
                at: textOf(row.at) ?? "",
                kind: textOf(row.kind) ?? "",
                data: JSON.parse(textOf(row.data_json) ?? "null") as unknown,
            })),
        }))
    return readMachine<ProviderView[] | undefined>(views, undefined) ?? views(undefined)
}
