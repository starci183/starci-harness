import { recordOutcome, recordQuota } from "../../harness/circuit.js"
import type { OutcomeRecord, ProviderOutcome, QuotaReading } from "../../harness/circuit.js"
import { FAILURE_KINDS, loadRouting, poolsOfProvider } from "../../harness/routing.js"
import type { FailureKind } from "../../harness/routing.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"

type ReportData = { readonly outcome: OutcomeRecord; readonly quota: null } | { readonly outcome: null; readonly quota: QuotaReading }

const OUTCOMES: readonly string[] = ["success", "unknown", ...FAILURE_KINDS]

const isFailure = (kind: string): kind is FailureKind => (FAILURE_KINDS as readonly string[]).includes(kind)

const validTime = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined
    if (Number.isNaN(Date.parse(value))) throw new Refusal("CLI_USAGE", `--resets-at is an ISO time, not "${value}"`, EXIT_USAGE)
    return new Date(Date.parse(value)).toISOString()
}

const outcomeOf = (kind: string, pool: string | undefined, detail: string | undefined, resetsAt: string | undefined): ProviderOutcome => {
    if (kind === "success") return { kind, pool }
    if (kind === "unknown") return { kind, detail }
    if (isFailure(kind)) return { kind, pool, detail, resetsAt }
    throw new Refusal("CLI_USAGE", `--outcome is one of ${OUTCOMES.join(", ")}, not "${kind}"`, EXIT_USAGE)
}

/**
 * `starci provider report <provider>`: records what a launch, a worker's result or an account poll taught about a provider,
 * outside `seat start` (which records its own launch outcomes): an outcome for the circuit and AIMD, or a quota reading.
 */
export const providerReportVerb = defineVerb({
    path: ["provider", "report"],
    summary: "record a provider outcome (success, unknown, rate, quota, capacity, auth, launch) for its circuit and pool concurrency, or a pool's quota reading",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor"],
    schema: "starci/provider-report@1",
    flags: {
        provider: { kind: "string", summary: "the provider (claude, codex, devin, ...)", required: true, positional: true },
        outcome: { kind: "string", summary: `what happened: ${OUTCOMES.join(", ")}` },
        quota: { kind: "string", summary: "instead of an outcome: the percent of the pool's quota window used" },
        pool: { kind: "string", summary: "the pool it concerns (default: every pool of the provider; a quota reading needs one when it has several)" },
        "resets-at": { kind: "string", summary: "when the quota window resets (ISO time), for a quota outcome or reading" },
        reason: { kind: "string", summary: "the provider's own words (the typed error)" },
    },
    run: (_context, flags): Promise<VerbResult<ReportData>> => {
        if ((flags.outcome === undefined) === (flags.quota === undefined)) throw new Refusal("CLI_USAGE", "give exactly one of --outcome or --quota", EXIT_USAGE)
        const routing = loadRouting()
        const pools = poolsOfProvider(routing, flags.provider)
        if (pools.length === 0) throw new Refusal("PROVIDER_UNKNOWN", `no pool of ops/routing.yaml draws on provider ${flags.provider}`)
        if (flags.pool !== undefined && !pools.includes(flags.pool)) throw new Refusal("POOL_UNKNOWN", `pool ${flags.pool} does not draw on provider ${flags.provider} (its pools: ${pools.join(", ")})`)
        const resetsAt = validTime(flags["resets-at"])
        if (flags.quota !== undefined) {
            const pool = flags.pool ?? (pools.length === 1 ? pools[0] : undefined)
            if (pool === undefined) throw new Refusal("CLI_USAGE", `provider ${flags.provider} has several pools (${pools.join(", ")}); name one with --pool`, EXIT_USAGE)
            const reading = recordQuota(pool, Number(flags.quota), { resetsAt, source: "report" })
            const data: ReportData = { outcome: null, quota: reading }
            const resetNote = reading.resetsAt === null ? "" : `, resets ${reading.resetsAt}`
            return Promise.resolve({ data, message: `pool ${pool}: quota ${String(reading.usedPercent)}%${resetNote}` })
        }
        const recorded = recordOutcome(flags.provider, outcomeOf(flags.outcome ?? "", flags.pool, flags.reason, resetsAt))
        const untilNote = recorded.after.open ? ` until ${recorded.after.openUntil ?? "?"}` : ""
        const lines = [
            `provider ${flags.provider}: ${recorded.before.status} -> ${recorded.after.status}${untilNote}`,
            ...(recorded.opened === null ? [] : [`circuit opened for ${String(recorded.opened.cooldownMinutes)} min (reopen ${String(recorded.opened.reopens)} in the window)`]),
            ...recorded.concurrency.map((step) => `pool ${step.pool}: cap ${String(step.from)} -> ${String(step.to)} of ${String(step.max)} (${step.reason})`),
        ]
        const data: ReportData = { outcome: recorded, quota: null }
        return Promise.resolve({ data, message: lines.join("\n") })
    },
})
