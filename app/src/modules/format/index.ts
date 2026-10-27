/**
 * The one owner of every displayed clock, count and composed phrase the blocks resolve. Blocks call these in their connected
 * half; a pure half only ever receives the strings.
 */
import type { Member, Overview, ProviderStatus, WorkflowRow, WorkflowStatus } from "@contract"
import { CIRCUIT, COMMON, LOCALE, OVERVIEW, type CircuitLabel } from "../i18n"

const ACTIVE: ReadonlySet<WorkflowStatus> = new Set<WorkflowStatus>(["running", "blocked", "paused", "stopping"])

/** `3 dự án · 2 workflow đang hoạt động · 5 Op đang chạy`. */
export const overviewCounts = (overview: Overview): string => {
    const active = overview.workflows.filter((row) => ACTIVE.has(row.status)).length
    const live = overview.workflows.reduce((sum, row) => sum + row.liveOps, 0)
    return OVERVIEW.counts(overview.projects.length, active, live)
}

const RESERVE_PERCENT = 80

export const peakUsage = (provider: ProviderStatus): number =>
    provider.circuit === "open" ? 100 : Math.max(0, ...provider.windows.map((window) => window.usedPercent))

export const circuitView = (provider: ProviderStatus): CircuitLabel => {
    if (provider.circuit === "open") return provider.failureKind === "quota" ? CIRCUIT.quota : CIRCUIT.open
    if (provider.circuit === "half-open") return CIRCUIT["half-open"]
    if (peakUsage(provider) >= RESERVE_PERCENT) return CIRCUIT["near-reserve"]
    return CIRCUIT.closed
}

export const windowsLine = (provider: ProviderStatus): string =>
    provider.windows.length === 0
        ? OVERVIEW.noQuota
        : provider.windows.map((window) => `${window.label} ${window.usedPercent}%`).join(" · ")

/** The instant the provider frees up again: its circuit reopening, else the earliest window reset. */
export const nextReset = (provider: ProviderStatus): string | null => {
    if (provider.circuit === "open" && provider.reopensAt !== null) return provider.reopensAt
    const resets = provider.windows.flatMap((window) => (window.resetsAt === null ? [] : [window.resetsAt]))
    return [...resets].sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null
}

export const runningLine = (provider: ProviderStatus): string => {
    const running = provider.running.length === 0 ? "0" : provider.running.map((slot) => `${slot.model} ${slot.count}`).join(", ")
    return OVERVIEW.running(running, provider.cap)
}

const clock = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" })
const stamp = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" })

/** `12:41`, or the input itself when it is not an instant. */
export const clockTime = (at: string): string => {
    const time = Date.parse(at)
    return Number.isNaN(time) ? at : clock.format(time)
}

/** `27/10/26 12:41`. */
export const stampTime = (at: string): string => {
    const time = Date.parse(at)
    return Number.isNaN(time) ? at : stamp.format(time)
}

export const progressPercent = (row: Pick<WorkflowRow, "done" | "total">): number =>
    row.total === 0 ? 0 : Math.round((row.done / row.total) * 100)

/** `agent · model · effort`, the way a member is named everywhere on these screens. */
export const memberText = (member: Member): string =>
    [member.agent, member.model, member.effort === null ? null : COMMON.effort(member.effort)]
        .filter((part) => part !== null)
        .join(" · ")

/** Elapsed time since an instant, as a short `6m` / `1h 4m` / `12s`. */
export const elapsedText = (since: string, now: number = Date.now()): string => {
    const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
    if (Number.isNaN(seconds)) return ""
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
