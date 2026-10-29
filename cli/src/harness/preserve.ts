import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { git } from "../shared/git.js"
import { excludedSpec, notOwn } from "./baseline.js"
import { projectDir } from "./ledger.js"
import { inOrder } from "./sequential.js"
import type { TaskRow } from "./tasks.js"
import { recordEvent } from "./tasks.js"
import { taskPaths } from "./contract.js"

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
const pathspecs = (task: TaskRow): string[] => taskPaths(task).map(literal)

/** A folder no earlier preserve of `name` used, in the project's state folder: preserved/<name>, then preserved/<name>.2, .3 ... */
const freshDir = (root: string, name: string): string => {
    const base = join(projectDir(root), "preserved", name)
    let dir = base
    let n = 2
    while (existsSync(dir)) {
        dir = `${base}.${String(n)}`
        n += 1
    }
    return dir
}

/** One tracked path a preserve saved and how it differs from HEAD (`git diff --name-status`: M, A, D ...). */
interface TrackedEntry {
    readonly kind: string
    readonly path: string
}

/** One preserve: the folder name it is saved under, the task it is filed for, the paths it covers and their literal pathspecs. */
interface PreserveScope {
    readonly name: string
    readonly task: string
    readonly paths: readonly string[]
    readonly specs: readonly string[]
}

/** A preserve that found the paths clean. */
const NOTHING: Preserved = { dir: null, patch: null, tracked: [], untracked: [] }

/** What a preserve saved, before anything is put back: its folder and the tracked paths with their kinds. */
interface Saved {
    readonly preserved: Preserved
    readonly dir: string
    readonly status: readonly TrackedEntry[]
}

/**
 * The one preserve of a checkout's dirty work under `scope.specs`: a binary patch of the tracked changes against HEAD, a second
 * one of what the index holds beyond HEAD (`staged.patch`, when it differs), and copies of the untracked files, in a fresh
 * folder of the project's state folder with its manifest; then those paths are put back to HEAD. `onSaved` runs once all of it
 * is on disk and before anything is reset, so the reset never runs ahead of a safe copy. A reset that breaks half-way throws
 * PreserveIncomplete; resetPreserved finishes it.
 */
const preserveScope = async (root: string, scope: PreserveScope, onSaved: (saved: Saved) => Promise<void> | void): Promise<Preserved> => {
    const { specs } = scope
    const raw = fields(await git(root, ["diff", "--no-renames", "--name-status", "-z", "HEAD", "--", ...specs]))
    const status = Array.from({ length: Math.floor(raw.length / 2) }, (_, index) => ({ kind: raw[index * 2] ?? "", path: raw[index * 2 + 1] ?? "" }))
    const untracked = fields(await git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...specs]))
    const staged = fields(await git(root, ["diff", "--cached", "--no-renames", "--name-only", "-z", "HEAD", "--", ...specs]))
    if (status.length === 0 && untracked.length === 0 && staged.length === 0) return NOTHING

    const dir = freshDir(root, scope.name)
    mkdirSync(dir, { recursive: true })
    const tracked = status.map((entry) => entry.path)
    let patch: string | null = null
    if (tracked.length > 0) {
        patch = join(dir, "changes.patch")
        await git(root, ["diff", "--no-renames", "--binary", `--output=${patch}`, "HEAD", "--", ...specs])
        if (!existsSync(patch) || statSync(patch).size === 0) throw new Refusal("PRESERVE_FAILED", `git wrote no patch for ${String(tracked.length)} changed file(s) of ${scope.name}; nothing was reset`)
    }
    if (staged.length > 0) await git(root, ["diff", "--cached", "--no-renames", "--binary", `--output=${join(dir, "staged.patch")}`, "HEAD", "--", ...specs])
    for (const file of untracked) {
        const target = join(dir, "untracked", file)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(join(root, file), target)
    }
    const manifest: Manifest = { task: scope.task, base: "HEAD", head: await git(root, ["rev-parse", "HEAD"]), allowPaths: scope.paths, tracked: status, untracked, phase: "saved" }
    writeManifest(dir, manifest)
    const preserved: Preserved = { dir, patch, tracked, untracked }
    await onSaved({ preserved, dir, status })

    // Only after the copy and its manifest are on disk is the work tree put back.
    try {
        await resetPreserved(root, dir)
    } catch (error: unknown) {
        throw new PreserveIncomplete(dir, scope.task, error instanceof Error ? error.message : String(error))
    }
    return preserved
}

/**
 * Saves a task's dirty work under its allowPaths into `preserved/<task>/` of the project's state folder, outside the repository
 * (preserveScope), records a `task-preserved` event, then puts those paths back to HEAD: tracked files in the patch are checked
 * out from HEAD (or dropped when HEAD has none), copied untracked files are deleted. Nothing outside the allowPaths is read or
 * touched. Call it while the task still holds its leases, before it ends, so no overlapping task can commit the half-done work in
 * between. `onSaved` runs once the copy and its manifest are on disk and before anything is reset: a caller records the folder
 * there (or stores the patch for the next attempt), so the reset never runs ahead of a safe copy. A reset that breaks half-way
 * throws PreserveIncomplete; resetPreserved finishes it.
 */
export const preserveTaskPaths = async (root: string, task: TaskRow, db: DatabaseSync, onSaved?: (dir: string) => Promise<void> | void): Promise<Preserved> => {
    const owned = pathspecs(task)
    if (owned.length === 0) return NOTHING
    // Another task's dirt under these paths (harness/baseline.ts notOwn) is neither saved nor reset: it is not this task's work.
    const specs = [...owned, ...(await notOwn(root, task.id, taskPaths(task))).map(excludedSpec)]
    return preserveScope(root, { name: task.id, task: task.id, paths: taskPaths(task), specs }, async (saved) => {
        recordEvent(db, "task-preserved", task.id, { dir: saved.dir, patch: saved.preserved.patch, tracked: saved.status, untracked: saved.preserved.untracked })
        await onSaved?.(saved.dir)
    })
}

/** The event that names what a fast-forward found dirty in the checkout it writes: the files dropped and the preserve of the rest. */
export const LAND_STALE_EVENT = "land-stale"

/** What clearing a fast-forward's paths did: the files dropped (their content is HEAD's or the candidate's) and the preserve of the rest. */
export interface StaleCleared {
    readonly dropped: readonly string[]
    readonly preserved: Preserved
}

/** The blob each path holds at `rev` (`ls-tree`), or in the index (`ls-files --stage`, stage 0) when `rev` is null. */
const blobsAt = async (root: string, rev: string | null, specs: readonly string[]): Promise<Map<string, string>> => {
    const listing = rev === null ? await git(root, ["ls-files", "--stage", "-z", "--", ...specs]) : await git(root, ["ls-tree", "-r", "-z", rev, "--", ...specs])
    const blobs = new Map<string, string>()
    for (const entry of fields(listing)) {
        const tab = entry.indexOf("\t")
        const head = entry.slice(0, tab).split(" ")
        if (rev === null && head[2] !== "0") continue
        blobs.set(entry.slice(tab + 1), head[rev === null ? 1 : 2] ?? "")
    }
    return blobs
}

/** The blob of each path's work-tree content, cleaned by its attributes as `git add` would; a path with no file has none. */
const workBlobs = async (root: string, paths: readonly string[]): Promise<Map<string, string>> => {
    const present = paths.filter((path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile())
    const blobs = new Map<string, string>()
    await inOrder(chunks(present), async (part) => {
        const hashes = (await git(root, ["hash-object", "--", ...part])).split(/\r?\n/)
        part.forEach((path, index) => blobs.set(path, (hashes[index] ?? "").trim()))
    })
    return blobs
}

/** Removal retries for a file Windows still holds (an editor, an indexer, antivirus). */
const REMOVE = { force: true, recursive: true, maxRetries: 5, retryDelay: 200 } as const

/**
 * Puts `inHead` back from `head` and takes `gone` (paths `head` does not hold) out of the index and off the disk, idempotently.
 * The one put-back of a preserve (resetPreserved) and of the paths a fast-forward writes (clearStale).
 */
const putBack = async (root: string, head: string, inHead: readonly string[], gone: readonly string[]): Promise<void> => {
    await inOrder(chunks(inHead), (part) => git(root, ["checkout", head, "--", ...part.map(literal)]))
    await inOrder(chunks(gone), (part) => git(root, ["rm", "-q", "-f", "--cached", "--ignore-unmatch", "--", ...part.map(literal)]))
    for (const file of gone) rmSync(join(root, file), REMOVE)
}

/**
 * Clears, before a fast-forward of `root` from its HEAD to `candidate`, the paths it writes and the task's own `allowPaths`:
 * git refuses to overwrite a written path while it is dirty, modified or staged (a line-ending-only difference included, which
 * `git diff` hides and the merge still refuses) or untracked, and the checkout a task lands on holds none of its work once it
 * landed. A dirty path whose work-tree content and index entry each are HEAD's or the candidate's holds nothing git lacks and is
 * dropped; the rest is preserved first (preserveScope, into `preserved/land-<task>`, which no settle deletes), and the
 * `land-stale` event naming both sets is recorded before anything is put back. Then every dirty path goes back to HEAD, so the
 * fast-forward writes it; any other path is left as it is. Null when none was dirty. Call it under the land lock, on the HEAD
 * the candidate's parent is.
 */
export const clearStale = async (root: string, db: DatabaseSync, taskId: string, candidate: string, allowPaths: readonly string[]): Promise<StaleCleared | null> => {
    const head = await git(root, ["rev-parse", "HEAD"])
    const written = fields(await git(root, ["diff", "--no-renames", "--name-only", "-z", head, candidate]))
    const dirty = new Set<string>()
    await inOrder(chunks([...written, ...allowPaths]), async (part) => {
        const specs = part.map(literal)
        const listings = [
            ["diff-files", "--name-only", "-z", "--", ...specs],
            ["diff-index", "--cached", "--name-only", "-z", head, "--", ...specs],
            ["ls-files", "--others", "--exclude-standard", "-z", "--", ...specs],
        ]
        await inOrder(listings, async (args) => {
            for (const path of fields(await git(root, args))) dirty.add(path)
        })
    })
    if (dirty.size === 0) return null
    const paths = [...dirty]
    const specs = paths.map(literal)
    const atHead = await blobsAt(root, head, specs)
    const atCandidate = await blobsAt(root, candidate, specs)
    const inIndex = await blobsAt(root, null, specs)
    const inWork = await workBlobs(root, paths)
    const inGit = (path: string, blob: string | undefined): boolean => blob === atHead.get(path) || blob === atCandidate.get(path)
    const differs = paths.filter((path) => !inGit(path, inWork.get(path)) || !(inGit(path, inIndex.get(path)) || inIndex.get(path) === inWork.get(path)))
    const dropped = paths.filter((path) => !differs.includes(path))
    const record = (preserved: Preserved): void => {
        recordEvent(db, LAND_STALE_EVENT, taskId, { target: root, head, candidate, dropped, files: differs, preserved: preserved.dir, patch: preserved.patch })
    }
    let preserved = NOTHING
    if (differs.length > 0) {
        preserved = await preserveScope(root, { name: `land-${taskId}`, task: taskId, paths: differs, specs: differs.map(literal) }, (saved) => { record(saved.preserved) })
        if (preserved.dir === null) throw new Refusal("PRESERVE_FAILED", `${differs.join(", ")} hold content neither HEAD nor the candidate has, and git saw none of it to save; nothing was reset`)
    } else record(preserved)
    await putBack(root, head, paths.filter((path) => atHead.has(path)), paths.filter((path) => !atHead.has(path)))
    return { dropped, preserved }
}

/** The manifest of a preserve folder: what was saved, against which HEAD, and whether the paths were put back (`reset`). */
interface Manifest {
    readonly task: string
    readonly base: string
    readonly head: string
    readonly allowPaths: readonly string[]
    readonly tracked: readonly TrackedEntry[]
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
    await putBack(root, manifest.head, inHead, [...added, ...manifest.untracked])
    writeManifest(dir, { ...manifest, phase: "reset" })
}
