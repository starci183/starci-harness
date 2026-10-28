import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { headline } from "../shared/exec.js"
import { captureGit, currentBranch, git, isAncestor, refExists, resolveSha, samePath } from "../shared/git.js"
import { readRecord } from "../core/deps/packages.js"
import { linkCachedInstall, lockfileFolders, modulesFolders, unlinkCheckoutLinks, unlinkInstallLinks } from "./install-cache.js"
import { openLedger, projectDir } from "./ledger.js"
import { inOrder } from "./sequential.js"
import { thisVerifier, withSettleLock } from "./settle.js"
import { getTask, isTerminal, lastEvent, listTasks, recordEvent, recordTaskWorktree } from "./tasks.js"
import type { TaskRow } from "./tasks.js"
import { closeWorktreeTerminals, orcaBinarySync, worktreeRemove } from "./orca/client.js"
import { busyDue, busyRecordOf, clearBusy, isBusyFailure, recordBusy } from "./worktree-busy.js"
import { getWorkflow } from "./workflow.js"
import { materialiseHooks } from "./worktree.js"

/** The attempt outcome of a task whose verified work did not rebase onto the head it lands on: a textual conflict. */
export const LAND_CONFLICT = "conflict"

/** The event that names a land conflict's files, the head it met and the preserved work. */
export const LAND_CONFLICT_EVENT = "land-conflict"

const MADE_EVENT = "op-worktree"

const REMOVED_EVENT = "op-worktree-removed"

/**
 * One Op's own git worktree: `path` on `branch`, cut at `fork` from `targetBranch`, the branch its verified commit lands on,
 * checked out at `target` (the workflow's worktree, else the checkout an inline workflow runs in). `links` are the
 * install folders linkInstall made, which removal unlinks.
 */
export interface OpWorktree {
    readonly path: string
    readonly branch: string
    readonly fork: string
    readonly target: string
    readonly targetBranch: string
    readonly links: readonly string[]
}

/** Where a verified commit lands: `checkout` on `branch`; `own` when the task works in that checkout itself (it has no Op worktree). */
export interface LandTarget {
    readonly checkout: string
    readonly branch: string
    readonly own: boolean
}

const withLedger = <T>(root: string, work: (db: DatabaseSync) => T): T => {
    const db = openLedger(root)
    try {
        return work(db)
    } finally {
        db.close()
    }
}

const asOpWorktree = (value: unknown): OpWorktree | undefined => {
    if (typeof value !== "object" || value === null) return undefined
    const record = value as Record<string, unknown>
    const strings = ["path", "branch", "fork", "target", "targetBranch"] as const
    if (!strings.every((key) => typeof record[key] === "string")) return undefined
    const links = Array.isArray(record.links) ? record.links.filter((link): link is string => typeof link === "string") : []
    return { path: String(record.path), branch: String(record.branch), fork: String(record.fork), target: String(record.target), targetBranch: String(record.targetBranch), links }
}

/** The Op worktree a task was given, if any. */
export const opWorktreeOf = (db: DatabaseSync, taskId: string): OpWorktree | undefined => asOpWorktree(lastEvent(db, MADE_EVENT, taskId))

/**
 * Where an Op of a workflow works: `<project state>/worktrees/<workflow>.ops/<task>` on branch `starci/<workflow>.ops/<task>`.
 * The folder sits beside the workflow's worktree, never inside it (a nested checkout would be a stray gitlink in the
 * workflow's tree), and the branch names `<workflow>.ops`, since git keeps no branch below another branch's name.
 */
export const opWorktreePlace = (root: string, workflowId: string, taskId: string): { readonly path: string; readonly branch: string } => ({
    path: join(projectDir(root), "worktrees", `${workflowId}.ops`, taskId),
    branch: `starci/${workflowId}.ops/${taskId}`,
})

/**
 * Gives an Op worktree an install without running npm, for each node_modules folder of the target and each lockfile folder of
 * the worktree: from the shared install cache when it holds the key of that folder's lockfile (harness/install-cache.ts
 * linkCachedInstall, as a clean verify gets it), else linked to the target's own folder when it has one (a junction on Windows,
 * a symlink elsewhere). A repository in local package mode (`starci deps source --local`) always links the target's folder, so
 * its local `@starci` copies reach the Op. Returns the folders made, relative to the worktree.
 */
const linkInstall = (target: string, worktree: string): string[] => {
    const local = (readRecord(target)?.packages.length ?? 0) > 0
    const folders = new Set([...modulesFolders(target), ...lockfileFolders(worktree).map((folder) => (folder === "." ? "node_modules" : `${folder}/node_modules`))])
    return [...folders].flatMap((folder) => {
        const path = join(worktree, folder)
        if (!existsSync(dirname(path)) || existsSync(path)) return []
        if (!local && linkCachedInstall(dirname(path))) return [folder]
        if (!existsSync(join(target, folder))) return []
        symlinkSync(join(target, folder), path, process.platform === "win32" ? "junction" : "dir")
        return [folder]
    })
}

/** How one worktree folder's removal ended: removed (or gone already), or left with what refused it and whether that reads as busy. */
export interface FolderRemoval {
    readonly removed: boolean
    readonly busy: boolean
    readonly detail: string
    /** The Orca terminals closed because their worktree was this folder. */
    readonly terminals: readonly string[]
}

/** How long a removal waits after closing a worktree's terminals, for their shells to exit. */
const TERMINAL_EXIT_MS = 2_000

const pause = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""

/** True when git still lists `path` as a worktree of `repo`. */
const gitLists = async (repo: string, path: string): Promise<boolean> => {
    const listed = await captureGit(["worktree", "list", "--porcelain"], repo)
    return [...listed.stdout.matchAll(/^worktree (.+)$/gm)].some((match) => samePath((match[1] ?? "").trim(), path))
}

/**
 * Removes one harness worktree. The Orca terminals whose worktree it is are closed first (any terminal, not only a seat's: a
 * process working in the folder keeps Windows from removing it, and a removed worktree's terminals mean nothing), then its
 * install links are unlinked (link only). An orca run's worktree goes through `orca worktree rm`, so Orca's worktree list and
 * git stay in step; git removes it when Orca is not used, cannot be reached, or left the folder. A folder git emptied and no
 * longer lists (its rmdir was refused) is removed as the one empty folder it is. A folder git no longer lists that holds no
 * `.git` but still holds files (one Windows would not let git delete, such as a file named `nul`) is deleted with every link
 * in it unlinked first, never entered, when this call deregistered it or `remnant` says it is a harness folder left half
 * removed.
 */
export const removeWorktreeFolder = async (repo: string, path: string, viaOrca: boolean, links: readonly string[] = [], remnant = false): Promise<FolderRemoval> => {
    if (!existsSync(path)) return { removed: true, busy: false, detail: "gone already", terminals: [] }
    const binary = orcaBinarySync()
    const terminals = binary === undefined ? [] : await closeWorktreeTerminals(binary, path, repo).catch(() => [])
    // A closed tab's shell takes a moment to exit and let go of its working folder.
    if (terminals.length > 0) await pause(TERMINAL_EXIT_MS)
    unlinkInstallLinks(path, links)
    const refusals: string[] = []
    const listedAtStart = await gitLists(repo, path)
    if (viaOrca && binary !== undefined) await worktreeRemove(binary, path, repo).catch((error: unknown) => refusals.push(`orca: ${reason(error)}`))
    if (existsSync(path) && (await gitLists(repo, path))) {
        const removed = await captureGit(["worktree", "remove", "--force", path], repo)
        if (removed.exitCode !== 0) refusals.push(`git: ${headline(removed.stderr) || `exit ${String(removed.exitCode)}`}`)
    }
    if (existsSync(path) && !(await gitLists(repo, path))) {
        try {
            if (readdirSync(path).length === 0) rmdirSync(path)
            else if ((remnant || listedAtStart) && !existsSync(join(path, ".git"))) {
                unlinkCheckoutLinks(path)
                rmSync(path, { recursive: true, force: true })
            } else refusals.push("git no longer lists it, and the folder still holds files")
        } catch (error: unknown) {
            refusals.push(`rmdir: ${reason(error)}`)
        }
    }
    if (!existsSync(path)) return { removed: true, busy: false, detail: "removed", terminals }
    const detail = refusals.join("; ") || "the folder stayed"
    return { removed: false, busy: isBusyFailure(detail), detail, terminals }
}

/** One harness worktree to remove under the busy record: its folder, the repository it is removed from, its owner and kind. */
export interface TrackedWorktree {
    readonly path: string
    readonly repo: string
    readonly owner: string | null
    readonly kind: string
    readonly viaOrca: boolean
    readonly links?: readonly string[]
    /** True for a harness folder git no longer lists that a removal left half done: its remaining files may be deleted. */
    readonly remnant?: boolean
}

/** How a tracked removal ended: removed, left (busy, retried by `worktree gc` from `retryAt`), or left for another reason. */
export interface TrackedRemoval {
    readonly removed: boolean
    readonly busy: boolean
    readonly detail: string
    readonly retryAt: string | null
}

/**
 * Removes a harness worktree (removeWorktreeFolder) with its busy record in the ledger of `root` (harness/worktree-busy.ts): a
 * folder whose earlier removal was refused as busy is not tried again before its backoff runs out; a busy refusal now, or any
 * refusal of a folder already busy, records the next attempt; a removal that succeeds ends the record. Never throws for a
 * refused removal, so no settle waits on or fails over a held folder.
 */
export const removeTracked = async (root: string, worktree: TrackedWorktree): Promise<TrackedRemoval> => {
    const pending = withLedger(root, (db) => busyRecordOf(db, worktree.path))
    if (pending !== undefined && !busyDue(pending) && existsSync(worktree.path)) {
        return { removed: false, busy: true, detail: `left busy (attempt ${String(pending.attempt)}: ${pending.detail}); worktree gc retries it from ${pending.nextAt}`, retryAt: pending.nextAt }
    }
    const removal = await removeWorktreeFolder(worktree.repo, worktree.path, worktree.viaOrca, worktree.links ?? [], worktree.remnant === true || pending !== undefined)
    if (removal.removed) {
        if (pending !== undefined) withLedger(root, (db) => { clearBusy(db, worktree.path, removal.detail) })
        return { removed: true, busy: false, detail: removal.terminals.length === 0 ? removal.detail : `${removal.detail} after closing its terminals ${removal.terminals.join(", ")}`, retryAt: null }
    }
    if (!removal.busy && pending === undefined) return { removed: false, busy: false, detail: removal.detail, retryAt: null }
    const record = await recordBusy(root, { path: worktree.path, repo: worktree.repo, owner: worktree.owner, kind: worktree.kind, detail: removal.detail, terminals: removal.terminals })
    return { removed: false, busy: true, detail: `left busy (attempt ${String(record.attempt)}: ${removal.detail}); worktree gc retries it from ${record.nextAt}`, retryAt: record.nextAt }
}

/** How long a start waits for another process making the same task's Op worktree. */
const OP_WORKTREE_LOCK_MS = 120_000

/** The lock a task's Op worktree is made under (a ledger row, harness/settle.ts withSettleLock). */
const opWorktreeLockKey = (taskId: string): string => `op-worktree-lock:${taskId}`

const madeOpWorktree = (root: string, taskId: string): OpWorktree | undefined => {
    const known = withLedger(root, (db) => opWorktreeOf(db, taskId))
    return known !== undefined && existsSync(known.path) ? known : undefined
}

/**
 * The Op worktree of a task: made on its first start, reused after. It is cut from the head of the branch `target` has
 * checked out (the workflow's branch), on a branch of its own, with the product's hooks and the target's install linked in;
 * the task records it as its checkout, so verify, cancel, preserve and a failed result act there. Concurrent starts of one
 * task (parallel workflow steps) make it one at a time under the task's Op worktree lock: two `git worktree add` of one path
 * race, and the loser's cleanup deletes the folder the winner is checking out.
 */
export const ensureOpWorktree = async (root: string, taskId: string, target: string): Promise<OpWorktree> => {
    const ready = madeOpWorktree(root, taskId)
    if (ready !== undefined) return ready
    const db = openLedger(root)
    try {
        return await withSettleLock(db, thisVerifier(taskId), OP_WORKTREE_LOCK_MS, opWorktreeLockKey(taskId), () => makeOpWorktree(root, taskId, target))
    } finally {
        db.close()
    }
}

const makeOpWorktree = async (root: string, taskId: string, target: string): Promise<OpWorktree> => {
    const { task, known } = withLedger(root, (db) => ({ task: getTask(db, taskId), known: opWorktreeOf(db, taskId) }))
    if (known !== undefined && existsSync(known.path)) return known
    if (task.workflowId === null) throw new Refusal("OP_WORKTREE_NO_WORKFLOW", `task ${taskId} belongs to no workflow; it works in the checkout it was sent from`)
    const targetBranch = await currentBranch(target)
    if (targetBranch === undefined) throw new Refusal("HEAD_DETACHED", `${target} is on a detached HEAD; an Op is cut from, and lands on, the branch its workflow has checked out`)
    const { path, branch } = opWorktreePlace(root, task.workflowId, taskId)
    const fork = await resolveSha(target, `refs/heads/${targetBranch}`)
    mkdirSync(dirname(path), { recursive: true })
    const args = (await refExists(target, `refs/heads/${branch}`)) ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, fork]
    if (!existsSync(path)) await git(target, args)
    await materialiseHooks(root, path)
    const links = linkInstall(target, path)
    const made: OpWorktree = { path, branch, fork, target, targetBranch, links }
    withLedger(root, (db) => {
        recordTaskWorktree(db, taskId, path)
        recordEvent(db, MADE_EVENT, taskId, made)
    })
    return made
}

/** Where a task's verified commit lands: its Op worktree's target branch, else the branch of the checkout it works in. */
export const landTargetOf = async (db: DatabaseSync, task: TaskRow, checkout: string): Promise<LandTarget> => {
    const made = opWorktreeOf(db, task.id)
    if (made !== undefined) return { checkout: made.target, branch: made.targetBranch, own: false }
    const branch = await currentBranch(checkout)
    if (branch === undefined) throw new Refusal("HEAD_DETACHED", `${checkout} is on a detached HEAD; check out the branch the task lands on, then verify again`)
    return { checkout, branch, own: true }
}

/** The land lock of a target: one per branch, so landings onto one branch run one at a time and other branches never wait. */
export const landLockKey = (target: LandTarget): string => `land-lock:${target.branch}`

/** A candidate that did not rebase onto the head it lands on: the files git could not merge. */
export class LandConflict extends Refusal {
    public readonly files: readonly string[]
    public readonly onto: string

    public constructor(files: readonly string[], onto: string) {
        super("LAND_CONFLICT", `the task's work does not rebase onto ${onto.slice(0, 12)}: ${files.join(", ") || "git named no file"} conflict`)
        this.name = "LandConflict"
        this.files = files
        this.onto = onto
    }
}

/**
 * Rebases a candidate commit onto `onto` without a work tree: a three-way merge of the candidate with its own parent as the
 * base (`git merge-tree --write-tree`), committed on `onto` with the candidate's message. A textual conflict throws
 * LandConflict and is never resolved here: the task returns with its work preserved for an amend on the new head.
 */
export const rebaseCandidate = async (root: string, candidate: string, parent: string, onto: string): Promise<{ readonly commit: string; readonly tree: string }> => {
    if (onto === parent) return { commit: candidate, tree: await git(root, ["rev-parse", `${candidate}^{tree}`]) }
    const merged = await captureGit(["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${parent}`, onto, candidate], root)
    const lines = merged.stdout.split(/\r?\n/).filter((line) => line !== "")
    if (merged.exitCode === 1) throw new LandConflict(lines.slice(1), onto)
    const tree = lines[0]
    if (merged.exitCode !== 0 || tree === undefined) throw new Refusal("CLI_TOOL_FAILED", `git merge-tree onto ${onto.slice(0, 12)} failed: ${headline(merged.stderr) || "exit " + String(merged.exitCode)}`)
    const message = await git(root, ["log", "-1", "--format=%B", candidate])
    return { commit: await git(root, ["commit-tree", tree, "-p", onto, "-m", message]), tree }
}

/** One line on an Op worktree's removal: removed, or left and why. */
export interface WorktreeRemoval {
    readonly task: string
    readonly path: string
    readonly removed: boolean
    readonly branch: "deleted" | "kept" | "gone"
    readonly detail: string
    /** True when the folder was left busy for `worktree gc` to retry (harness/worktree-busy.ts). */
    readonly busy?: boolean
}

/**
 * Removes a settled task's Op worktree by code (removeTracked: its Orca terminals closed, its install links unlinked as links,
 * then Orca and git), then deletes its branch once its tip is on the target branch (it landed, or carries nothing); a branch
 * holding commits that never landed is kept and named. A folder the host holds is left busy for `worktree gc` to retry and never
 * fails the caller. Undefined when the task has no Op worktree or it was removed already.
 */
export const removeOpWorktree = async (root: string, taskId: string): Promise<WorktreeRemoval | undefined> => {
    const { made, gone, orca } = withLedger(root, (db) => {
        const task = getTask(db, taskId)
        const runner = task.workflowId === null ? undefined : getWorkflow(db, task.workflowId).header.runner
        return { made: opWorktreeOf(db, taskId), gone: lastEvent(db, REMOVED_EVENT, taskId) !== undefined, orca: runner === "orca" }
    })
    if (made === undefined || gone) return undefined
    const removal = await removeTracked(root, { path: made.path, repo: made.target, owner: taskId, kind: "op", viaOrca: orca, links: made.links, remnant: true })
    if (!removal.removed) {
        if (removal.busy) return { task: taskId, path: made.path, removed: false, branch: "kept", detail: removal.detail, busy: true }
        const detail = `worktree remove failed (${removal.detail}); the next workflow step tries again`
        withLedger(root, (db) => { recordEvent(db, "op-worktree-left", taskId, { path: made.path, detail }) })
        return { task: taskId, path: made.path, removed: false, branch: "kept", detail }
    }
    await captureGit(["worktree", "prune"], made.target)
    const branch = await settleBranch(made)
    const detail = branch === "kept" ? `branch ${made.branch} kept: it carries commits that never landed on ${made.targetBranch}` : `branch ${made.branch} ${branch}`
    withLedger(root, (db) => { recordEvent(db, REMOVED_EVENT, taskId, { path: made.path, branch, detail }) })
    return { task: taskId, path: made.path, removed: true, branch, detail }
}

/**
 * Deletes a removed Op worktree's branch once its tip is on the target branch. Another settler (a detached verify job, a step's
 * sweep) may delete it at any point between the looks and the delete: a git failure while the branch is gone means it is gone.
 */
const settleBranch = async (made: OpWorktree): Promise<WorktreeRemoval["branch"]> => {
    const ref = `refs/heads/${made.branch}`
    try {
        if (!(await refExists(made.target, ref))) return "gone"
        const tip = await resolveSha(made.target, ref)
        if (tip !== made.fork && !(await isAncestor(made.target, tip, `refs/heads/${made.targetBranch}`))) return "kept"
        await git(made.target, ["branch", "-D", made.branch])
        return "deleted"
    } catch (error: unknown) {
        if (!(await refExists(made.target, ref))) return "gone"
        throw error
    }
}

/**
 * Removes the Op worktree of every task of the repository's ledger that settled (done, failed or cancelled, holding no intent)
 * and still has one: the safety net behind the removal each verify and cancel does, for a task a fence, a stall or a crash
 * ended. A task awaiting the owner keeps its worktree, where its work was left for the owner.
 */
export const sweepOpWorktrees = async (root: string, workflowId?: string): Promise<WorktreeRemoval[]> => {
    const due = withLedger(root, (db) =>
        listTasks(db, workflowId)
            .filter((task) => isTerminal(task.status) && task.status !== "awaiting_owner" && task.intent === null)
            .filter((task) => lastEvent(db, REMOVED_EVENT, task.id) === undefined)
            .filter((task) => {
                const made = opWorktreeOf(db, task.id)
                if (made === undefined) return false
                // A folder left busy waits for its backoff; worktree gc retries it then, so a step neither retries nor reports it.
                const busy = busyRecordOf(db, made.path)
                return busy === undefined || busyDue(busy)
            })
            .map((task) => task.id),
    )
    const removed = await inOrder(due, (taskId) => removeOpWorktree(root, taskId))
    return removed.filter((entry): entry is WorktreeRemoval => entry !== undefined)
}
