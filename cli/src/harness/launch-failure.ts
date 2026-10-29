import type { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import type { Refusal } from "../shared/errors.js"
import { classifyFailure } from "./circuit.js"
import { openDecisions, raiseDecision } from "./coordinator-commands.js"
import type { Decision } from "./coordinator-commands.js"
import { openLedger } from "./ledger.js"
import { OrcaFailure, terminalOfFailure, terminalRead, terminalSubmit } from "./orca/client.js"
import { recordEvent } from "./tasks.js"
import type { OrcaBinary } from "./orca/client.js"
import type { FailureKind, Routing } from "./routing.js"

/** The failure kind of a launch whose agent waits at a host or config prompt (routing.yaml blockedPrompts): never a provider strike. */
export const BLOCKED_PROMPT = "blocked-prompt"

/** Orca's worker-start stage that waits for the launched agent to be ready; only its failure reads the agent's screen. */
const READINESS_STAGE = "agent_readiness"

/**
 * Why a launch certainly failed, as a seat keeps it (seats.failure_json): the kind (a provider failure kind of routing.yaml, or
 * blocked-prompt), the stage Orca failed at and its own error, the blocking prompt's name, and the agent terminal with the last
 * non-empty lines of its screen (null when it was not read, with the reason in `screenNote`).
 */
export interface LaunchFailure {
    readonly kind: FailureKind | "stall" | typeof BLOCKED_PROMPT
    readonly stage: string | null
    readonly error: string
    readonly prompt: string | null
    readonly terminal: string | null
    readonly screen: readonly string[] | null
    readonly screenNote: string | null
}

const receiptSchema = z.looseObject({ failedStage: z.string().nullish(), stage: z.string().nullish(), lastError: z.string().nullish() })

/** The blockedPrompts name the screen shows (the first that matches, in the order routing.yaml lists them), or null. */
export const blockedPromptOf = (routing: Routing, screen: readonly string[]): string | null => {
    const text = screen.join("\n")
    return Object.entries(routing.blockedPrompts.prompts).find(([, patterns]) => patterns.some((pattern) => new RegExp(pattern, "i").test(text)))?.[0] ?? null
}

/** The last `count` non-empty lines of a screen, trimmed at the end. */
const lastLines = (rows: readonly string[], count: number): string[] =>
    rows
        .map((row) => row.trimEnd())
        .filter((row) => row.trim() !== "")
        .slice(-count)

/**
 * Explains a launch Orca certainly failed. A failure at agent_readiness whose receipt names the agent terminal it created has
 * that terminal's screen read once (`orca terminal read`, before the worker is released); a screen at one of routing.yaml's
 * blockedPrompts is a blocked-prompt failure, anything else is classified from Orca's typed error by failureSignals.
 */
export const explainLaunchFailure = async (binary: OrcaBinary, error: Refusal, cwd: string, routing: Routing): Promise<LaunchFailure> => {
    const orca = error instanceof OrcaFailure ? error : null
    const receipt = receiptSchema.safeParse(orca?.result).data
    const stage = receipt?.failedStage ?? receipt?.stage ?? null
    const terminal = orca === null ? null : (terminalOfFailure(orca) ?? null)
    const kind = classifyFailure(routing, `${orca?.orcaCode ?? ""} ${error.message}`)
    const base = { stage, error: receipt?.lastError ?? error.message.split("\n")[0] ?? error.message, terminal }
    if (stage !== READINESS_STAGE || terminal === null) {
        const screenNote = stage === READINESS_STAGE ? "the receipt names no agent terminal" : "not a readiness failure"
        return { ...base, kind, prompt: null, screen: null, screenNote }
    }
    const lines = routing.blockedPrompts.screenLines
    // A screen holds blank rows below the prompt, so twice the lines kept are read.
    const rows = await terminalRead(binary, terminal, lines * 2, cwd).then(
        (read) => read ?? "the terminal is gone",
        (failure: unknown) => `orca terminal read failed: ${failure instanceof Error ? (failure.message.split("\n")[0] ?? "") : String(failure)}`,
    )
    if (typeof rows === "string") return { ...base, kind, prompt: null, screen: null, screenNote: rows }
    const screen = lastLines(rows, lines)
    const prompt = blockedPromptOf(routing, screen)
    return { ...base, kind: prompt === null ? kind : BLOCKED_PROMPT, prompt, screen, screenNote: null }
}

/**
 * The screen row that shows a pasted dispatch, wherever the marker sits on it (an agent draws it after its prompt glyph and
 * any text before it); a marker the screen wrapped over two rows is found on the pair joined back.
 */
export const pastedLine = (rows: readonly string[], patterns: readonly string[]): string | undefined => {
    const shows = (text: string): boolean => patterns.some((pattern) => new RegExp(pattern, "i").test(text))
    for (const [index, row] of rows.entries()) {
        if (shows(row)) return row
        const next = rows[index + 1]
        if (next !== undefined && (shows(`${row.trimEnd()}${next.trimStart()}`) || shows(`${row.trimEnd()} ${next.trimStart()}`))) return `${row.trimEnd()} ${next.trimStart()}`
    }
    return undefined
}

/** The event a composer re-submit records on its seat (data: the attempt number, the terminal, the matching line). */
export const COMPOSER_RESUBMITTED = "seat-composer-resubmitted"

/**
 * Submits a dispatch left pasted in its agent's composer (routing.yaml pendingComposer): reads the seat's terminal screen once
 * and, when its last lines show the paste, records a COMPOSER_RESUBMITTED event and then sends a bare Enter, at most
 * resubmitMax times per seat (the recorded count, not a request id, bounds the replays: Orca takes none on a bare Enter). Returns
 * what it did, or null when the screen showed no paste, the terminal is unreadable, the re-submits are spent or Orca refused
 * the Enter; a refusal never fails the caller's step.
 */
export const resubmitPendingComposer = async (binary: OrcaBinary, cwd: string, root: string, seat: { readonly id: string; readonly terminal: string | null }, routing: Routing): Promise<string | null> => {
    if (seat.terminal === null) return null
    const { resubmitMax, patterns } = routing.pendingComposer
    const sent = withLedgerOf(root, (db) => Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = ? AND subject = ?").get(COMPOSER_RESUBMITTED, seat.id)?.n ?? 0))
    if (sent >= resubmitMax) return null
    const rows = await terminalRead(binary, seat.terminal, routing.blockedPrompts.screenLines * 2, cwd).catch(() => null)
    const line = rows === null ? undefined : pastedLine(lastLines(rows, routing.blockedPrompts.screenLines), patterns)
    if (line === undefined) return null
    const terminal = seat.terminal
    withLedgerOf(root, (db) => { recordEvent(db, COMPOSER_RESUBMITTED, seat.id, { n: sent + 1, terminal, line: line.trim() }); })
    const submitted = await terminalSubmit(binary, { terminal }, cwd).then(() => true, () => false)
    if (!submitted) return null
    return `its dispatch sat pasted in the composer of ${terminal} ("${line.trim()}"): submitted again (${String(sent + 1)} of ${String(resubmitMax)})`
}

const withLedgerOf = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/**
 * The failure of a dispatch Orca completed but whose worker never started its turn (dead on arrival): the kind its stall report
 * carries, the states Orca showed and its failure text. Its screen is not read; only a readiness failure's is.
 */
export const deadOnArrivalFailure = (kind: FailureKind | "stall", states: readonly string[], failure: string | null, terminal: string | null): LaunchFailure => ({
    kind,
    stage: "dead-on-arrival",
    error: failure ?? `never started (${states.join("/") || "no answer"})`,
    prompt: null,
    terminal,
    screen: null,
    screenNote: "dead on arrival, not a readiness failure",
})

/** The failure as one launch-error line, with the screen read below it. */
export const failureText = (failure: LaunchFailure): string => {
    const head = failure.prompt === null ? `${failure.kind} at ${failure.stage ?? "launch"}: ${failure.error}` : `${BLOCKED_PROMPT} (${failure.prompt}) at ${failure.stage ?? "launch"}: the agent waits at a prompt on its terminal ${failure.terminal ?? "?"}`
    const screen = failure.screen === null ? [`screen: not read (${failure.screenNote ?? "?"})`] : ["screen:", ...failure.screen.map((line) => "  | " + line)]
    return [head, ...screen].join("\n")
}

const BLOCKED_SUBJECT = "blocked-prompt:"

/**
 * Raises the Supervisor's `harness` escalation of a launch blocked at a prompt, once per prompt and worktree of a workflow: the
 * agent waits at a host or config dialog that no relaunch clears, so someone must answer it or change the host's config.
 */
export const escalateBlockedPrompt = (db: DatabaseSync, input: { readonly project: string; readonly workflowId: string; readonly seat: string; readonly worktree: string; readonly failure: LaunchFailure }): string =>
    raiseDecision(db, {
        scope: "supervisor",
        workflowId: input.workflowId,
        kind: "escalation",
        subject: `${BLOCKED_SUBJECT}${input.failure.prompt ?? "?"}:${input.worktree}`,
        evidence: {
            project: input.project,
            seat: input.seat,
            failure: input.failure,
            escalation: {
                kind: "harness",
                question: `seat ${input.seat}'s agent could not start: it waits at a ${input.failure.prompt ?? "?"} prompt in worktree ${input.worktree} (terminal ${input.failure.terminal ?? "?"}): "${input.failure.screen?.at(-1) ?? ""}". Answer or remove the prompt in that worktree's agent config; the provider is not at fault.`,
            },
        },
    })

/** The open blocked-prompt escalations of a ledger, oldest first: what the tick and seat list name loudly until answered. */
export const openBlockedPrompts = (db: DatabaseSync): Decision[] => openDecisions(db, "supervisor").filter((decision) => decision.subject.startsWith(BLOCKED_SUBJECT))
