import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { git } from "../shared/git.js"
import { leasePaths } from "./leases.js"
import { projectDir } from "./ledger.js"
import { inOrder } from "./sequential.js"
import type { TaskRow } from "./tasks.js"
import { recordEvent } from "./tasks.js"

/** What preserving a task's paths saved and put back; `dir` is null when nothing under its allowPaths was dirty. */
export interface Preserved {
    readonly dir: string | null
    readonly patch: string | null
    readonly tracked: readonly string[]
    readonly untracked: readonly string[]
}

/** Paths per git call, so a task with many dirty files never meets the Windows argv cap. */
const CHUNK = 100

const literal = (path: string): string => `:(top,literal)${path}`

// -z output: paths come raw, never quoted, whatever characters they carry.
const fields = (text: string): string[] => text.split("\0").filter((field) => field !== "")

const chunks = <T>(items: readonly T[]): T[][] => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) => items.slice(index * CHUNK, (index + 1) * CHUNK))

/** The task's allowPaths as pathspecs. */
const pathspecs = (task: TaskRow): string[] => leasePaths(task).map(literal)

/** A folder no earlier preserve of the task used, in the project's state folder: preserved/<task>, then preserved/<task>.2, .3 ... */
const freshDir = (root: string, taskId: string): string => {
    const base = join(projectDir(root), "preserved", taskId)
    let dir = base
    let n = 2
    while (existsSync(dir)) {
        dir = `${base}.${String(n)}`
        n += 1
    }
    return dir
}

/**
 * Saves a task's dirty work under its allowPaths into `preserved/<task>/` of the project's state folder, outside the repository
 * (a binary patch of the tracked changes against HEAD plus copies of its untracked files), records a `task-preserved` event, then puts those paths back to
 * HEAD: tracked files in the patch are checked out from HEAD (or dropped when HEAD has none), copied untracked files are
 * deleted. Nothing outside the allowPaths is read or touched. Call it while the task still holds its leases, before it
 * ends, so no overlapping task can commit the half-done work in between. `onSaved` runs once the copy and its manifest are on
 * disk and before anything is reset: a caller records the folder there (or stores the patch for the next attempt), so the
 * reset never runs ahead of a safe copy. A reset that breaks half-way throws PreserveIncomplete; resetPreserved finishes it.
 */
export const preserveTaskPaths = async (root: string, task: TaskRow, db: DatabaseSync, onSaved?: (dir: string) => Promise<void> | void): Promise<Preserved> => {
    const specs = pathspecs(task)
    if (specs.length === 0) return { dir: null, patch: null, tracked: [], untracked: [] }
    const raw = fields(await git(root, ["diff", "--no-renames", "--name-status", "-z", "HEAD", "--", ...specs]))
    const status = Array.from({ length: Math.floor(raw.length / 2) }, (_, index) => ({ kind: raw[index * 2] ?? "", path: raw[index * 2 + 1] ?? "" }))
    const untracked = fields(await git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...specs]))
    if (status.length === 0 && untracked.length === 0) return { dir: null, patch: null, tracked: [], untracked: [] }

    const dir = freshDir(root, task.id)
    mkdirSync(dir, { recursive: true })
    const tracked = status.map((entry) => entry.path)
    let patch: string | null = null
    if (tracked.length > 0) {
        patch = join(dir, "changes.patch")
        await git(root, ["diff", "--no-renames", "--binary", `--output=${patch}`, "HEAD", "--", ...specs])
        if (!existsSync(patch) || statSync(patch).size === 0) throw new Refusal("PRESERVE_FAILED", `git wrote no patch for ${String(tracked.length)} changed file(s) of task ${task.id}; nothing was reset`)
    }
    for (const file of untracked) {
        const target = join(dir, "untracked", file)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(join(root, file), target)
    }
    const manifest: Manifest = { task: task.id, base: "HEAD", head: await git(root, ["rev-parse", "HEAD"]), allowPaths: leasePaths(task), tracked: status, untracked, phase: "saved" }
    writeManifest(dir, manifest)
    recordEvent(db, "task-preserved", task.id, { dir, patch, tracked: status, untracked })
    await onSaved?.(dir)

    // Only after the copy and its manifest are on disk is the work tree put back.
    try {
        await resetPreserved(root, dir)
    } catch (error: unknown) {
        throw new PreserveIncomplete(dir, task.id, error instanceof Error ? error.message : String(error))
    }
    return { dir, patch, tracked, untracked }
}

/** The manifest of a preserve folder: what was saved, against which HEAD, and whether the paths were put back (`reset`). */
interface Manifest {
    readonly task: string
    readonly base: string
    readonly head: string
    readonly allowPaths: readonly string[]
    readonly tracked: readonly { readonly kind: string; readonly path: string }[]
    readonly untracked: readonly string[]
    readonly phase: "saved" | "reset"
}

const writeManifest = (dir: string, manifest: Manifest): void => {
    writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** A preserve that saved the work but could not put every path back (a held file on Windows: EBUSY, EPERM); `dir` holds the copy. */
export class PreserveIncomplete extends Refusal {
    public readonly dir: string

    public constructor(dir: string, taskId: string, why: string) {
        super("PRESERVE_RESET_INCOMPLETE", `the work of task ${taskId} is saved in ${dir}, but its paths were not all put back (${why}); finish with starci task verify ${taskId} --recover`)
        this.name = "PreserveIncomplete"
        this.dir = dir
    }
}

/** Removal retries for a file Windows still holds (an editor, an indexer, antivirus). */
const REMOVE = { force: true, recursive: true, maxRetries: 5, retryDelay: 200 } as const

/**
 * Puts a preserved task's paths back from its manifest.json, idempotently: files the saved HEAD knew come back from it, files
 * it did not know (staged or untracked) leave, each step a no-op once done. Marks the manifest `reset` when all of it worked,
 * so a run interrupted half-way is finished by running this again, never by preserving the half-reset tree a second time.
 */
export const resetPreserved = async (root: string, dir: string): Promise<void> => {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest
    if (manifest.phase === "reset") return
    const inHead = manifest.tracked.filter((entry) => entry.kind !== "A").map((entry) => entry.path)
    const added = manifest.tracked.filter((entry) => entry.kind === "A").map((entry) => entry.path)
    await inOrder(chunks(inHead), (part) => git(root, ["checkout", manifest.head, "--", ...part.map(literal)]))
    await inOrder(chunks(added), (part) => git(root, ["rm", "-q", "-f", "--cached", "--ignore-unmatch", "--", ...part.map(literal)]))
    for (const file of [...added, ...manifest.untracked]) rmSync(join(root, file), REMOVE)
    writeManifest(dir, { ...manifest, phase: "reset" })
}
