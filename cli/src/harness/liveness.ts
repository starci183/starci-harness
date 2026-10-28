import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parse } from "yaml"
import { z } from "zod"
import { Refusal } from "../shared/errors.js"
import { inTransaction, now } from "./ledger.js"
import { OrcaFailure, UNKNOWN_STATES, workerShow } from "./orca/client.js"
import type { OrcaBinary, TerminalInventory, WorkerShown } from "./orca/client.js"
import { locateOps } from "./ops.js"
import { CLOSED_SEAT_STATUSES, SEAT_WORKER_LOST, getSeat, recordSeat } from "./seats.js"
import type { SeatRow } from "./seats.js"
import { getTask, recordEvent, setStatus } from "./tasks.js"

const livenessSchema = z.object({
    schema: z.literal("starci/liveness@1"),
    launchGraceSeconds: z.number().nonnegative(),
    pingDeadlineSeconds: z.number().positive(),
    activeStaleMinutes: z.number().positive(),
    quietMinutes: z.number().positive(),
    goneStates: z.array(z.string().min(1)),
    goneErrors: z.array(z.string().min(1)),
    settleNoVerdictMax: z.number().int().positive(),
    verifyDeadlineMinutes: z.number().positive(),
})

/** ops/liveness.yaml, validated: the seat thresholds, the Orca answers that prove a worker gone, and the bound of a verify that reaches no verdict. */
export type Liveness = z.infer<typeof livenessSchema>

const loaded = new Map<string, Liveness>()

/** Loads and validates ops/liveness.yaml (STARCI_OPS_DIR honoured); read once per process. */
export const loadLiveness = (dir: string = locateOps()): Liveness => {
    const known = loaded.get(dir)
    if (known !== undefined) return known
    const file = join(dir, "liveness.yaml")
    let raw: unknown
    try {
        raw = parse(readFileSync(file, "utf8"))
    } catch (error: unknown) {
        throw new Refusal("OPS_INVALID", `${file} is not readable yaml: ${error instanceof Error ? error.message : String(error)}`)
    }
    const parsed = livenessSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("OPS_INVALID", `${file} is invalid: ${z.prettifyError(parsed.error)}`)
    // A state Orca uses for "I do not know" can never be evidence that a worker is gone.
    const unknown = parsed.data.goneStates.filter((state) => UNKNOWN_STATES.includes(state))
    if (unknown.length > 0) throw new Refusal("OPS_INVALID", `${file}: goneStates names unknown-outcome states ${unknown.join(", ")}; unknown is not dead`)
    loaded.set(dir, parsed.data)
    return parsed.data
}

/** What one ping learned: a pong (Orca shows the worker, not gone), Orca's explicit word it is gone, or nothing certain. */
export type PingAnswer =
    | { readonly kind: "pong"; readonly state: string; readonly lastOutputAt: string | null }
    | { readonly kind: "gone"; readonly evidence: string }
    | { readonly kind: "unknown"; readonly why: string }

const firstLine = (text: string): string => text.split("\n")[0] ?? text

/**
 * Asks Orca (worker-show, under the ping deadline) about one dispatch. Only a gone state, a gone observation or a typed gone
 * error is `gone`; an Orca that is down, slow, unreadable or unsure is `unknown`, never gone.
 */
export const askOrca = async (binary: OrcaBinary, handle: string, cwd: string, rules: Liveness): Promise<PingAnswer> => {
    try {
        const shown = await workerShow(binary, handle, cwd, rules.pingDeadlineSeconds * 1000)
        const gone = [shown.state, shown.observed].find((state): state is string => state !== null && rules.goneStates.includes(state))
        if (gone !== undefined) return { kind: "gone", evidence: `Orca worker-show says the worker is ${gone}` }
        if (shown.state === null || UNKNOWN_STATES.includes(shown.state)) return { kind: "unknown", why: `Orca shows worker state ${shown.state ?? "none"}` }
        return { kind: "pong", state: shown.state, lastOutputAt: shown.lastOutputAt }
    } catch (error: unknown) {
        if (error instanceof OrcaFailure && error.effect === "none" && error.orcaCode !== undefined && rules.goneErrors.includes(error.orcaCode)) {
            return { kind: "gone", evidence: `Orca worker-show answers ${error.orcaCode}` }
        }
        if (error instanceof Refusal) return { kind: "unknown", why: `${error.code}: ${firstLine(error.message)}` }
        throw error
    }
}

/** What recording a ping changed: the seat after it, and the task it marked effect_unknown when its worker was gone. */
export interface PingRecord {
    readonly seat: SeatRow
    readonly lostTask: string | null
}

/**
 * Records one ping's answer on its seat, in one transaction. Every ping stamps last_ping_at; a pong stamps last_pong_at, Orca's
 * last-output time (last_activity_at) when it gives one, and a changed worker state. A gone worker makes the seat worker-lost
 * and its running task effect_unknown, keeping its leases: what the worker wrote before it went is not known.
 */
export const recordPing = (db: DatabaseSync, seatId: string, answer: PingAnswer): PingRecord =>
    inTransaction(db, () => {
        const at = now()
        const seat = getSeat(db, seatId)
        db.prepare("UPDATE seats SET last_ping_at = ? WHERE id = ?").run(at, seat.id)
        if (answer.kind === "pong") {
            db.prepare("UPDATE seats SET last_pong_at = ?, last_activity_at = COALESCE(?, last_activity_at) WHERE id = ?").run(at, answer.lastOutputAt, seat.id)
            if (answer.state !== seat.status) recordSeat(db, seat.id, { status: answer.state, facts: { ping: "pong" } })
            return { seat: getSeat(db, seat.id), lostTask: null }
        }
        if (answer.kind === "unknown") {
            // One event when the seat stops answering, not one per unanswered tick.
            const answered = seat.lastPingAt === null || (seat.lastPongAt !== null && seat.lastPongAt >= seat.lastPingAt)
            if (answered) recordEvent(db, "seat-ping-unanswered", seat.id, { why: answer.why })
            return { seat: getSeat(db, seat.id), lostTask: null }
        }
        recordSeat(db, seat.id, { status: SEAT_WORKER_LOST, facts: { evidence: answer.evidence } })
        const task = seat.taskId === null ? null : getTask(db, seat.taskId)
        const lostTask = task?.status === "running" ? setStatus(db, task.id, "effect_unknown").id : null
        recordEvent(db, "worker-lost", seat.taskId ?? seat.id, { seat: seat.id, handle: seat.handle, evidence: answer.evidence, task: lostTask })
        return { seat: getSeat(db, seat.id), lostTask }
    })

/**
 * A seat's liveness, judged from its recorded facts only: closed, lost (Orca said gone), launching (younger than launchGrace,
 * no pong yet), quiet (pings unanswered for `quietMinutes`), stale (Orca answers, but its terminal printed nothing for
 * `activeStaleMinutes` before the last pong), live, or unknown (no answer yet, or the last ping unanswered).
 */
export type Verdict = "closed" | "lost" | "launching" | "quiet" | "stale" | "live" | "unknown"

/** A seat's verdict with the spans behind it, in seconds: unanswered pings (quiet) and output silence at the last pong (idle). */
export interface SeatLiveness {
    readonly verdict: Verdict
    readonly quietSeconds: number
    readonly idleSeconds: number | null
}

const ms = (iso: string): number => new Date(iso).getTime()

/** Judges one seat at `at` (epoch ms) from its ledger facts and the thresholds; asks nobody. */
export const livenessOf = (seat: SeatRow, rules: Liveness, at: number = Date.now()): SeatLiveness => {
    const started = ms(seat.startedAt)
    const pong = seat.lastPongAt === null ? null : ms(seat.lastPongAt)
    const ping = seat.lastPingAt === null ? null : ms(seat.lastPingAt)
    const quiet = ping !== null && (pong === null || ping > pong) ? ping - (pong ?? started) : 0
    const idle = pong !== null && seat.lastActivityAt !== null ? Math.max(0, pong - ms(seat.lastActivityAt)) : null
    const judged = (verdict: Verdict): SeatLiveness => ({ verdict, quietSeconds: Math.round(quiet / 1000), idleSeconds: idle === null ? null : Math.round(idle / 1000) })
    if (CLOSED_SEAT_STATUSES.includes(seat.status)) return judged("closed")
    if (seat.status === SEAT_WORKER_LOST) return judged("lost")
    if (pong === null && at - started < rules.launchGraceSeconds * 1000) return judged("launching")
    if (quiet >= rules.quietMinutes * 60_000) return judged("quiet")
    if (pong === null || (ping !== null && ping > pong)) return judged("unknown")
    if (idle !== null && idle >= rules.activeStaleMinutes * 60_000) return judged("stale")
    return judged("live")
}

/**
 * What a dispatch whose launch Orca completed without seeing it start has become. `started`: its worker started, or its agent
 * proved it alive (`alive`: a Kernel's attach), or its live terminal printed after the launch (a turn under way). `gone`: Orca
 * reports the worker gone. `dead`: it never started past the start deadline and Orca no longer lists its terminal. `quiet`: it
 * never started past the deadline but its terminal is still listed, or Orca did not answer the terminal list; a live terminal is
 * never fenced on an unverifiable start. `waiting`: still young, or Orca did not answer worker-show.
 */
export interface StartJudged {
    readonly verdict: "started" | "gone" | "dead" | "quiet" | "waiting"
    readonly states: readonly string[]
    readonly terminal: string | null
    readonly printed: string | null
}

/** The start rules a judgment reads (ops/liveness.yaml `stall`): the states that say the turn never started, and its deadline. */
export interface StartRules {
    readonly startUnknownStates: readonly string[]
    readonly startDeadlineMinutes: number
}

/** Judges a launched dispatch from worker-show (`shown`, null when Orca did not answer), the terminal list and the seat's launch; asks nobody. */
export const judgeStart = (input: { readonly shown: WorkerShown | null; readonly seat: SeatRow; readonly live: TerminalInventory | null; readonly alive: boolean }, start: StartRules, at: number = Date.now()): StartJudged => {
    const { shown, seat, live, alive } = input
    if (shown === null) return { verdict: "waiting", states: [], terminal: seat.terminal, printed: null }
    const states = [shown.state, shown.observed].filter((state): state is string => state !== null)
    const terminal = shown.terminal ?? seat.terminal
    const judged = (verdict: StartJudged["verdict"], printed: string | null = null): StartJudged => ({ verdict, states, terminal, printed })
    if (states.some((state) => loadLiveness().goneStates.includes(state))) return judged("gone")
    const listed = terminal !== null && (live === null || live.truncated || live.handles.has(terminal))
    const printed = [shown.lastOutputAt, terminal === null ? null : (live?.lastOutput.get(terminal) ?? null)]
        .filter((time): time is string => time !== null)
        .reduce<string | null>((latest, time) => (latest === null || ms(time) > ms(latest) ? time : latest), null)
    const turned = listed && printed !== null && ms(printed) > ms(seat.startedAt)
    const unstarted = states.some((state) => start.startUnknownStates.includes(state))
    if (alive || turned || (shown.state !== null && !unstarted && !UNKNOWN_STATES.includes(shown.state))) return judged("started", printed)
    if (!unstarted || at - ms(seat.startedAt) <= start.startDeadlineMinutes * 60_000) return judged("waiting", printed)
    return judged(listed ? "quiet" : "dead", printed)
}

/** True for a seat a ping can ask Orca about: open, with a dispatch, and not already lost. */
export const isPingable = (seat: SeatRow): boolean => seat.handle !== null && !CLOSED_SEAT_STATUSES.includes(seat.status) && seat.status !== SEAT_WORKER_LOST

/** True while a seat is younger than launchGrace: a step leaves it alone (an explicit `seat ping` still asks). */
export const inLaunchGrace = (seat: SeatRow, rules: Liveness, at: number = Date.now()): boolean => at - ms(seat.startedAt) < rules.launchGraceSeconds * 1000
