import { providerViews } from "../../harness/circuit.js"
import type { ProviderView } from "../../harness/circuit.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

interface ProviderStatusData {
    readonly providers: readonly ProviderView[]
}

const circuitCell = (view: ProviderView): string => {
    const { circuit } = view
    if (circuit.open) return `open (${circuit.failureKind ?? "?"}) until ${circuit.openUntil ?? "?"}`
    if (circuit.status === "striking") return `striking (${circuit.failureKind ?? "?"} ${String(circuit.strikes)})`
    return circuit.status === "open" ? "closed (cooldown over)" : circuit.status
}

const quotaCell = (quota: ProviderView["pools"][number]["quota"]): string => {
    if (quota.usedPercent === null) return "unknown"
    const reading = `${String(quota.usedPercent)}%${quota.resetsAt === null ? "" : ` resets ${quota.resetsAt}`}`
    return quota.fresh ? reading : `unknown (stale: ${reading})`
}

/** `starci provider status`: every provider's circuit, its pools' AIMD cap, running workers and quota, and its latest events. */
export const providerStatusVerb = defineVerb({
    path: ["provider", "status"],
    summary: "each provider's circuit and strikes, its pools' concurrency cap, running workers and quota window, and its latest events",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/provider-status@1",
    flags: {
        events: { kind: "string", summary: "how many recent events to show per provider (default 5)" },
    },
    run: (_context, flags) => {
        const providers = providerViews(flags.events === undefined ? 5 : Math.max(0, Math.floor(Number(flags.events)) || 0))
        const rows = [["provider", "circuit", "pool", "cap/max", "running", "quota"]]
        for (const view of providers) {
            for (const pool of view.pools) rows.push([view.provider, circuitCell(view), pool.pool, `${String(pool.cap)}/${String(pool.max)}`, String(pool.running), quotaCell(pool.quota)])
        }
        const events = providers.flatMap((view) => view.events.map((event) => `${event.at}  ${view.provider}  ${event.kind}  ${JSON.stringify(event.data)}`))
        const data: ProviderStatusData = { providers }
        return Promise.resolve({ data, message: [formatTable(rows), ...(events.length === 0 ? [] : ["", "events:", ...events])].join("\n") })
    },
})
