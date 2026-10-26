import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { ToolNotStarted, captureTool, probeTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"

/** The orca binary this host runs, and how it was found. */
export interface OrcaBinary {
    readonly path: string
    readonly source: "STARCI_ORCA_BIN" | "install" | "PATH"
}

/** The flags of one orca call by name; an undefined value is left out of argv. */
export type OrcaFlags = Readonly<Record<string, string | undefined>>

/**
 * What an orca call left behind when it did not succeed: `none` when Orca answered a typed refusal (or never started), so
 * nothing happened; `unknown` when the answer is missing, unreadable, timed out or says outcome_unknown. Unknown is never dead.
 */
export type OrcaEffect = "none" | "unknown"

/** Orca answered and refused, or answered something this CLI cannot read; `result` keeps what it said (a failed start names its dispatch). */
export class OrcaFailure extends Refusal {
    public readonly orcaCode: string | undefined
    public readonly result: unknown
    public readonly effect: OrcaEffect

    public constructor(message: string, orcaCode: string | undefined, result: unknown, effect: OrcaEffect) {
        super(effect === "unknown" ? "ORCA_OUTCOME_UNKNOWN" : "ORCA_FAILED", message)
        this.name = "OrcaFailure"
        this.orcaCode = orcaCode
        this.result = result
        this.effect = effect
    }
}

const TAIL_LINES = 10

/** The process deadline of an orca read or quick mutation. */
export const ORCA_TIMEOUT_MS = 30_000

/** The process deadline of worker-stop and worker-release, which wait for a terminal to settle. */
const SETTLE_TIMEOUT_MS = 60_000

/** How long worker-start may wait for a ready worker (its --timeout-ms) unless the caller names another. */
export const LAUNCH_TIMEOUT_MS = 120_000

/** How long past its own --timeout-ms a worker-start process is given to answer before it is killed. */
const LAUNCH_GRACE_MS = 15_000

/** Worker and request states in which Orca itself does not know what happened. */
export const UNKNOWN_STATES: readonly string[] = ["outcome_unknown", "unknown", "stop_unknown", "release_unknown", "unverifiable"]

/**
 * The namespace of every --retry-request id this CLI derives; fixed forever, so a restarted process derives the same id
 * (the legacy runtime's ORCA_REQUEST_NAMESPACE, so both sides agree on one identity scheme).
 */
const REQUEST_NAMESPACE = "96fe63b0-5b42-4411-8490-6b5ae7b7dcb2"

/**
 * The --retry-request id of one mutation: an RFC 9562 UUIDv8 (SHA-256 of the namespace and `<verb>\0<identity>`), because
 * Orca accepts only a UUID. It is derived from ledger identity only (an attempt id), never a clock, so a replay matches.
 */
export const requestIdOf = (verb: string, identity: string): string => {
    const bytes = createHash("sha256").update(Buffer.from(REQUEST_NAMESPACE.replaceAll("-", ""), "hex")).update(`${verb}\0${identity}`, "utf8").digest().subarray(0, 16)
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = bytes.toString("hex")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const installPath = (): string | undefined => {
    const local = process.env.LOCALAPPDATA
    if (process.platform !== "win32" || local === undefined) return undefined
    return join(local, "Programs", "orca", "resources", "bin", "orca.exe")
}

// On Linux a bare `orca` is the GNOME screen reader, so the Orca CLI is looked up there as orca-ide.
const pathName = (): string => (process.platform === "linux" ? "orca-ide" : "orca")

const existing = (file: string): string | undefined => [file, `${file}.exe`].find((candidate) => existsSync(candidate))

/** Finds orca: STARCI_ORCA_BIN (which must exist), else the desktop install, else PATH; refuses ORCA_MISSING. */
export const locateOrca = async (cwd: string): Promise<OrcaBinary> => {
    const override = process.env.STARCI_ORCA_BIN
    if (override !== undefined && override !== "") {
        const found = existing(override)
        if (found === undefined) throw new Refusal("ORCA_MISSING", `STARCI_ORCA_BIN names ${override}, which does not exist`)
        return { path: found, source: "STARCI_ORCA_BIN" }
    }
    const installed = installPath()
    if (installed !== undefined && existsSync(installed)) return { path: installed, source: "install" }
    const name = pathName()
    if ((await probeTool(name, ["--version"], cwd)) !== undefined) return { path: name, source: "PATH" }
    throw new Refusal("ORCA_MISSING", `no orca binary: set STARCI_ORCA_BIN, install the Orca app${installed === undefined ? "" : ` (${installed})`} or put ${name} on PATH`)
}

/** The argv of `orca orchestration <command>` with its flags and --json, in the order given. */
export const orcaArgv = (command: string, flags: OrcaFlags): string[] => [
    "orchestration",
    command,
    ...Object.entries(flags).flatMap(([name, value]) => (value === undefined ? [] : [`--${name}`, value])),
    "--json",
]

/**
 * Runs orca without a shell under a process deadline that kills its whole tree. A process that could not be spawned had no
 * effect and is a refusal naming the cause: ORCA_MISSING for ENOENT, ORCA_FAILED otherwise (EINVAL is what Windows answers for
 * a .cmd or .bat, which cannot run without a shell).
 */
const spawnOrca = async (binary: OrcaBinary, args: readonly string[], cwd: string, timeoutMs: number): Promise<ToolRun> => {
    try {
        return await captureTool(binary.path, args, cwd, { timeoutMs })
    } catch (error: unknown) {
        if (!(error instanceof ToolNotStarted)) throw error
        const hint = error.reason === "EINVAL" ? "; a .cmd or .bat cannot run without a shell, point STARCI_ORCA_BIN at orca.exe or node.exe" : ""
        throw new Refusal(error.reason === "ENOENT" ? "ORCA_MISSING" : "ORCA_FAILED", `${binary.path} (${binary.source}) could not be started: ${error.reason}${hint}`)
    }
}

const errorSchema = z.union([z.string(), z.looseObject({ code: z.string().optional(), message: z.string().optional() })])

/** Every orca --json reply: `{ok, result}` or `{ok: false, error: {code, message}}`, written to stdout even on a failure. */
const replySchema = z.looseObject({ ok: z.boolean(), result: z.unknown().optional(), error: errorSchema.optional() })

/** The parts of a failed receipt that decide whether the failure is certain. */
const receiptSchema = z.looseObject({
    state: z.string().nullish(),
    stage: z.unknown().optional(),
    failedStage: z.unknown().optional(),
    worker: z.looseObject({ state: z.string().nullish() }).nullish(),
})

const tail = (text: string): string => text.split(/\r?\n/).slice(-TAIL_LINES).join("\n")

const parseReply = (stdout: string): z.infer<typeof replySchema> | undefined => {
    try {
        const parsed = replySchema.safeParse(JSON.parse(stdout))
        return parsed.success ? parsed.data : undefined
    } catch {
        return undefined
    }
}

const errorParts = (error: z.infer<typeof errorSchema> | undefined): { readonly code: string | undefined; readonly text: string } => {
    if (error === undefined) return { code: undefined, text: "no error named" }
    if (typeof error === "string") return { code: undefined, text: error }
    const text = error.code !== undefined && error.message !== undefined ? `${error.code}: ${error.message}` : (error.code ?? error.message ?? JSON.stringify(error))
    return { code: error.code, text }
}

/** A refused call is certain only when Orca named why (a typed error or the stage that failed) and no state says unknown. */
const effectOfRefusal = (reply: z.infer<typeof replySchema>): OrcaEffect => {
    const receipt = receiptSchema.safeParse(reply.result)
    const states = receipt.success ? [receipt.data.state, receipt.data.worker?.state] : []
    if (states.some((state) => typeof state === "string" && UNKNOWN_STATES.includes(state))) return "unknown"
    const named = typeof reply.error === "object" ? reply.error.code !== undefined : reply.error !== undefined
    const staged = receipt.success && (receipt.data.failedStage !== undefined || receipt.data.stage !== undefined)
    return named || staged ? "none" : "unknown"
}

const stderrNote = (run: ToolRun): string => (run.stderr === "" ? "" : `\nstderr:\n${tail(run.stderr)}`)

/** Runs one orca orchestration call without a shell under a deadline and returns its validated result; anything else is an OrcaFailure saying whether it had an effect. */
const callOrca = async <T>(binary: OrcaBinary, command: string, flags: OrcaFlags, schema: z.ZodType<T>, cwd: string, timeoutMs: number = ORCA_TIMEOUT_MS): Promise<T> => {
    const run = await spawnOrca(binary, orcaArgv(command, flags), cwd, timeoutMs)
    const label = `orca orchestration ${command}`
    if (run.timedOut) throw new OrcaFailure(`${label} gave no answer within ${String(timeoutMs)} ms and was killed; its effect is unknown${stderrNote(run)}`, undefined, undefined, "unknown")
    const reply = parseReply(run.stdout)
    if (reply === undefined) {
        const output = run.stdout === "" ? "" : `\nstdout:\n${tail(run.stdout)}`
        throw new OrcaFailure(`${label} gave no json reply (exit ${String(run.exitCode)}); its effect is unknown${output}${stderrNote(run)}`, undefined, undefined, "unknown")
    }
    if (!reply.ok || run.exitCode !== 0) {
        const { code, text } = errorParts(reply.error)
        throw new OrcaFailure(`${label} failed (exit ${String(run.exitCode)}): ${text}${stderrNote(run)}`, code, reply.result, effectOfRefusal(reply))
    }
    const parsed = schema.safeParse(reply.result)
    if (!parsed.success) throw new OrcaFailure(`${label} answered a result this CLI does not understand: ${z.prettifyError(parsed.error)}`, undefined, reply.result, "unknown")
    return parsed.data
}

/**
 * Titles a terminal tab (`orca terminal rename`), so a seat reads `[Op] <task>` instead of Orca's generated name.
 * Best effort: the title is presentation, so a failure is returned as text and never fails the caller.
 */
export const terminalRename = async (binary: OrcaBinary, handle: string, title: string, cwd: string): Promise<string | undefined> => {
    try {
        const run = await spawnOrca(binary, ["terminal", "rename", "--terminal", handle, "--title", title, "--json"], cwd, ORCA_TIMEOUT_MS)
        const reply = parseReply(run.stdout)
        if (run.exitCode === 0 && reply?.ok === true) return undefined
        return `orca terminal rename failed (exit ${String(run.exitCode)}): ${errorParts(reply?.error).text}`
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
    }
}

/** What run-create needs: the Run's objective, inside an Orca terminal the coordinator handle, and the replay id. */
export interface RunCreateInput {
    readonly objective: string
    readonly from?: string | undefined
    readonly retryRequest?: string | undefined
}

/** The flags of run-create, shared by the call and its dry run. */
export const runCreateFlags = (input: RunCreateInput): OrcaFlags => ({ objective: input.objective, from: input.from, "retry-request": input.retryRequest })

const runCreateSchema = z.looseObject({ run: z.looseObject({ id: z.string().min(1) }) })

/** `orca orchestration run-create`: a Run to start workers in; returns its id (result.run.id). */
export const runCreate = async (binary: OrcaBinary, input: RunCreateInput, cwd: string): Promise<string> =>
    (await callOrca(binary, "run-create", runCreateFlags(input), runCreateSchema, cwd)).run.id

/** What worker-start needs: the short spec, where, which agent and model, in which Run, how long to wait and the replay id. */
export interface WorkerStartInput {
    readonly spec: string
    readonly taskTitle: string
    readonly worktree: string
    readonly agent: string
    readonly model: string
    readonly effort?: string | undefined
    readonly run?: string | undefined
    readonly from?: string | undefined
    readonly timeoutMs: number
    readonly retryRequest: string
}

/** The flags of worker-start, shared by the call and its dry run. --spec makes Orca create the worker's Task in the same call. */
export const workerStartFlags = (input: WorkerStartInput): OrcaFlags => ({
    spec: input.spec,
    "task-title": input.taskTitle,
    worktree: input.worktree,
    agent: input.agent,
    model: input.model,
    effort: input.effort,
    "timeout-ms": String(input.timeoutMs),
    run: input.run,
    from: input.from,
    "retry-request": input.retryRequest,
})

const effectiveSchema = z.looseObject({ launch: z.looseObject({ effective: z.unknown() }).nullish() })

const workerStartSchema = z.looseObject({
    dispatchId: z.string().min(1),
    taskId: z.string().nullish(),
    runId: z.string().nullish(),
    state: z.string().nullish(),
    worker: z.looseObject({ agentTerminalHandle: z.string().nullish(), state: z.string().nullish() }).nullish(),
    launch: z.looseObject({ effective: z.unknown() }).nullish(),
})

/** A worker Orca reports ready. */
export interface WorkerStarted {
    readonly dispatchId: string
    readonly taskId: string | null
    readonly runId: string | null
    readonly state: string
    readonly terminal: string | null
    readonly effective: unknown
}

/**
 * `orca orchestration worker-start`: Orca exits 0 only for a ready worker. A refusal with a named cause is an OrcaFailure with
 * effect `none`; outcome_unknown, a lost or unreadable receipt, a timeout or an exit 0 without `ready` is effect `unknown`.
 */
export const workerStart = async (binary: OrcaBinary, input: WorkerStartInput, cwd: string): Promise<WorkerStarted> => {
    const result = await callOrca(binary, "worker-start", workerStartFlags(input), workerStartSchema, cwd, input.timeoutMs + LAUNCH_GRACE_MS)
    const state = result.state ?? result.worker?.state ?? null
    if (state !== "ready") throw new OrcaFailure(`orca orchestration worker-start exited 0 with worker state ${state ?? "none"}, not ready; its effect is unknown`, undefined, result, "unknown")
    return {
        dispatchId: result.dispatchId,
        taskId: result.taskId ?? null,
        runId: result.runId ?? null,
        state,
        terminal: result.worker?.agentTerminalHandle ?? null,
        effective: result.launch?.effective ?? null,
    }
}

const failedStartSchema = z.looseObject({ dispatchId: z.string().min(1) })

/** The dispatch a failed worker-start still names (it may have left a terminal behind), if any. */
export const dispatchOfFailure = (failure: OrcaFailure): string | undefined => {
    const parsed = failedStartSchema.safeParse(failure.result)
    return parsed.success ? parsed.data.dispatchId : undefined
}

const launchSchema = z.looseObject({
    agent: z.string().nullish(),
    model: z.string().nullish(),
    modelId: z.string().nullish(),
    effort: z.string().nullish(),
})

/** The agent, model and effort an effective launch names; null where Orca named nothing (no attestation, not a mismatch). */
export interface EffectiveLaunch {
    readonly agent: string | null
    readonly model: string | null
    readonly effort: string | null
}

/**
 * Reads Orca's `launch.effective` receipt, which spells the model as model or modelId. Only an `agent` field names the agent:
 * a provider (anthropic, openai) is not an Orca agent id and attests nothing about it.
 */
export const effectiveLaunch = (effective: unknown): EffectiveLaunch => {
    const parsed = launchSchema.safeParse(effective)
    if (!parsed.success) return { agent: null, model: null, effort: null }
    return { agent: parsed.data.agent ?? null, model: parsed.data.model ?? parsed.data.modelId ?? null, effort: parsed.data.effort ?? null }
}

const workerShowSchema = z.looseObject({
    dispatch: z.looseObject({ id: z.string().nullish(), assigneeHandle: z.string().nullish() }).nullish(),
    worker: z
        .looseObject({
            state: z.string().nullish(),
            agentTerminalHandle: z.string().nullish(),
            startOptions: effectiveSchema.nullish(),
            start_options: z.string().nullish(),
        })
        .nullish(),
    launch: z.looseObject({ effective: z.unknown() }).nullish(),
    observation: z.looseObject({ status: z.string().nullish(), lastOutputAt: z.union([z.number(), z.string()]).nullish() }).nullish(),
    terminal: z.looseObject({ lastOutputAt: z.union([z.number(), z.string()]).nullish() }).nullish(),
})

/**
 * One worker as Orca shows it: its state, its terminal, the agent and model it really launched, what Orca observed of its
 * process (observation.status, e.g. exited) and when its terminal last printed, when Orca says so (ISO time, else null).
 */
export interface WorkerShown {
    readonly dispatchId: string | null
    readonly state: string | null
    readonly terminal: string | null
    readonly effective: unknown
    readonly observed: string | null
    readonly lastOutputAt: string | null
}

// Orca writes a time as epoch milliseconds or as text; anything that is not a valid time is no evidence.
const isoOf = (value: number | string | null | undefined): string | null => {
    if (value === null || value === undefined) return null
    const time = new Date(value)
    return Number.isNaN(time.getTime()) ? null : time.toISOString()
}

// Older receipts carry the launch as a json string in worker.start_options; malformed text is no attestation.
const effectiveFromText = (text: string | null | undefined): unknown => {
    if (text === null || text === undefined) return null
    try {
        const parsed = effectiveSchema.safeParse(JSON.parse(text))
        return parsed.success ? (parsed.data.launch?.effective ?? null) : null
    } catch {
        return null
    }
}

/** `orca orchestration worker-show`: the worker's state and its effective launch, never inferred from titles or terminal text. */
export const workerShow = async (binary: OrcaBinary, dispatchId: string, cwd: string, timeoutMs: number = ORCA_TIMEOUT_MS): Promise<WorkerShown> => {
    const result = await callOrca(binary, "worker-show", { dispatch: dispatchId }, workerShowSchema, cwd, timeoutMs)
    return {
        observed: result.observation?.status ?? null,
        lastOutputAt: isoOf(result.observation?.lastOutputAt ?? result.terminal?.lastOutputAt),
        dispatchId: result.dispatch?.id ?? dispatchId,
        state: result.worker?.state ?? null,
        terminal: result.worker?.agentTerminalHandle ?? result.dispatch?.assigneeHandle ?? null,
        effective: result.launch?.effective ?? result.worker?.startOptions?.launch?.effective ?? effectiveFromText(result.worker?.start_options),
    }
}

const stateSchema = z.looseObject({ state: z.string().min(1) })

/** `orca orchestration worker-stop`: fences the dispatch and stops its agent terminal; returns the worker state after the stop. */
export const workerStop = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<string> =>
    (await callOrca(binary, "worker-stop", { dispatch: dispatchId }, stateSchema, cwd, SETTLE_TIMEOUT_MS)).state

/** `orca orchestration worker-release`: closes a settled worker's terminal (released, already_released, retained or release_pending). */
export const workerRelease = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<string> =>
    (await callOrca(binary, "worker-release", { dispatch: dispatchId }, stateSchema, cwd, SETTLE_TIMEOUT_MS)).state

/**
 * What closing a worker did: each step's state word, or `error: <why>`. `stopped` when Orca fenced the worker (it can write no
 * more), `settled` when it also released the terminal.
 */
export interface WorkerClosed {
    readonly dispatchId: string
    readonly stop: string
    readonly release: string
    readonly stopped: boolean
    readonly settled: boolean
}

const RELEASED_STATES: readonly string[] = ["released", "already_released"]

const stateOrError = async (step: Promise<string>): Promise<string> => step.catch((error: unknown) => `error: ${error instanceof Error ? error.message : String(error)}`)

/** Stops then releases one worker; both steps always run (release is idempotent), so a half-closed worker is finished on a repeat. */
export const closeWorker = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<WorkerClosed> => {
    const stop = await stateOrError(workerStop(binary, dispatchId, cwd))
    const release = await stateOrError(workerRelease(binary, dispatchId, cwd))
    const settled = RELEASED_STATES.includes(release)
    const stopped = settled || (!stop.startsWith("error: ") && !UNKNOWN_STATES.includes(stop))
    return { dispatchId, stop, release, stopped, settled }
}
