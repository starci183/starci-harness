import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { git } from "../shared/git.js"
import { leasePaths } from "./leases.js"
import { projectDir } from "./ledger.js"
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
    for (let n = 2; existsSync(dir); n += 1) dir = `${base}.${String(n)}`
    return dir
}

/**
 * Saves a task's dirty work under its allowPaths into `preserved/<task>/` of the project's state folder, outside the repository
 * (a binary patch of the tracked changes against HEAD plus copies of its untracked files), records a `task-preserved` event, then puts those paths back to
 * HEAD: tracked files in the patch are checked out from HEAD (or dropped when HEAD has none), copied untracked files are
 * deleted. Nothing outside the allowPaths is read or touched. Call it while the task still holds its leases, before it
 * ends, so no overlapping task can commit the half-done work in between.
 */
export const preserveTaskPaths = async (root: string, task: TaskRow, db: DatabaseSync): Promise<Preserved> => {
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
    const manifest = { task: task.id, base: "HEAD", head: await git(root, ["rev-parse", "HEAD"]), allowPaths: leasePaths(task), tracked: status, untracked }
    writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    recordEvent(db, "task-preserved", task.id, { dir, patch, tracked: status, untracked })

    // Only after the copy is on disk is the work tree put back: files HEAD knows come back from HEAD, files it does not know leave.
    const inHead = status.filter((entry) => entry.kind !== "A").map((entry) => entry.path)
    const added = status.filter((entry) => entry.kind === "A").map((entry) => entry.path)
    for (const part of chunks(inHead)) await git(root, ["checkout", "HEAD", "--", ...part.map(literal)])
    for (const part of chunks(added)) await git(root, ["rm", "-q", "-f", "--", ...part.map(literal)])
    for (const file of untracked) rmSync(join(root, file), { force: true })
    return { dir, patch, tracked, untracked }
}
