import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { captureTool, probeTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"

/** The orca binary this host runs, and how it was found. */
export interface OrcaBinary {
    readonly path: string
    readonly source: "STARCI_ORCA_BIN" | "install" | "PATH"
}

/** The flags of one orca call by name; an undefined value is left out of argv. */
export type OrcaFlags = Readonly<Record<string, string | undefined>>

/** Orca answered and refused, or answered something this CLI cannot read; `result` keeps what it said (a failed start names its dispatch). */
export class OrcaFailure extends Refusal {
    public readonly orcaCode: string | undefined
    public readonly result: unknown

    public constructor(message: string, orcaCode: string | undefined, result: unknown) {
        super("ORCA_FAILED", message)
        this.name = "OrcaFailure"
        this.orcaCode = orcaCode
        this.result = result
    }
}

const TAIL_LINES = 10

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

const errorSchema = z.union([z.string(), z.looseObject({ code: z.string().optional(), message: z.string().optional() })])

/** Every orca --json reply: `{ok, result}` or `{ok: false, error: {code, message}}`, written to stdout even on a failure. */
const replySchema = z.looseObject({ ok: z.boolean(), result: z.unknown().optional(), error: errorSchema.optional() })

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

const stderrNote = (run: ToolRun): string => (run.stderr === "" ? "" : `\nstderr:\n${tail(run.stderr)}`)

/** Runs one orca orchestration call without a shell and returns its validated result; any refusal or unreadable reply is ORCA_FAILED. */
const callOrca = async <T>(binary: OrcaBinary, command: string, flags: OrcaFlags, schema: z.ZodType<T>, cwd: string): Promise<T> => {
    let run: ToolRun
    try {
        run = await captureTool(binary.path, orcaArgv(command, flags), cwd)
    } catch (error: unknown) {
        if (error instanceof Refusal && error.code === "CLI_TOOL_MISSING") throw new Refusal("ORCA_MISSING", `${binary.path} could not be started (${binary.source})`)
        throw error
    }
    const label = `orca orchestration ${command}`
    const reply = parseReply(run.stdout)
    if (reply === undefined) {
        const output = run.stdout === "" ? "" : `\nstdout:\n${tail(run.stdout)}`
        throw new OrcaFailure(`${label} gave no json reply (exit ${String(run.exitCode)})${output}${stderrNote(run)}`, undefined, undefined)
    }
    if (!reply.ok || run.exitCode !== 0) {
        const { code, text } = errorParts(reply.error)
        throw new OrcaFailure(`${label} failed (exit ${String(run.exitCode)}): ${text}${stderrNote(run)}`, code, reply.result)
    }
    const parsed = schema.safeParse(reply.result)
    if (!parsed.success) throw new OrcaFailure(`${label} answered a result this CLI does not understand: ${z.prettifyError(parsed.error)}`, undefined, reply.result)
    return parsed.data
}

/** What run-create needs: the Run's objective and, inside an Orca terminal, the coordinator handle. */
export interface RunCreateInput {
    readonly objective: string
    readonly from?: string | undefined
}

/** The flags of run-create, shared by the call and its dry run. */
export const runCreateFlags = (input: RunCreateInput): OrcaFlags => ({ objective: input.objective, from: input.from })

const runCreateSchema = z.looseObject({ run: z.looseObject({ id: z.string().min(1) }) })

/** `orca orchestration run-create`: a Run to start workers in; returns its id (result.run.id). */
export const runCreate = async (binary: OrcaBinary, input: RunCreateInput, cwd: string): Promise<string> =>
    (await callOrca(binary, "run-create", runCreateFlags(input), runCreateSchema, cwd)).run.id

/** What worker-start needs: the short spec, where, which agent and model, and in which Run. */
export interface WorkerStartInput {
    readonly spec: string
    readonly taskTitle: string
    readonly worktree: string
    readonly agent: string
    readonly model: string
    readonly effort?: string | undefined
    readonly run?: string | undefined
    readonly from?: string | undefined
}

/** The flags of worker-start, shared by the call and its dry run. --spec makes Orca create the worker's Task in the same call. */
export const workerStartFlags = (input: WorkerStartInput): OrcaFlags => ({
    spec: input.spec,
    "task-title": input.taskTitle,
    worktree: input.worktree,
    agent: input.agent,
    model: input.model,
    effort: input.effort,
    run: input.run,
    from: input.from,
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

/** `orca orchestration worker-start`: Orca exits 0 only for a ready worker; anything else is an OrcaFailure carrying the receipt. */
export const workerStart = async (binary: OrcaBinary, input: WorkerStartInput, cwd: string): Promise<WorkerStarted> => {
    const result = await callOrca(binary, "worker-start", workerStartFlags(input), workerStartSchema, cwd)
    return {
        dispatchId: result.dispatchId,
        taskId: result.taskId ?? null,
        runId: result.runId ?? null,
        state: result.state ?? result.worker?.state ?? "ready",
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
})

/** One worker as Orca shows it: its state, its terminal and the agent and model it really launched. */
export interface WorkerShown {
    readonly dispatchId: string | null
    readonly state: string | null
    readonly terminal: string | null
    readonly effective: unknown
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
export const workerShow = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<WorkerShown> => {
    const result = await callOrca(binary, "worker-show", { dispatch: dispatchId }, workerShowSchema, cwd)
    return {
        dispatchId: result.dispatch?.id ?? dispatchId,
        state: result.worker?.state ?? null,
        terminal: result.worker?.agentTerminalHandle ?? result.dispatch?.assigneeHandle ?? null,
        effective: result.launch?.effective ?? result.worker?.startOptions?.launch?.effective ?? effectiveFromText(result.worker?.start_options),
    }
}

const stateSchema = z.looseObject({ state: z.string().min(1) })

/** `orca orchestration worker-stop`: fences the dispatch and stops its agent terminal; returns the worker state after the stop. */
export const workerStop = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<string> =>
    (await callOrca(binary, "worker-stop", { dispatch: dispatchId }, stateSchema, cwd)).state

/** `orca orchestration worker-release`: closes a settled worker's terminal (released, already_released, retained or release_pending). */
export const workerRelease = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<string> =>
    (await callOrca(binary, "worker-release", { dispatch: dispatchId }, stateSchema, cwd)).state

/** What closing a worker did: each step's state word, or `error: <why>`; settled only when Orca released the terminal. */
export interface WorkerClosed {
    readonly dispatchId: string
    readonly stop: string
    readonly release: string
    readonly settled: boolean
}

const RELEASED_STATES: readonly string[] = ["released", "already_released"]

const stateOrError = async (step: Promise<string>): Promise<string> => step.catch((error: unknown) => `error: ${error instanceof Error ? error.message : String(error)}`)

/** Stops then releases one worker; both steps always run (release is idempotent), so a half-closed worker is finished on a repeat. */
export const closeWorker = async (binary: OrcaBinary, dispatchId: string, cwd: string): Promise<WorkerClosed> => {
    const stop = await stateOrError(workerStop(binary, dispatchId, cwd))
    const release = await stateOrError(workerRelease(binary, dispatchId, cwd))
    return { dispatchId, stop, release, settled: RELEASED_STATES.includes(release) }
}
