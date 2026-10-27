import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { classifyFailure, recordOutcome } from "./circuit.js"
import { olderThan } from "./coordinator-liveness.js"
import { loadLiveness } from "./liveness.js"
import { now } from "./ledger.js"
import { inTransaction } from "./leases.js"
import { locateOps } from "./ops.js"
import { requestIdOf, terminalSend, terminalWaitIdle, workerShow } from "./orca/client.js"
import type { OrcaBinary, TerminalInventory } from "./orca/client.js"
import { loadRouting, poolOfAgent, providerOfAgent } from "./routing.js"
import { recordEvent } from "./tasks.js"
import type { FailureKind } from "./routing.js"

const stallSchema = z.strictObject({
    idleMinutes: z.number().nonnegative(),
    tuiIdleWaitMs: z.number().int().positive(),
    quietMinutes: z.number().positive(),
    nudgeMax: z.number().int().nonnegative(),
    nudgeGraceMinutes: z.number().nonnegative(),
    watchSeconds: z.number().int().positive(),
    startUnknownStates: z.array(z.string().min(1)),
    startDeadlineMinutes: z.number().nonnegative(),
    prompts: z.strictObject({ supervisor: z.string().min(1), kernel: z.string().min(1), op: z.string().min(1) }),
})

/** The `stall` block of ops/liveness.yaml: when an agent idle at its prompt counts as stalled, and the ladder's bounds. */
export type StallRules = z.infer<typeof stallSchema>

const loaded = new Map<string, StallRules>()

/** Loads and validates the `stall` block of ops/liveness.yaml (STARCI_OPS_DIR honoured); read once per process. */
export const loadStallRules = (dir: string = locateOps()): StallRules => {
    const known = loaded.get(dir)
    if (known !== undefined) return known
    const file = join(dir, "liveness.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = z.looseObject({ stall: stallSchema }).safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} stall block is invalid: ${z.prettifyError(parsed.error)}`)
    loaded.set(dir, parsed.data.stall)
    return parsed.data.stall
}

/** The event a nudge records (subject: the seat's workflow or task; data.seat names the seat); never progress of the work. */
export const STALL_NUDGED = "stall-nudged"

/** The event the ladder records when it gives a seat up (relaunch or fence on another member); never progress of the work. */
export const STALL_GAVE_UP = "stall-gave-up"

/** What Orca says of an agent's terminal: idle at its prompt (true), working (false) or unknown (null, never idle). */
export interface IdleSignals {
    readonly idle: boolean | null
    /** The newest time Orca saw the agent act: its terminal output or its dispatch heartbeat. */
    readonly lastActive: string | null
    readonly evidence: readonly string[]
    /** Orca's structured words for why the agent waits or failed (worker-show), for the failure signals. */
    readonly failureText: string | null
}

const newest = (times: readonly (string | null | undefined)[]): string | null =>
    times.filter((time): time is string => typeof time === "string").sort((a, b) => b.localeCompare(a))[0] ?? null

/**
 * Asks Orca whether the agent of a live seat sits idle at its prompt, from Orca's own signals only, never a terminal screen:
 * `terminal wait --for tui-idle` satisfied, or no terminal output and no dispatch heartbeat for quietMinutes (the terminal list's
 * lastOutputAt, worker-show's lastOutputAt and lastHeartbeatAt). A terminal Orca no longer lists, or a worker it reports gone,
 * is the gone ladder's (relaunch, lost), so it is unknown here.
 */
export const askIdle = async (binary: OrcaBinary, cwd: string, seat: { readonly terminal: string; readonly handle: string | null }, inventory: TerminalInventory | null, rules: StallRules): Promise<IdleSignals> => {
    if (inventory !== null && !inventory.truncated && !inventory.handles.has(seat.terminal)) return { idle: null, lastActive: null, evidence: ["terminal not listed"], failureText: null }
    const shown = seat.handle === null ? null : await workerShow(binary, seat.handle, cwd).catch(() => null)
    const gone = loadLiveness().goneStates
    if (shown !== null && [shown.state, shown.observed].some((state) => state !== null && gone.includes(state))) return { idle: null, lastActive: null, evidence: [`worker ${shown.state ?? shown.observed ?? "?"}`], failureText: shown.failureText }
    const lastActive = newest([inventory?.lastOutput.get(seat.terminal), shown?.lastOutputAt, shown?.heartbeatAt])
    const quiet = lastActive !== null && olderThan(lastActive, rules.quietMinutes)
    const tui = await terminalWaitIdle(binary, seat.terminal, rules.tuiIdleWaitMs, cwd)
    const quietNote = quiet ? ", quiet past " + String(rules.quietMinutes) + " min" : ""
    const evidence = [`tui-idle ${tui}`, `last active ${lastActive ?? "unknown"}${quietNote}`]
    // Idle on either word; unknown only when the TUI cannot tell and nothing was ever seen active.
    let idle: boolean | null = tui === "idle" || quiet
    if (!idle && tui === "unknown" && lastActive === null) idle = null
    return { idle, lastActive, evidence, failureText: shown?.failureText ?? null }
}

/** The ladder's next remedy for a stalled seat, from its last driver call and the nudges it already got. */
export type StallStep =
    | { readonly kind: "wait"; readonly detail: string }
    | { readonly kind: "nudge"; readonly n: number }
    | { readonly kind: "give-up"; readonly detail: string }

/**
 * The stall ladder, cheapest first, for a seat stalled now (idle at its prompt with its work pending): a nudge not yet answered
 * by a driver call waits nudgeGraceMinutes, then gives up (relaunch or fence on another member); a seat already nudged
 * nudgeMax times gives up at its next stall; otherwise it is nudged once more.
 */
export const stallStep = (lastCall: string | null, nudges: readonly string[], rules: StallRules, at: number = Date.now()): StallStep => {
    const lastNudge = newest(nudges)
    if (lastNudge !== null && (lastCall === null || lastNudge > lastCall)) {
        return olderThan(lastNudge, rules.nudgeGraceMinutes, at) ? { kind: "give-up", detail: `nudge ${String(nudges.length)} unanswered for ${String(rules.nudgeGraceMinutes)} min` } : { kind: "wait", detail: `nudged at ${lastNudge}` }
    }
    if (nudges.length >= rules.nudgeMax) return { kind: "give-up", detail: `stalled again after ${String(nudges.length)} nudge(s)` }
    return { kind: "nudge", n: nudges.length + 1 }
}

/** The times of the nudges a seat got, from the ledger's stall-nudged events. */
export const nudgesOf = (db: DatabaseSync, seatId: string): string[] =>
    db
        .prepare(`SELECT at FROM events WHERE kind = '${STALL_NUDGED}' AND json_extract(data_json, '$.seat') = ? ORDER BY id`)
        .all(seatId)
        .map((row) => String(row.at))

/**
 * Claims nudge `n` of a seat before it is sent: recorded only when the seat has exactly n-1 nudges, in one transaction, so two
 * drivers sweeping at once (a tick and a `next`) never type the same prompt twice. False when another driver claimed it.
 */
export const claimNudge = (db: DatabaseSync, subject: string, seatId: string, n: number, data: Readonly<Record<string, unknown>>): boolean =>
    inTransaction(db, () => {
        if (nudgesOf(db, seatId).length !== n - 1) return false
        recordEvent(db, STALL_NUDGED, subject, { ...data, seat: seatId, n })
        return true
    })

/** Fills a loop prompt's {workflow}, {task} and {launch}. */
export const promptOf = (template: string, fill: Readonly<Record<string, string>>): string => template.replaceAll(/\{(\w+)\}/g, (whole, name: string) => fill[name] ?? whole)

/** Types the seat's loop prompt into its terminal once (`terminal send`, replay-safe by its seat and nudge number). */
export const sendNudge = async (binary: OrcaBinary, cwd: string, seat: { readonly id: string; readonly terminal: string }, n: number, text: string): Promise<void> => {
    await terminalSend(binary, { terminal: seat.terminal, text, retryRequest: requestIdOf("stall-nudge", `${seat.id}\0${String(n)}`) }, cwd)
}

/** The provider failure kind a stalled seat reports: the failure signal Orca's words name (capacity, rate, quota, auth), else `stall`. */
export const stallKindOf = (failureText: string | null): StallKind => {
    if (failureText === null) return "stall"
    const kind = classifyFailure(loadRouting(), failureText)
    return kind === "launch" ? "stall" : kind
}

/** Why a seat stalled: a provider failure its words name, or "stall", the model's own idleness. */
export type StallKind = FailureKind | "stall"

/**
 * Reports a seat the ladder gave up on to its provider's circuit (and pool concurrency for rate and capacity) when a provider
 * failure caused it. A plain stall is the model's behaviour: its member's stalled outcome lowers its score, and the provider
 * stays open for every other member and seat.
 */
export const reportStalled = (agent: string, kind: StallKind, detail: string, at: string = now()): void => {
    if (kind === "stall") return
    const routing = loadRouting()
    recordOutcome(providerOfAgent(routing, agent), { kind, pool: poolOfAgent(routing, agent), detail }, at)
}
