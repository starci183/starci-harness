import { Refusal } from "../shared/errors.js"
import { openLedger, now } from "./ledger.js"
import { inTransaction } from "./leases.js"
import {
    OrcaFailure,
    isSelectorNotFound,
    repoAdd,
    repositoryOfSelector,
    requestIdOf,
    runCreate,
    runUse,
    taskCreate,
    terminalClose,
    terminalCreate,
    terminalList,
    worktreeSelector,
} from "./orca/client.js"
import type { OrcaBinary } from "./orca/client.js"
import { recordEvent } from "./tasks.js"
import { getWorkflow, recordKernel } from "./workflow.js"
import type { KernelRecord, WorkflowRow } from "./workflow.js"

const TITLE_CHARS = 80

const clip = (text: string): string => (text.length <= TITLE_CHARS ? text : `${text.slice(0, TITLE_CHARS - 1)}…`)

/** The title of a workflow's Kernel terminal and task in Orca; its ops read `[Op] <workflow> › <task>` under it. */
export const kernelTitle = (workflowId: string): string => clip(`[Kernel] ${workflowId}`)

/** The terminal handle Orca gives the terminal this process runs in, when it runs in one. */
const callerTerminal = (): string | undefined => {
    const handle = process.env.ORCA_TERMINAL_HANDLE
    return handle === undefined || handle === "" ? undefined : handle
}

/**
 * The Kernel every op of the workflow nests under, ready to launch with: its coordinator terminal, its Run and its task. Orca
 * accepts a worker's `--parent` only from the same Run, and `--from` only from the terminal that coordinates that Run.
 */
export interface KernelLaunch {
    readonly terminal: string
    readonly runId: string
    readonly taskId: string
}

/** The Kernel of a workflow when every part of it is recorded and its terminal is not closed; else null (ops launch flat). */
export const launchableKernel = (workflow: WorkflowRow): KernelLaunch | null => {
    const { terminal, runId, taskId, closedAt } = workflow.kernel
    if (workflow.header.runner !== "orca" || closedAt !== null || terminal === null || runId === null || taskId === null) return null
    return { terminal, runId, taskId }
}

/** What ensuring a Kernel did: the record as it now stands and one line per thing created, adopted or recovered. */
export interface KernelEnsured {
    readonly kernel: KernelRecord
    readonly notes: readonly string[]
}

const withRecord = <T>(root: string, work: (db: ReturnType<typeof openLedger>) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

/** Creates the coordinator terminal; a repository Orca does not know yet is registered (`repo add`) and the create tried once more. */
const createTerminal = async (binary: OrcaBinary, workflow: WorkflowRow, root: string, cwd: string, notes: string[]): Promise<string> => {
    const worktree = worktreeSelector(workflow.header.worktree, cwd, root)
    const input = { worktree, title: kernelTitle(workflow.id) }
    try {
        return await terminalCreate(binary, input, cwd)
    } catch (error: unknown) {
        if (!isSelectorNotFound(error)) throw error
        const repository = repositoryOfSelector(worktree, root)
        await repoAdd(binary, repository, cwd)
        notes.push(`registered ${repository} with Orca (orca repo add)`)
        return terminalCreate(binary, input, cwd)
    }
}

/**
 * Makes sure an orca workflow has its Kernel in Orca, once: a coordinator terminal `[Kernel] <workflow>` (created, or the
 * terminal this process runs in when ORCA_TERMINAL_HANDLE names one, which the harness then never closes), the Run that
 * terminal coordinates and the Kernel's orchestration task in it. A recorded terminal that `terminal list` no longer shows is
 * replaced and takes its Run back (`run-use`), else a new Run and task are made. Run and task carry request ids derived from
 * the workflow and terminal, so a repeat after a lost answer returns the same ones. An inline workflow, or one whose Kernel
 * was closed by a stop, gets nothing. Each part is recorded as soon as Orca answers; an Orca failure is thrown as it came.
 */
export const ensureKernel = async (root: string, cwd: string, workflowId: string, binary: OrcaBinary): Promise<KernelEnsured> => {
    const workflow = withRecord(root, (db) => getWorkflow(db, workflowId))
    const notes: string[] = []
    if (workflow.header.runner !== "orca" || workflow.kernel.closedAt !== null) return { kernel: workflow.kernel, notes }
    let kernel = workflow.kernel
    const live = kernel.terminal === null ? undefined : await terminalList(binary, cwd)
    const alive = kernel.terminal !== null && live !== undefined && (live.truncated || live.handles.has(kernel.terminal))
    if (!alive) {
        const replaced = await replaceTerminal(root, cwd, { workflow, live, binary }, notes)
        if (replaced.raced) return { kernel: replaced.kernel, notes: replaced.notes }
        kernel = replaced.kernel
    }
    const terminal = kernel.terminal
    if (terminal === null) throw new Refusal("KERNEL_UNRECORDED", `workflow ${workflowId} has no Kernel terminal recorded after it was made`)
    if (kernel.runId === null) {
        const runId = await runCreate(binary, { objective: clip(`StarCi workflow ${workflowId}: ${workflow.header.goal}`), from: terminal, retryRequest: requestIdOf("kernel-run-create", `${workflowId}\0${terminal}`) }, cwd)
        kernel = withRecord(root, (db) => recordKernel(db, workflowId, { runId, taskId: null }).kernel)
        notes.push(`created the Kernel Run ${runId}`)
    }
    const runId = kernel.runId
    if (kernel.taskId === null && runId !== null) {
        const spec = `StarCi Kernel of workflow ${workflowId}: ${workflow.header.goal}. Every op of this workflow is a child task of this one; the harness ledger is the state (starci workflow status ${workflowId}).`
        const taskId = await taskCreate(binary, { spec, taskTitle: kernelTitle(workflowId), run: runId, from: terminal, retryRequest: requestIdOf("kernel-task-create", `${workflowId}\0${runId}`) }, cwd)
        kernel = withRecord(root, (db) => recordKernel(db, workflowId, { taskId }).kernel)
        notes.push(`created the Kernel task ${taskId} in Run ${runId}`)
    }
    return { kernel, notes }
}

/** The first line of an error's message, for a note. */
const firstLine = (error: unknown): string => (error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error))

/** Gives the workflow a new Kernel terminal in place of a gone or missing one; `raced` is set when another step recorded one first. */
const replaceTerminal = async (
    root: string,
    cwd: string,
    from: { readonly workflow: WorkflowRow; readonly live: Awaited<ReturnType<typeof terminalList>> | undefined; readonly binary: OrcaBinary },
    notes: string[],
): Promise<KernelEnsured & { readonly raced: boolean }> => {
    const { workflow, live, binary } = from
    const workflowId = workflow.id
    let kernel = workflow.kernel
    const lost = kernel.terminal
    if (lost !== null) notes.push(`Kernel terminal ${lost} is gone (orca terminal list)`)
    const caller = callerTerminal()
    // The terminal this process runs in exists, unless the list just read says it is gone too.
    const adopted = caller !== undefined && (live === undefined || live.truncated || live.handles.has(caller)) ? caller : undefined
    const terminal = adopted ?? (await createTerminal(binary, workflow, root, cwd, notes))
    const raced = withRecord(root, (db) =>
        inTransaction(db, () => {
            const current = getWorkflow(db, workflowId).kernel
            // Another step recorded its own terminal meanwhile: that one is the Kernel's and ours is surplus.
            if (current.terminal !== lost) return current
            kernel = recordKernel(db, workflowId, { terminal, owned: adopted === undefined, closedAt: null }).kernel
            return undefined
        }),
    )
    if (raced !== undefined) {
        if (adopted === undefined) await terminalClose(binary, terminal, cwd).catch(() => "error")
        return { kernel: raced, notes: [...notes, `another step made the Kernel terminal ${raced.terminal ?? "-"} first; used it`], raced: true }
    }
    notes.push(adopted === undefined ? `created the Kernel terminal ${terminal}` : `adopted this process's terminal ${terminal} (ORCA_TERMINAL_HANDLE) as the Kernel terminal`)
    if (kernel.runId !== null) {
        const runId = kernel.runId
        const taken = await runUse(binary, { id: runId, from: terminal }, cwd).then(
            () => true,
            (error: unknown) => {
                notes.push(`run-use of ${runId} refused (${firstLine(error)}); a new Run is made`)
                return false
            },
        )
        if (taken) notes.push(`the Kernel terminal ${terminal} took Run ${runId} back (run-use)`)
        else kernel = withRecord(root, (db) => recordKernel(db, workflowId, { runId: null, taskId: null }).kernel)
    }
    return { kernel, notes, raced: false }
}

/** What stopping a workflow did to its Kernel terminal: closed, already gone, left open (adopted, not the harness's), nothing to close, or why the close failed. */
export type KernelClosing = "closed" | "gone" | "kept-adopted" | "none" | `error: ${string}`

/**
 * Closes a stopped workflow's Kernel terminal tab, after its ops (`orca terminal close --tab`). Only a terminal the harness
 * created is closed; an adopted one is only let go. Best effort: a failure is an event and the next stop or step tries again.
 */
export const closeKernel = async (root: string, cwd: string, workflowId: string, binary: OrcaBinary): Promise<KernelClosing> => {
    const kernel = withRecord(root, (db) => getWorkflow(db, workflowId).kernel)
    if (kernel.terminal === null || kernel.closedAt !== null) return "none"
    const terminal = kernel.terminal
    const outcome: KernelClosing = kernel.owned
        ? await terminalClose(binary, terminal, cwd).catch((error: unknown): KernelClosing => `error: ${error instanceof OrcaFailure || error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error)}`)
        : "kept-adopted"
    withRecord(root, (db) => {
        if (outcome.startsWith("error: ")) recordEvent(db, "workflow-kernel-close-failed", workflowId, { terminal, outcome })
        else recordKernel(db, workflowId, { closedAt: now() })
    })
    return outcome
}
