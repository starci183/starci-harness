import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { asRefusal } from "../shared/errors.js"
import { LEDGER_BUSY_MS, ledgerPath, now } from "./ledger.js"
import { holdsSlot, listedTerminals, readMachine, textOf, withMachine } from "./machine.js"
import type { ListedTerminals } from "./machine.js"
import { loadRouting } from "./routing.js"
import { inOrder } from "./sequential.js"
import { projectOf } from "./work.js"
import type { Project } from "./work.js"

/** The repositories whose ledgers the host registry lists and that exist. */
export const registeredRepositories = (): string[] =>
    readMachine((db) => db.prepare("SELECT repo_root, file FROM ledgers WHERE state != 'retired'").all(), [])
        .filter((row) => existsSync(textOf(row.file) ?? "") && existsSync(textOf(row.repo_root) ?? ""))
        .map((row) => textOf(row.repo_root) ?? "")

/** The registered repositories of one project (`projectOf` each: the Work root and its sides); a repository whose binding is unfit is reported, never swept. */
export const projectRepositories = async (project: Project): Promise<{ readonly repos: readonly string[]; readonly problems: readonly string[] }> => {
    const repos: string[] = []
    const problems: string[] = []
    await inOrder(registeredRepositories(), async (repo) => {
        try {
            if ((await projectOf(repo)).key === project.key) repos.push(repo)
        } catch (error: unknown) {
            problems.push(`${repo}: no project (${asRefusal(error).code}): ${asRefusal(error).message.split("\n")[0] ?? ""}`)
        }
    })
    return { repos, problems }
}

const workerSchema = z.object({
    id: z.string(),
    project: z.string(),
    repo: z.string(),
    task_id: z.string(),
    topic: z.string(),
    worktree: z.string(),
    created_at: z.string(),
    handed: z.string().nullable(),
    ended_at: z.string().nullable(),
    ended_by: z.string().nullable(),
})

/**
 * A `[Worker]` seat a project's Supervisor dispatched (machine.sqlite `supervisor_workers`): its task lives in the ledger of `repo`
 * (the project's own repository or another, such as a harness package worktree), it works in `worktree`, `handed` is the
 * completion `supervisor next` last handed the Supervisor, and `ended_by` how the Supervisor ended it (accepted, red, rejected).
 */
export type WorkerRecord = z.infer<typeof workerSchema>

/** How the Supervisor ended a worker: its accept settled green or red, or it rejected the worker. */
export type WorkerEnd = "accepted" | "red" | "rejected"

/** Records a dispatched worker. */
export const recordWorker = (worker: Omit<WorkerRecord, "created_at" | "handed" | "ended_at" | "ended_by">): void => {
    withMachine((db) =>
        db.prepare("INSERT INTO supervisor_workers (id, project, repo, task_id, topic, worktree, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(worker.id, worker.project, worker.repo, worker.task_id, worker.topic, worker.worktree, now()),
    )
}

/** A project's workers, oldest first; `open` keeps only the ones the Supervisor has not ended. */
export const workersOf = (project: string, open: boolean): WorkerRecord[] =>
    readMachine((db) => db.prepare(`SELECT * FROM supervisor_workers WHERE project = ?${open ? " AND ended_at IS NULL" : ""} ORDER BY created_at, id`).all(project), []).map((row) => workerSchema.parse(row))

/** Notes the completion `supervisor next` handed the Supervisor, so each one is handed once. */
export const noteHanded = (id: string, handed: string): void => {
    withMachine((db) => db.prepare("UPDATE supervisor_workers SET handed = ? WHERE id = ?").run(handed, id))
}

/** Ends a worker once. */
export const endWorker = (id: string, by: WorkerEnd): void => {
    withMachine((db) => db.prepare("UPDATE supervisor_workers SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL").run(now(), by, id))
}

const repoKey = (path: string): string => resolve(path).replaceAll("\\", "/").toLowerCase()

/** The task ids of every Supervisor worker of the host, with the project each belongs to. */
const workerTasks = (): ReadonlyMap<string, string> =>
    new Map(readMachine((db) => db.prepare("SELECT task_id, project FROM supervisor_workers").all(), []).map((row) => [textOf(row.task_id) ?? "", textOf(row.project) ?? ""]))

/** The open worker seats of one ledger, each with the task it runs; a ledger that cannot be read now counts none. */
const openWorkerSeats = (repo: string, listed: ListedTerminals | null): string[] => {
    const file = ledgerPath(repo)
    if (file === undefined) return []
    let ledger: DatabaseSync | undefined
    try {
        ledger = new DatabaseSync(file, { readOnly: true, timeout: LEDGER_BUSY_MS })
        return ledger
            .prepare("SELECT * FROM seats WHERE role = 'worker' AND ended_at IS NULL")
            .all()
            .filter((row) => holdsSlot(row, listed))
            .map((row) => textOf(row.task_id) ?? "")
    } catch {
        // A ledger locked or damaged now is read again by the next launch.
        return []
    } finally {
        ledger?.close()
    }
}

/** A project's worker slots: how many of its worker seats run now and the cap (routing.yaml projectMaxWorkers). */
export interface ProjectSlots {
    readonly running: number
    readonly cap: number
}

/**
 * Counts the worker seats a project runs now against `projectMaxWorkers`: every open worker seat in its repositories' ledgers (its
 * Kernels' Ops, and any task sent there) that is not another project's Supervisor worker, plus its own Supervisor workers in any
 * ledger, each judged as the pool count judges it (`holdsSlot`).
 */
export const projectSlots = async (project: Project): Promise<ProjectSlots> => {
    const { repos } = await projectRepositories(project)
    const owners = workerTasks()
    const own = new Set(repos.map(repoKey))
    const elsewhere = workersOf(project.key, true).map((worker) => worker.repo).filter((repo) => !own.has(repoKey(repo)))
    const ledgers = [...new Map([...repos, ...elsewhere].map((repo) => [repoKey(repo), repo])).values()]
    const listed = listedTerminals()
    let running = 0
    for (const repo of ledgers) {
        const inProject = own.has(repoKey(repo))
        for (const task of openWorkerSeats(repo, listed)) {
            const owner = owners.get(task)
            if (owner === project.key || (owner === undefined && inProject)) running += 1
        }
    }
    return { running, cap: loadRouting().projectMaxWorkers }
}

/** The slots of the project a repository belongs to. */
export const slotsOfRepository = async (root: string): Promise<ProjectSlots & { readonly project: Project }> => {
    const project = await projectOf(root)
    return { project, ...(await projectSlots(project)) }
}
