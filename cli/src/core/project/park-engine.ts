import { existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { closeKernel, kernelTitle, startKernel } from "../../harness/kernel.js"
import { inTransaction, openLedger, projectDir } from "../../harness/ledger.js"
import { readMachine, textOf } from "../../harness/machine.js"
import { locateOrca, terminalClose, terminalList } from "../../harness/orca/client.js"
import type { ListedTerminal, OrcaBinary } from "../../harness/orca/client.js"
import { finishParkEvent, isParkedReason, isProjectParked, parkedFrom, parkedReason, PROJECT_PARKED, PROJECT_UNPARKED, recordParkEvent, WORKFLOW_PARKED, WORKFLOW_UNPARKED } from "../../harness/park.js"
import { projectRepositories, retaskWorker, workersOf } from "../../harness/project-workers.js"
import type { WorkerRecord } from "../../harness/project-workers.js"
import { closeFolderTerminals } from "../../harness/reap.js"
import { harnessCause } from "../../harness/revive.js"
import { closeSeatsOfTask, isSeatOpen, listSeats } from "../../harness/seats.js"
import { inOrder } from "../../harness/sequential.js"
import { ensureSupervisor, isAttached, stopSupervisor, supervisorRecord, supervisorTitle } from "../../harness/supervisor.js"
import type { AttachedSupervisor } from "../../harness/supervisor.js"
import { createTask, getTask, recordEvent } from "../../harness/tasks.js"
import type { TaskStatus } from "../../harness/tasks.js"
import type { Project } from "../../harness/work.js"
import { getWorkflow, listWorkflows, setWorkflowStatus } from "../../harness/workflow.js"
import type { WorkflowStatus } from "../../harness/workflow.js"
import { asRefusal, Refusal } from "../../shared/errors.js"
import type { VerbContext } from "../../shared/verb.js"
import { RELAUNCH_LIMIT } from "../kernel/driver.js"
import { launchQueuedWorkers } from "../supervisor/workers.js"
import { cancelTask } from "../task/cancel.js"
import { workflowResumeVerb } from "../workflow/resume.js"

/** The workflow statuses a park pauses: every started one that has not ended. */
const PARKABLE: readonly WorkflowStatus[] = ["running", "blocked", "paused"]

/** The task statuses whose open seat is a worker still working: a park stops it and keeps its work (`task-parked`). */
const WORKING: readonly TaskStatus[] = ["queued", "running", "effect_unknown"]

/** One workflow a park paused, the status and reason it had, and what became of its Kernel terminal. */
export interface ParkedWorkflow {
    readonly repo: string
    readonly workflow: string
    readonly was: string
    readonly reason: string | null
    readonly kernel: string
}

/** One task whose live seat a park stopped: `parked` (cancelled, its work kept, back at the same try) or `seats closed` (a task past its work). */
export interface ParkedTask {
    readonly repo: string
    readonly task: string
    readonly key: string | null
    readonly workflow: string | null
    readonly worker: string | null
    readonly action: "parked" | "seats-closed"
    readonly detail: string
}

/** One Orca terminal of the project the park closed (or would close), and why it was the project's. */
export interface ParkedTerminal {
    readonly handle: string
    readonly title: string | null
    readonly why: string
    readonly outcome: string
}

/** What `project park` did, or would do under --dry-run. */
export interface ProjectParkData {
    readonly project: string
    readonly name: string
    readonly dryRun: boolean
    readonly workflows: readonly ParkedWorkflow[]
    readonly tasks: readonly ParkedTask[]
    readonly supervisor: string
    readonly terminals: readonly ParkedTerminal[]
    readonly workspaces: readonly string[]
    readonly left: readonly { readonly handle: string; readonly title: string | null }[]
    readonly problems: readonly string[]
}

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

const firstLine = (error: unknown): string => `${asRefusal(error).code}: ${asRefusal(error).message.split("\n")[0] ?? ""}`

const folderKey = (path: string): string => {
    const slashed = resolve(path).replaceAll("\\", "/").replace(/\/+$/, "")
    return process.platform === "win32" ? slashed.toLowerCase() : slashed
}

const inside = (folder: string, path: string | null): boolean => path !== null && (folderKey(path) === folderKey(folder) || folderKey(path).startsWith(`${folderKey(folder)}/`))

/** The worktrees a project's state folder holds: each workflow and worker worktree, and each Op worktree under a `<workflow>.ops` folder. */
const stateWorktrees = (repo: string): string[] => {
    const base = join(projectDir(repo), "worktrees")
    if (!existsSync(base)) return []
    return readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => (entry.name.endsWith(".ops") ? readdirSync(join(base, entry.name), { withFileTypes: true }).filter((op) => op.isDirectory()).map((op) => join(base, entry.name, op.name)) : [join(base, entry.name)]))
}

/** Everything that marks an Orca terminal as the project's: handles its records name, folders it owns and the titles the harness gave it. */
interface ProjectMarks {
    readonly handles: ReadonlyMap<string, string>
    readonly folders: readonly { readonly folder: string; readonly repo: string }[]
    readonly kernels: ReadonlySet<string>
    readonly tasks: ReadonlySet<string>
}

const projectMarks = (project: Project, repos: readonly string[], workers: readonly WorkerRecord[]): ProjectMarks => {
    const handles = new Map<string, string>()
    const folders: { folder: string; repo: string }[] = []
    const kernels = new Set<string>()
    const tasks = new Set<string>()
    const workerTasks = new Set(workers.map((worker) => worker.task_id))
    const note = (handle: unknown, who: string): void => {
        const text = textOf(handle)
        if (text !== null && text !== "") handles.set(text, who)
    }
    for (const repo of new Set([...repos, ...workers.map((worker) => worker.repo)])) {
        const own = repos.includes(repo)
        withLedger(repo, (db) => {
            for (const row of db.prepare("SELECT id, role, terminal, task_id FROM seats").all()) if (own || workerTasks.has(String(row.task_id))) note(row.terminal, `${String(row.role)} seat ${String(row.id)}`)
            if (!own) return
            for (const row of db.prepare("SELECT id FROM tasks").all()) tasks.add(String(row.id))
            for (const workflow of listWorkflows(db)) {
                kernels.add(kernelTitle(workflow.id))
                note(workflow.kernel.terminal, `Kernel of ${workflow.id}`)
                const worktree = db.prepare("SELECT worktree FROM workflows WHERE id = ?").get(workflow.id)?.worktree
                if (typeof worktree === "string" && existsSync(worktree)) folders.push({ folder: worktree, repo })
            }
        })
        if (own) folders.push(...stateWorktrees(repo).map((folder) => ({ folder, repo })))
    }
    for (const worker of workers) if (existsSync(worker.worktree)) folders.push({ folder: worker.worktree, repo: worker.repo })
    for (const row of readMachine((db) => db.prepare("SELECT id, terminal FROM project_supervisors WHERE project = ?").all(project.key), [])) note(row.terminal, `Supervisor ${String(row.id)}`)
    const unique = new Map(folders.map((entry) => [folderKey(entry.folder), entry]))
    return { handles, folders: [...unique.values()], kernels, tasks }
}

/** Why a listed terminal is the project's, or null: a record names it, it works in a folder of the project's, or it carries a harness title of the project. */
const projectTerminal = (terminal: ListedTerminal, project: Project, marks: ProjectMarks): string | null => {
    if (terminal.handle === process.env.ORCA_TERMINAL_HANDLE) return null
    const held = marks.handles.get(terminal.handle)
    if (held !== undefined) return `recorded by ${held}`
    const folder = marks.folders.find((entry) => inside(entry.folder, terminal.worktree))
    if (folder !== undefined) return `works in ${folder.folder}`
    const title = terminal.title ?? ""
    if (title === supervisorTitle(project.name) || title.startsWith(`[Worker] ${project.name}: `) || marks.kernels.has(title)) return `titled ${title}`
    const op = /^\[Op\] .* \((t-[^)]+)\)/.exec(title)?.[1]
    return op !== undefined && marks.tasks.has(op) ? `titled ${title}` : null
}

/** Closes every Orca terminal of the project, by Orca's list and then the forced close of each of its folders, and lists what is left. */
const closeProjectTerminals = async (binary: OrcaBinary, cwd: string, project: Project, marks: ProjectMarks, dryRun: boolean): Promise<Pick<ProjectParkData, "terminals" | "workspaces" | "left">> => {
    const mine = (inventory: { readonly terminals: readonly ListedTerminal[] }): { terminal: ListedTerminal; why: string }[] =>
        inventory.terminals.flatMap((terminal) => {
            const why = projectTerminal(terminal, project, marks)
            return why === null ? [] : [{ terminal, why }]
        })
    const doomed = mine(await terminalList(binary, cwd))
    const terminals = await inOrder(doomed, async ({ terminal, why }) => ({
        handle: terminal.handle,
        title: terminal.title,
        why,
        outcome: dryRun ? "dry-run" : await terminalClose(binary, terminal.handle, cwd).catch((error: unknown) => `error: ${firstLine(error)}`),
    }))
    if (dryRun) return { terminals, workspaces: [], left: [] }
    // The forced close reaches what no list shows (a hidden terminal still running) and drops each folder's saved tabs.
    const workspaces = await inOrder(marks.folders, async ({ folder, repo }) => `${folder}: ${(await closeFolderTerminals(binary, folder, repo)).workspace}`)
    const left = mine(await terminalList(binary, cwd)).map(({ terminal }) => ({ handle: terminal.handle, title: terminal.title }))
    return { terminals, workspaces, left }
}

/** Pauses every parkable workflow of one repository with a parked reason that keeps what it had, and returns them. */
const pauseWorkflows = (repo: string, dryRun: boolean): Omit<ParkedWorkflow, "kernel">[] =>
    withLedger(repo, (db) =>
        inTransaction(db, () =>
            listWorkflows(db)
                .filter((workflow) => PARKABLE.includes(workflow.status))
                .map((workflow) => {
                    const was = isParkedReason(workflow.reason) ? parkedFrom(workflow.reason ?? "") : { status: workflow.status, reason: workflow.reason }
                    if (!dryRun && !isParkedReason(workflow.reason)) setWorkflowStatus(db, workflow.id, "paused", parkedReason(workflow.status, workflow.reason))
                    return { repo, workflow: workflow.id, was: was.status, reason: was.reason }
                }),
        ),
    )

/** The tasks of the project with an open worker seat: every one in its own repositories, and each Supervisor worker's wherever it lives. */
const seatedTasks = (repos: readonly string[], workers: readonly WorkerRecord[]): { readonly repo: string; readonly task: string }[] => {
    const workerTasks = new Set(workers.map((worker) => worker.task_id))
    return [...new Set([...repos, ...workers.map((worker) => worker.repo)])].flatMap((repo) =>
        withLedger(repo, (db) => [
            ...new Set(
                listSeats(db)
                    .filter((seat) => seat.role === "worker" && seat.taskId !== null && isSeatOpen(seat) && (repos.includes(repo) || workerTasks.has(seat.taskId)))
                    .map((seat) => seat.taskId ?? ""),
            ),
        ].map((task) => ({ repo, task }))),
    )
}

/** Stops one seated task: a working one is cancelled as parked (its work kept, its key back at the same try), any other has its seats closed. */
const stopTask = async (repo: string, task: string, workers: readonly WorkerRecord[], dryRun: boolean): Promise<ParkedTask> => {
    const { row, key } = withLedger(repo, (db) => ({ row: getTask(db, task), key: textOf(db.prepare("SELECT plan_key FROM tasks WHERE id = ?").get(task)?.plan_key) }))
    const worker = workers.find((one) => one.task_id === task)?.id ?? null
    const base = { repo, task, key, workflow: row.workflowId, worker }
    if (!WORKING.includes(row.status) && row.intent !== "cancelling") {
        if (dryRun) return { ...base, action: "seats-closed", detail: `would close the open seats of this ${row.status} task` }
        const closed = await closeSeatsOfTask(repo, task)
        return { ...base, action: "seats-closed", detail: closed.map((seat) => `seat ${seat.seat} ${seat.outcome}`).join(", ") }
    }
    if (dryRun) return { ...base, action: "parked", detail: `would stop its seat and keep its ${row.status} work` }
    try {
        return { ...base, action: "parked", detail: (await cancelTask(repo, task, "project park", true)).message }
    } catch (error: unknown) {
        return { ...base, action: "parked", detail: `not parked (${firstLine(error)}); run project park again` }
    }
}

/**
 * Parks a project (`project park`): records the park first, so no tick or ensure relaunches anything of it meanwhile; pauses every
 * started workflow with a parked reason; stops each live worker seat, a working task cancelled as parked so its work is kept as
 * one patch and its key comes back at the same try (core/task/cancel.ts `cancelTask`); closes each workflow's Kernel terminal,
 * leaving its worktree and graph as they are; stops the Supervisor; then closes every Orca terminal of the project that is left,
 * by Orca's list and the forced close of each of its folders, and records what it closed on the park event. Never quits Orca.
 */
export const parkProject = async (context: VerbContext, project: Project, dryRun: boolean): Promise<ProjectParkData> => {
    const binary = await locateOrca(context.cwd)
    const { repos, problems: unresolved } = await projectRepositories(project)
    const problems = [...unresolved]
    const workers = workersOf(project.key, true)
    const event = dryRun ? null : recordParkEvent(PROJECT_PARKED, project.key, { phase: "parking" })
    const paused = repos.flatMap((repo) => pauseWorkflows(repo, dryRun))
    const tasks = await inOrder(seatedTasks(repos, workers), ({ repo, task }) => stopTask(repo, task, workers, dryRun))
    const workflows = await inOrder(paused, async (entry): Promise<ParkedWorkflow> => {
        const orca = withLedger(entry.repo, (db) => getWorkflow(db, entry.workflow).header.runner === "orca")
        if (!orca) return { ...entry, kernel: "inline: no Kernel terminal" }
        if (dryRun) return { ...entry, kernel: "would close" }
        const kernel = await closeKernel(entry.repo, context.cwd, entry.workflow, binary).catch((error: unknown) => `error: ${firstLine(error)}`)
        withLedger(entry.repo, (db) => {
            recordEvent(db, WORKFLOW_PARKED, entry.workflow, { was: entry.was, reason: entry.reason, kernel })
        })
        return { ...entry, kernel }
    })
    const supervisor = supervisorRecord(project.key)
    const stopped = supervisor === null ? "none" : dryRun ? `would stop ${supervisor.id}` : await stopSupervisor(binary, context.cwd, project, true, "parked").then((done) => `stopped ${done.stopped ?? "-"}, tab ${done.tab}`, (error: unknown) => `error: ${firstLine(error)}`)
    const swept = await closeProjectTerminals(binary, context.cwd, project, projectMarks(project, repos, workers), dryRun).catch((error: unknown) => {
        problems.push(`terminals not swept (${firstLine(error)})`)
        return { terminals: [], workspaces: [], left: [] }
    })
    const data: ProjectParkData = { project: project.key, name: project.name, dryRun, workflows, tasks, supervisor: stopped, ...swept, problems }
    if (event !== null) finishParkEvent(event, data)
    return data
}

/** One workflow unpark brought back: its Kernel relaunch and the status it returned to. */
export interface UnparkedWorkflow {
    readonly repo: string
    readonly workflow: string
    readonly kernel: string
    readonly status: string
}

/** What `project unpark` did: the Supervisor, the workflows it brought back, the worker tasks it retried, and what waits. */
export interface ProjectUnparkData {
    readonly project: string
    readonly name: string
    readonly supervisor: string
    readonly workflows: readonly UnparkedWorkflow[]
    readonly workers: readonly string[]
    readonly pending: boolean
    readonly problems: readonly string[]
}

/** The workflows of the project's repositories a park paused and no unpark brought back yet. */
const parkedWorkflows = (repos: readonly string[]): { readonly repo: string; readonly workflow: string; readonly reason: string; readonly orca: boolean }[] =>
    repos.flatMap((repo) =>
        withLedger(repo, (db) =>
            listWorkflows(db)
                .filter((workflow) => workflow.status === "paused" && isParkedReason(workflow.reason))
                .map((workflow) => ({ repo, workflow: workflow.id, reason: workflow.reason ?? "", orca: workflow.header.runner === "orca" })),
        ),
    )

/** Brings one parked workflow back: its Kernel relaunched on its own worktree (unless the relaunch limit had paused it), then its status restored, a running one resumed. */
const unparkWorkflow = async (context: VerbContext, binary: OrcaBinary, acting: AttachedSupervisor, entry: ReturnType<typeof parkedWorkflows>[number]): Promise<UnparkedWorkflow> => {
    const was = parkedFrom(entry.reason)
    const kernelDue = entry.orca && !(was.status === "paused" && was.reason?.startsWith(RELAUNCH_LIMIT) === true)
    const kernel = kernelDue ? (await startKernel(entry.repo, context.cwd, entry.workflow, binary, { replace: true, acting })).notes.join("; ") : "not relaunched"
    if (was.status === "paused") withLedger(entry.repo, (db) => setWorkflowStatus(db, entry.workflow, "paused", was.reason))
    else await workflowResumeVerb.run({ ...context, cwd: entry.repo }, { workflow: entry.workflow })
    const status = withLedger(entry.repo, (db) => {
        recordEvent(db, WORKFLOW_UNPARKED, entry.workflow, { was: was.status, kernel })
        return getWorkflow(db, entry.workflow).status
    })
    return { repo: entry.repo, workflow: entry.workflow, kernel, status }
}

/** Gives each open worker whose task a park stopped a retry of that task (same try, its patch applied at launch), queued for launch. */
const retryParkedWorkers = (project: Project): string[] =>
    workersOf(project.key, true).flatMap((worker) =>
        withLedger(worker.repo, (db) => {
            const task = getTask(db, worker.task_id)
            if (task.status !== "cancelled" || harnessCause(db, task.id) !== "parked") return []
            const retry = inTransaction(db, () => createTask(db, task.contract, { retryOf: task.id, worktree: worker.worktree }))
            retaskWorker(worker.id, retry.id)
            return [`${worker.id}: task ${task.id} retried as ${retry.id} (try ${String(retry.tryNo)})`]
        }),
    )

/**
 * The second half of an unpark, once the project's Supervisor is attached: every parked workflow gets its Kernel back on its own
 * worktree and its status (a running or blocked one is resumed, which dispatches its ready nodes, the parked tasks at the same
 * try from their patch), and every parked worker task is retried and launched. A workflow whose Kernel would not start stays
 * parked for the next call. `supervisor tick` runs it for every project it sweeps, so an unpark finishes on its own.
 */
export const finishUnpark = async (context: VerbContext, project: Project, binary: OrcaBinary, acting: AttachedSupervisor): Promise<{ readonly workflows: UnparkedWorkflow[]; readonly workers: string[]; readonly problems: string[] }> => {
    if (isProjectParked(project.key)) return { workflows: [], workers: [], problems: [] }
    const { repos } = await projectRepositories(project)
    const problems: string[] = []
    const workflows = (
        await inOrder(parkedWorkflows(repos), async (entry) => {
            try {
                return [await unparkWorkflow(context, binary, acting, entry)]
            } catch (error: unknown) {
                problems.push(`${entry.workflow}: stays parked (${firstLine(error)})`)
                return []
            }
        })
    ).flat()
    const workers = retryParkedWorkers(project)
    if (workers.length > 0) workers.push(...(await launchQueuedWorkers(context, acting, project)))
    return { workflows, workers, problems }
}

const sleep = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Waits up to `seconds` for the project's Supervisor to attach; null when it has not. */
const attachedWithin = async (project: Project, seconds: number): Promise<AttachedSupervisor | null> => {
    const deadline = Date.now() + seconds * 1000
    for (;;) {
        const seat = supervisorRecord(project.key)
        if (isAttached(seat)) return seat
        if (Date.now() >= deadline) return null
        await sleep(2000)
    }
}

/**
 * Unparks a project (`project unpark`): records the unpark, starts its Supervisor, and once it attached (waiting up to `wait`
 * seconds) brings every parked workflow and worker back (`finishUnpark`). A Supervisor not attached yet leaves the rest pending
 * for `supervisor tick`, which finishes it as soon as it sweeps the project.
 */
export const unparkProject = async (context: VerbContext, project: Project, wait: number): Promise<ProjectUnparkData> => {
    const binary = await locateOrca(context.cwd)
    const { repos } = await projectRepositories(project)
    const parked = isProjectParked(project.key)
    if (!parked && parkedWorkflows(repos).length === 0) throw new Refusal("PROJECT_NOT_PARKED", `project ${project.name} is not parked`)
    if (parked) recordParkEvent(PROJECT_UNPARKED, project.key, { workflows: parkedWorkflows(repos).map((entry) => entry.workflow) })
    const ensured = await ensureSupervisor(binary, context.cwd, project)
    const supervisor = `${supervisorTitle(project.name)} ${ensured.liveness}: ${ensured.detail}`
    const acting = await attachedWithin(project, wait)
    const base = { project: project.key, name: project.name, supervisor }
    if (acting === null) return { ...base, workflows: [], workers: [], pending: true, problems: [`${supervisorTitle(project.name)} has not attached yet; supervisor tick finishes the unpark once it does`] }
    const finished = await finishUnpark(context, project, binary, acting)
    return { ...base, ...finished, pending: finished.problems.length > 0 }
}
