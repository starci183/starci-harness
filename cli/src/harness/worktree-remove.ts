import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, rmdirSync, statSync, unlinkSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { Refusal } from "../shared/errors.js"
import { captureGit, samePath } from "../shared/git.js"
import { releaseRemoveLock, takeRemoveLock } from "./remove-lock.js"

/**
 * Safe worktree removal (`starci lane remove`, contexts/authority/README.md "Worktrees"). Git, robocopy and `rmdir /S` follow the
 * directory junctions npm makes for workspace links and the install cache, so a recursive removal of a worktree that still holds
 * one empties the folder the junction names (2026-11-20: another lane's node_modules and 2533 tracked files). This module is the one
 * way to remove a lane worktree: it finds every link without entering one, unlinks each link itself, checks that no link remains and
 * that every target survived, and only then lets git remove what is left, with a delete that reads each entry with lstat.
 */

/** One link found in a worktree. */
export interface FoundLink {
    /** Absolute path of the link. */
    readonly path: string
    /** Relative to the worktree, slash-separated. */
    readonly relative: string
    /** What the link names, as stored. */
    readonly target: string
    /** A directory junction or directory symlink (rmdir on Windows) rather than a file link. */
    readonly directory: boolean
    /** The target existed when it was found. */
    readonly targetExists: boolean
}

/** A registered worktree of a repository. */
export interface WorktreeEntry {
    readonly path: string
    readonly branch: string | undefined
    readonly head: string
    readonly main: boolean
}

const slashed = (path: string): string => path.replaceAll("\\", "/")

/** The worktrees of the repository `cwd` belongs to, the main checkout first (`git worktree list --porcelain`). */
export const listWorktrees = async (cwd: string): Promise<WorktreeEntry[]> => {
    const run = await captureGit(["worktree", "list", "--porcelain"], cwd)
    if (run.exitCode !== 0) throw new Refusal("GIT_NOT_A_REPOSITORY", `${cwd} is not inside a git repository: ${run.stderr.trim()}`)
    const entries: WorktreeEntry[] = []
    for (const block of run.stdout.split(/\r?\n\r?\n/)) {
        const lines = block.split(/\r?\n/)
        const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length)
        if (path === undefined || path === "") continue
        const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length).replace(/^refs\/heads\//, "")
        entries.push({ path: resolve(path), branch, head: lines.find((line) => line.startsWith("HEAD "))?.slice(5) ?? "", main: entries.length === 0 })
    }
    return entries
}

/** True when `inner` is `outer` or inside it. */
const within = (outer: string, inner: string): boolean => {
    const rel = relative(resolve(outer), resolve(inner))
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

/** The worktree a path names: registered, not the main checkout, not the folder the caller stands in. Refused otherwise. */
export const resolveWorktree = async (given: string, caller: string): Promise<{ readonly entry: WorktreeEntry; readonly main: WorktreeEntry }> => {
    const path = resolve(caller, given)
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat === undefined) throw new Refusal("WORKTREE_NOT_FOUND", `${path} does not exist`)
    if (!stat.isDirectory()) throw new Refusal("WORKTREE_NOT_REGISTERED", `${path} is not a folder (or is a link): name the worktree folder itself`)
    const entries = await listWorktrees(path)
    const main = entries[0]
    const entry = entries.find((candidate) => samePath(candidate.path, path))
    if (main === undefined || entry === undefined) throw new Refusal("WORKTREE_NOT_REGISTERED", `${path} is not a registered git worktree (git worktree list --porcelain of its repository)`)
    if (entry.main) throw new Refusal("WORKTREE_IS_MAIN", `${path} is the main checkout of its repository, not a linked worktree`)
    if (within(path, caller)) throw new Refusal("WORKTREE_IS_CALLER", `the command runs inside ${path}: run it from outside the worktree`)
    return { entry, main }
}

/** Tracked changes of a worktree (staged or not); untracked files are not read at all, so no untracked folder is walked. */
export const trackedChanges = async (worktree: string): Promise<string[]> => {
    const run = await captureGit(["status", "--porcelain=v1", "--untracked-files=no"], worktree)
    if (run.exitCode !== 0) throw new Refusal("WORKTREE_STATUS_FAILED", `git status failed in ${worktree}: ${run.stderr.trim()}`)
    return run.stdout.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith("??"))
}

const caseless = (path: string): string => (process.platform === "win32" ? slashed(path).toLowerCase() : slashed(path))

const realOf = (path: string): string => realpathSync.native(path)

/**
 * Every link in a tree, at any depth, node_modules and workspace links included, found without entering one: each entry is read with
 * lstat (a Dirent), so a directory junction, which Node reports as a symbolic link on Windows, is listed and never walked. A real
 * directory whose own real path is not where the walk is (a reparse point Node does not call a link, a mount) is refused by name.
 */
export const findLinks = (root: string): FoundLink[] => {
    const links: FoundLink[] = []
    const walk = (at: string, expected: string): void => {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
            const path = join(at, entry.name)
            const want = join(expected, entry.name)
            if (entry.isSymbolicLink()) {
                const followed = statSync(path, { throwIfNoEntry: false })
                links.push({ path, relative: slashed(relative(root, path)), target: readlinkSync(path), directory: followed?.isDirectory() ?? process.platform === "win32", targetExists: followed !== undefined })
            } else if (entry.isDirectory()) {
                if (caseless(realOf(path)) !== caseless(want)) throw new Refusal("WORKTREE_REPARSE_POINT", `${path} is a folder that resolves to ${realOf(path)}, not here: a reparse point this tool does not know; remove it by hand before the worktree`)
                walk(path, want)
            }
        }
    }
    walk(root, realOf(root))
    return links
}

/** What unlinking did to one link. */
export interface Unlinked {
    readonly link: FoundLink
    readonly targetSurvived: boolean
}

/** Unlinks one link itself: unlinkSync for a file link, rmdirSync for a directory junction on Windows; the other call is the fallback. */
const unlinkOne = (link: FoundLink): void => {
    const useRmdir = link.directory && process.platform === "win32"
    try {
        if (useRmdir) rmdirSync(link.path)
        else unlinkSync(link.path)
    } catch (error) {
        try {
            if (useRmdir) unlinkSync(link.path)
            else rmdirSync(link.path)
        } catch {
            throw error
        }
    }
}

/** Unlinks every link, never a target, and verifies each with lstat: the link is gone and a target that existed still does. */
export const unlinkLinks = (links: readonly FoundLink[]): Unlinked[] => {
    const done: Unlinked[] = []
    for (const link of links) {
        unlinkOne(link)
        if (lstatSync(link.path, { throwIfNoEntry: false }) !== undefined) throw new Refusal("WORKTREE_LINK_REMAINS", `${link.path} is still there after it was unlinked`)
        const targetSurvived = !link.targetExists || existsSync(resolve(join(link.path, ".."), link.target))
        if (!targetSurvived) throw new Refusal("WORKTREE_TARGET_GONE", `${link.target} (the target of ${link.path}) no longer exists after the unlink: stopping`)
        done.push({ link, targetSurvived })
    }
    return done
}

/** Deletes a tree with lstat on every entry: a link is refused, a folder is emptied then removed, never a recursive delete that follows. Returns how many entries went. */
export const deleteTree = (root: string): number => {
    let count = 0
    const walk = (at: string): void => {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
            const path = join(at, entry.name)
            if (entry.isSymbolicLink()) throw new Refusal("WORKTREE_LINK_REMAINS", `${path} is a link: it must be unlinked, never deleted through`)
            if (entry.isDirectory()) {
                walk(path)
                rmdirSync(path)
            } else unlinkSync(path)
            count++
        }
    }
    if (lstatSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) return 0
    walk(root)
    rmdirSync(root)
    return count + 1
}

/** The plan of a removal, read from the tree and changing nothing. */
export interface RemovePlan {
    readonly worktree: string
    readonly main: string
    readonly branch: string | undefined
    readonly dirty: readonly string[]
    readonly links: readonly FoundLink[]
}

/** Judges a removal: the worktree resolved, its tracked changes, every link in it. Refused when a tracked change stands and `discard` is not given. */
export const planRemoval = async (given: string, caller: string, discard: boolean): Promise<RemovePlan> => {
    const { entry, main } = await resolveWorktree(given, caller)
    const dirty = await trackedChanges(entry.path)
    if (dirty.length > 0 && !discard) throw new Refusal("WORKTREE_DIRTY", `${entry.path} has ${String(dirty.length)} tracked change(s) that removal would discard; commit them, or pass --discard to throw them away:\n${dirty.slice(0, 10).join("\n")}`)
    return { worktree: entry.path, main: main.path, branch: entry.branch, dirty, links: findLinks(entry.path) }
}

/** What an executed removal did. */
export interface Removed {
    readonly plan: RemovePlan
    readonly unlinked: readonly Unlinked[]
    readonly leftover: number
    readonly branchKept: boolean
    readonly lock: string
}

/**
 * Removes a worktree: the removal lock first (so no install creates a junction meanwhile), then links unlinked, a second walk that must
 * find none, `git worktree remove --force` and `git worktree prune`, a link-free delete of what remains, the branch kept, the lock released.
 */
export const removeWorktree = async (plan: RemovePlan, lane: string, say: (line: string) => void): Promise<Removed> => {
    const lock = takeRemoveLock(plan.worktree, lane)
    try {
        // The links are listed again under the lock: an install that ran before it may have made more since the plan.
        const links = findLinks(plan.worktree)
        say(`unlinking ${String(links.length)} link(s), links only`)
        const unlinked = unlinkLinks(links)
        const remaining = findLinks(plan.worktree)
        if (remaining.length > 0) throw new Refusal("WORKTREE_LINK_REMAINS", `a link remains in ${plan.worktree} after unlinking: ${remaining.map((link) => link.path).join(", ")}; nothing was removed`)
        const removal = await captureGit(["worktree", "remove", "--force", plan.worktree], plan.main)
        if (removal.exitCode !== 0) {
            if (!existsSync(plan.worktree)) throw new Refusal("WORKTREE_REMOVE_FAILED", `git worktree remove failed: ${removal.stderr.trim()}`)
            say(`git worktree remove did not finish (${removal.stderr.trim()}); deleting what is left without following a link`)
        }
        const left = existsSync(plan.worktree) ? findLinks(plan.worktree) : []
        if (left.length > 0) throw new Refusal("WORKTREE_LINK_REMAINS", `a link appeared in ${plan.worktree}: ${left.map((link) => link.path).join(", ")}; nothing more was deleted`)
        const leftover = existsSync(plan.worktree) ? deleteTree(plan.worktree) : 0
        await captureGit(["worktree", "prune"], plan.main)
        const branchKept = plan.branch === undefined || (await captureGit(["show-ref", "--verify", "--quiet", `refs/heads/${plan.branch}`], plan.main)).exitCode === 0
        return { plan, unlinked, leftover, branchKept, lock: lock.file }
    } finally {
        releaseRemoveLock(lock)
    }
}

/** The holder name for a removal: the lane named, else STARCI_LANE, else the worktree's lane branch, else its folder name. */
export const removalLane = (given: string | undefined, plan: RemovePlan): string => {
    const raw = given ?? process.env.STARCI_LANE ?? plan.branch?.replace(/^lane\//, "") ?? basename(plan.worktree)
    return raw.replaceAll(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "lane"
}
