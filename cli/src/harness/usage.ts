import { readdirSync, readFileSync, statSync } from "node:fs"
import type { Dirent } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { captureToolSync } from "../shared/exec.js"
import { closeCircuit, readCircuit, writeQuota } from "./circuit.js"
import { now } from "./ledger.js"
import { readMachine, recordProviderEvent, textOf, withMachine } from "./machine.js"
import { ORCA_TIMEOUT_MS, orcaBinarySync } from "./orca/client.js"
import { loadRouting, minutesMs, poolsOfProvider } from "./routing.js"
import type { Routing } from "./routing.js"

/** One usage window of a provider as Orca reports it: percent used, its length and when it resets. */
export interface UsageWindow {
    readonly window: string
    readonly usedPercent: number
    readonly windowMinutes: number | null
    readonly resetsAt: string | null
}

/** A provider's usage reading: Orca's status for it (`ok` or why not) and the windows routing.yaml `usage.windows` names. */
export interface ProviderUsage {
    readonly provider: string
    readonly status: string
    readonly error: string | null
    readonly windows: readonly UsageWindow[]
}

const windowSchema = z.looseObject({ usedPercent: z.number(), windowMinutes: z.number().nullish(), resetsAt: z.number().nullish() })
const limitsSchema = z.looseObject({ provider: z.string().optional(), status: z.string().optional(), error: z.string().nullish() })

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/**
 * Reads `orca account list --json` (its whole reply, or its `result`): `rateLimits` holds one entry per provider for the active
 * account, each with a status and its usage windows (usedPercent, windowMinutes, resetsAt in epoch ms).
 */
export const parseOrcaUsage = (reply: unknown, windows: readonly string[]): ProviderUsage[] => {
    const outer = recordOf(reply)
    const result = recordOf(outer?.result) ?? outer
    const limits = recordOf(result?.rateLimits) ?? {}
    return Object.entries(limits).flatMap(([key, value]): ProviderUsage[] => {
        const parsed = limitsSchema.safeParse(value)
        const entry = recordOf(value)
        if (!parsed.success || entry === undefined || parsed.data.status === undefined) return []
        const found = windows.flatMap((window): UsageWindow[] => {
            const read = windowSchema.safeParse(entry[window])
            if (!read.success) return []
            const { usedPercent, windowMinutes, resetsAt } = read.data
            return [{ window, usedPercent, windowMinutes: windowMinutes ?? null, resetsAt: resetsAt === null || resetsAt === undefined ? null : new Date(resetsAt).toISOString() }]
        })
        return [{ provider: key, status: parsed.data.status, error: parsed.data.error ?? null, windows: found }]
    })
}

/** The window that binds a pool: the most used, the later reset on a tie. */
const binding = (windows: readonly UsageWindow[]): UsageWindow | undefined =>
    [...windows].sort((a, b) => b.usedPercent - a.usedPercent || (b.resetsAt ?? "").localeCompare(a.resetsAt ?? ""))[0]

/**
 * Records usage readings on the host store: each window of each pool of a known provider (pool_windows), the binding one as
 * the pool's quota (pool_quota), and an event. A reading that says ok proves the provider answers its account, so a circuit
 * open for auth, or for quota while the reading shows headroom, closes. A reading that is not ok proves nothing and changes no quota.
 */
export const applyUsage = (db: DatabaseSync, routing: Routing, usages: readonly ProviderUsage[], source: string, at: string): string[] => {
    const lines: string[] = []
    for (const usage of usages) {
        const pools = poolsOfProvider(routing, usage.provider)
        if (pools.length === 0) continue
        if (usage.status !== "ok") {
            recordProviderEvent(db, usage.provider, "usage-unavailable", { status: usage.status, error: usage.error, source }, at)
            lines.push(`${usage.provider}: no reading (${usage.status}${usage.error === null ? "" : ": " + usage.error})`)
            continue
        }
        const bound = binding(usage.windows)
        for (const pool of pools) {
            for (const window of usage.windows) {
                db.prepare(
                    `INSERT INTO pool_windows (pool, window, used_percent, window_minutes, resets_at, observed_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(pool, window) DO UPDATE SET used_percent = excluded.used_percent, window_minutes = excluded.window_minutes,
                     resets_at = excluded.resets_at, observed_at = excluded.observed_at, source = excluded.source`,
                ).run(pool, window.window, window.usedPercent, window.windowMinutes, window.resetsAt, at, source)
            }
            if (bound !== undefined) writeQuota(db, pool, bound.usedPercent, bound.resetsAt, source, at)
        }
        recordProviderEvent(db, usage.provider, "usage-reading", { pools, windows: usage.windows, source }, at)
        const circuit = readCircuit(db, usage.provider, at)
        const headroom = bound === undefined || bound.usedPercent < routing.quota.exhaustedPercent
        if (circuit.open && (circuit.failureKind === "auth" || (circuit.failureKind === "quota" && headroom))) {
            closeCircuit(db, usage.provider, "usage", { status: usage.status, source, binding: bound ?? null }, at)
        }
        const quota = bound === undefined ? "no window" : `${String(bound.usedPercent)}% (${bound.window}${bound.resetsAt === null ? "" : ", resets " + bound.resetsAt})`
        lines.push(`${usage.provider}: ${quota}${circuit.open ? `; circuit ${circuit.failureKind ?? "?"} ${headroom || circuit.failureKind === "auth" ? "closed by the reading" : "stays open"}` : ""}`)
    }
    return lines
}

const ORCA_SOURCE = "orca"

const CODEX_SOURCE = "codex-rollout"

const rolloutLimitSchema = z.looseObject({ used_percent: z.number(), window_minutes: z.number().nullish(), resets_at: z.number().nullish() })
const rolloutLimitsSchema = z.looseObject({ primary: rolloutLimitSchema.nullish(), secondary: rolloutLimitSchema.nullish() })

/** The newest file under a folder whose name matches, walking only the newest-named branch of each level (Codex keeps yyyy/mm/dd). */
const newestFile = (dir: string, pattern: RegExp): string | undefined => {
    let entries: Dirent[]
    try {
        entries = readdirSync(dir, { withFileTypes: true })
    } catch {
        return undefined
    }
    const files = entries.filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => join(dir, entry.name))
    const newest = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    if (newest !== undefined) return newest
    for (const sub of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
        const found = newestFile(join(dir, sub), pattern)
        if (found !== undefined) return found
    }
    return undefined
}

/** A usage window named by its length, so a source that numbers its windows maps onto usage.windows. */
const windowName = (minutes: number | null): string => (minutes === null || minutes > 10_080 ? "monthly" : minutes > 1440 ? "weekly" : "session")

/**
 * Codex's own record of its limits, for when Orca gives no Codex reading: the `rate_limits` of the last line that carries one
 * in the newest session rollout under $CODEX_HOME/sessions (Codex's home, ~/.codex by default; never a credential file), observed at
 * that file's last write.
 */
export const codexRolloutUsage = (): { readonly usage: ProviderUsage; readonly observedAt: string } | undefined => {
    const file = newestFile(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions"), /^rollout-.*\.jsonl$/)
    if (file === undefined) return undefined
    const line = readFileSync(file, "utf8").split("\n").reverse().find((text) => text.includes("\"rate_limits\""))
    if (line === undefined) return undefined
    let limits: unknown
    try {
        const parsed: unknown = JSON.parse(line)
        limits = recordOf(recordOf(parsed)?.payload)?.rate_limits
    } catch {
        return undefined
    }
    const read = rolloutLimitsSchema.safeParse(limits)
    if (!read.success) return undefined
    const windows = [read.data.primary, read.data.secondary].flatMap((limit): UsageWindow[] =>
        limit === null || limit === undefined
            ? []
            : [{ window: windowName(limit.window_minutes ?? null), usedPercent: limit.used_percent, windowMinutes: limit.window_minutes ?? null, resetsAt: limit.resets_at === null || limit.resets_at === undefined ? null : new Date(limit.resets_at * 1000).toISOString() }],
    )
    return { usage: { provider: "codex", status: "ok", error: null, windows }, observedAt: statSync(file).mtime.toISOString() }
}

/** When Orca's usage was last polled (its event on the host store), or null. */
const lastPoll = (): string | null => readMachine((db) => textOf(db.prepare("SELECT MAX(at) AS at FROM provider_events WHERE provider = ? AND kind = 'usage-poll'").get(ORCA_SOURCE)?.at), null)

/**
 * Polls Orca's account usage (`orca account list --json`, read-only) and records it, at most once per usage.refreshMinutes
 * unless `force`; a poll that fails is recorded and proves nothing. Returns what it read, or null when the last poll is recent.
 */
export const refreshUsage = (options: { readonly force?: boolean; readonly reply?: unknown } = {}, at: string = now()): string[] | null => {
    const routing = loadRouting()
    const last = lastPoll()
    if (options.force !== true && options.reply === undefined && last !== null && Date.parse(at) - Date.parse(last) < minutesMs(routing.usage.refreshMinutes)) return null
    let reply: unknown = options.reply
    let failure: string | null = null
    if (reply === undefined) {
        const binary = orcaBinarySync()
        const run = binary === undefined ? undefined : captureToolSync(binary.path, ["account", "list", "--json"], process.cwd(), ORCA_TIMEOUT_MS)
        if (run === undefined) failure = "STARCI_ORCA_BIN names no file"
        else if (run.exitCode !== 0) failure = `exit ${String(run.exitCode)}${run.timedOut ? " (timed out)" : ""}: ${run.stderr.split("\n")[0] ?? ""}`
        else {
            try {
                reply = JSON.parse(run.stdout)
            } catch {
                failure = "the reply is not json"
            }
        }
    }
    const usages = failure === null ? parseOrcaUsage(reply, routing.usage.windows) : []
    const codexRead = usages.some((usage) => usage.provider === "codex" && usage.status === "ok")
    const rollout = codexRead || options.reply !== undefined ? undefined : codexRolloutUsage()
    const freshRollout = rollout !== undefined && Date.parse(at) - Date.parse(rollout.observedAt) <= minutesMs(routing.quota.maxAgeMinutes) ? rollout : undefined
    return withMachine((db) => {
        recordProviderEvent(db, ORCA_SOURCE, "usage-poll", { ok: failure === null, detail: failure, providers: usages.map((usage) => usage.provider) }, at)
        const lines = failure === null ? applyUsage(db, routing, usages, options.reply === undefined ? ORCA_SOURCE : "report", at) : [`orca usage not read: ${failure}`]
        const fallback = freshRollout === undefined ? [] : applyUsage(db, routing, [freshRollout.usage], CODEX_SOURCE, freshRollout.observedAt).map((line) => `${line} [${CODEX_SOURCE}]`)
        return [...lines, ...fallback]
    })
}

/** Every usage window of a pool as its provider last reported it (machine.sqlite pool_windows), in the order they were stored. */
export const poolWindows = (db: DatabaseSync | undefined, pool: string): (UsageWindow & { readonly observedAt: string })[] =>
    (db?.prepare("SELECT window, used_percent, window_minutes, resets_at, observed_at FROM pool_windows WHERE pool = ? ORDER BY rowid").all(pool) ?? []).map((row) => ({
        window: textOf(row.window) ?? "",
        usedPercent: Number(row.used_percent),
        windowMinutes: row.window_minutes === null ? null : Number(row.window_minutes),
        resetsAt: textOf(row.resets_at),
        observedAt: textOf(row.observed_at) ?? "",
    }))

/**
 * How far a pool burns ahead of its windows' clocks: the largest used share over elapsed share among its fresh windows (1 is on
 * pace, 2 is twice as fast); null without a fresh window. Elapsed counts from a twentieth of the window, so a window that just
 * reset does not read as burning infinitely fast.
 */
export const paceOf = (db: DatabaseSync | undefined, routing: Routing, pool: string, at: string = now()): number | null => {
    const paces = poolWindows(db, pool).flatMap((window): number[] => {
        const { resetsAt, windowMinutes: length } = window
        if (resetsAt === null || resetsAt <= at || length === null || length <= 0 || Date.parse(at) - Date.parse(window.observedAt) > minutesMs(routing.quota.maxAgeMinutes)) return []
        const elapsed = Math.min(1, Math.max(0.05, 1 - (Date.parse(resetsAt) - Date.parse(at)) / minutesMs(length)))
        return [window.usedPercent / 100 / elapsed]
    })
    return paces.length === 0 ? null : Math.max(...paces)
}
