import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { headline } from "../shared/exec.js"
import { captureGit, currentBranch, git, refExists, resolveSha, samePath } from "../shared/git.js"
import { readRecord } from "../core/deps/packages.js"
import { enablePatterns, patternsOfPaths } from "./hfs-patterns.js"
import { linkCachedInstall, lockfileFolders, modulesFolders, reinstallStale, unlinkCheckoutLinks, unlinkInstallLinks } from "./install-cache.js"
import type { Reinstalled } from "./install-cache.js"
import { openLedger, projectDir } from "./ledger.js"
import { inOrder } from "./sequential.js"
import { thisVerifier, withSettleLock } from "./settle.js"
import { settleTask } from "./prior.js"
import { getTask, isTerminal, lastEvent, listTasks, recordEvent, recordTaskWorktree } from "./tasks.js"
import type { TaskRow } from "./tasks.js"
import { orcaBinarySync, worktreeRemove, worktreeState } from "./orca/client.js"
import type { OrcaBinary } from "./orca/client.js"
import { describeProcesses, forgetProcesses, harnessFolder, heldBy, reapWorktree } from "./reap.js"
import type { Reap } from "./reap.js"
import { busyDue, busyRecordOf, busySubject, clearBusy, HELD_EVENT, isBusyFailure, REAPED_EVENT, recordBusy } from "./worktree-busy.js"
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
export const linkInstall = (target: string, worktree: string): string[] => {
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

/**
 * Gives an Op worktree the install of its own lockfile once its task changed it (harness/install-cache.ts reinstallStale over the
 * folders linkInstall gave it): a node_modules that no longer satisfies the worktree's lockfile, such as the target's install a
 * task's new dependency is absent from, is replaced by the install of the worktree's own inputs, from the cache or by `npm ci`
 * under the heavy governor; copied, not linked, in local package mode, whose copies the caller then reapplies (`reapplyLocal`).
 * Run before the Op's work is checked (seat start after its prior work is applied, the worker's dry replay); records
 * `op-install-refreshed` for each folder it installed. Returns what it installed, none when every install still holds.
 */
export const refreshOpInstall = async (root: string, taskId: string, made: OpWorktree): Promise<Reinstalled[]> => {
    const local = (readRecord(made.target)?.packages.length ?? 0) > 0
    const reinstalled = await reinstallStale(made.path, made.links, {}, local)
    if (reinstalled.length > 0) {
        withLedger(root, (db) => {
            for (const one of reinstalled) recordEvent(db, "op-install-refreshed", taskId, { worktree: made.path, folder: one.folder, key: one.key, reused: one.reused, exitCode: one.run?.exitCode ?? 0, note: one.note })
        })
    }
    return reinstalled
}

/** How one worktree folder's removal ended: removed (or gone already), or left with what refused it and whether that reads as busy. */
export interface FolderRemoval {
    readonly removed: boolean
    readonly busy: boolean
    readonly detail: string
    /** What the reap before the removal did (harness/reap.ts): the Orca terminals it closed, the processes it ended and those still alive. */
    readonly reap: Reap
    /** A folder left held: who still holds it, or what was tried to name its holder; null once removed. */
    readonly holders: string | null
    /** What became of Orca's record of a removed worktree: dropped, not listed, or why it stays; null when no Orca answers. */
    readonly orca: string | null
}

const NO_REAP: Reap = { terminals: [], workspace: null, killed: [], survivors: [], unreadable: null }

/** How long a removal waits for Orca to finish an `orca worktree rm`, which answers `removing` and completes after it returns. */
const ORCA_REMOVAL_MS = 30_000

const pause = async (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * Sends `orca worktree rm` and waits for Orca to finish it (it answers `removing` and completes later): until Orca no longer lists
 * the worktree, records the removal failed (its removalError), or ORCA_REMOVAL_MS passes. Undefined once Orca dropped it, else why not.
 */
const orcaRemove = async (binary: OrcaBinary, path: string, repo: string): Promise<string | undefined> => {
    await worktreeRemove(binary, path, repo)
    const deadline = Date.now() + ORCA_REMOVAL_MS
    for (;;) {
        const state = await worktreeState(binary, path, repo)
        if (!state.listed) return undefined
        if (state.removalError !== null) return `Orca's removal failed: ${state.removalError}`
        if (Date.now() >= deadline) return `still removing after ${String(ORCA_REMOVAL_MS / 1000)}s`
        await pause(500)
    }
}

/** Drops Orca's record of a removed worktree that Orca still lists (a removal it began and could not finish stays listed as failed). */
const deregisterOrca = async (repo: string, path: string): Promise<string | null> => {
    const binary = orcaBinarySync()
    if (binary === undefined) return null
    try {
        if (!(await worktreeState(binary, path, repo)).listed) return "not listed"
        const left = await orcaRemove(binary, path, repo)
        return left === undefined ? "dropped" : `still listed: ${left}`
    } catch (error: unknown) {
        return `not checked: ${reason(error)}`
    }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""

/** True when git still lists `path` as a worktree of `repo`. */
const gitLists = async (repo: string, path: string): Promise<boolean> => {
    const listed = await captureGit(["worktree", "list", "--porcelain"], repo)
    return [...listed.stdout.matchAll(/^worktree (.+)$/gm)].some((match) => samePath((match[1] ?? "").trim(), path))
}

/**
 * Removes one harness worktree, in the order a held folder needs (harness/reap.ts reapWorktree): the Orca terminals working in
 * it are closed (any terminal, not only a seat's: a process working in the folder keeps Windows from removing it, and a removed
 * worktree's terminals mean nothing); its install links are unlinked (link only, before anything deletes through them); Orca
 * forgets the worktree when its run is an orca one or Orca lists it (`orca worktree rm`, waited for until Orca no longer lists
 * it, records the removal failed, or a bound passes), since Orca's own watcher and terminal host hold a workspace it lists; then,
 * for a folder under the harness's state, the processes the harness started there, those working inside it and every process
 * under them are ended and seen gone. Git removes what is left. A folder git emptied and no longer lists (its rmdir was refused)
 * is removed as the one empty folder it is. A folder git no longer lists that holds no `.git` but still holds files (one
 * Windows would not let git delete, such as a file named `nul`) is deleted with every link in it unlinked first, never entered,
 * when this call deregistered it or `remnant` says it is a harness folder left half removed. A removed worktree Orca still lists
 * (its earlier removal failed) is dropped from Orca's list; a folder still held names its holder (reap.ts heldBy), Orca when
 * Orca still lists it.
 */
export const removeWorktreeFolder = async (repo: string, path: string, viaOrca: boolean, links: readonly string[] = [], remnant = false): Promise<FolderRemoval> => {
    if (!existsSync(path)) return { removed: true, busy: false, detail: "gone already", reap: NO_REAP, holders: null, orca: await deregisterOrca(repo, path) }
    const binary = orcaBinarySync()
    const refusals: string[] = []
    const listedAtStart = await gitLists(repo, path)
    // What Orca made of its removal; set by `forget`, which reapWorktree runs between its terminals and its kill.
    const orca: { note: string | null } = { note: null }
    const forget = async (): Promise<void> => {
        unlinkInstallLinks(path, links)
        if (binary === undefined) return
        // An Orca that cannot be reached is no reason to keep the folder: git removes it below.
        const listed = await worktreeState(binary, path, repo).then((state) => state.listed, () => viaOrca)
        if (!viaOrca && !listed) return
        orca.note = await orcaRemove(binary, path, repo).then(
            (left) => left ?? "dropped",
            (error: unknown) => `orca worktree rm: ${reason(error)}`,
        )
    }
    const reap = await reapWorktree(path, repo, harnessFolder(path), forget)
    // A removal Orca could not finish while the processes still held the folder is asked again once they are gone.
    if (binary !== undefined && orca.note !== null && orca.note !== "dropped" && reap.killed.length > 0 && existsSync(path)) {
        orca.note = await orcaRemove(binary, path, repo).then(
            (left) => left ?? "dropped",
            (error: unknown) => `orca worktree rm: ${reason(error)}`,
        )
    }
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
    if (!existsSync(path)) {
        forgetProcesses(path)
        const ended = reap.killed.length === 0 ? "" : ` after ending ${describeProcesses(reap.killed)}`
        const after = await deregisterOrca(repo, path)
        return { removed: true, busy: false, detail: `removed${ended}`, reap, holders: null, orca: after === "not listed" && orca.note === "dropped" ? "dropped" : after }
    }
    if (orca.note !== null && orca.note !== "dropped") refusals.push(`orca: ${orca.note}`)
    const detail = refusals.join("; ") || "the folder stayed"
    const busy = isBusyFailure(detail)
    const watching = binary === undefined ? undefined : await worktreeState(binary, path, repo).catch(() => undefined)
    const orcaHolds = watching?.listed === true ? `Orca still watching: it lists the worktree${watching.removalError === null ? "" : ` (${watching.removalError})`}; ` : ""
    return { removed: false, busy, detail, reap, holders: busy ? `${orcaHolds}${await heldBy(path, reap)}` : null, orca: orca.note }
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
    /** True to try a folder left busy at once, whatever its backoff says (`worktree gc --now`). */
    readonly now?: boolean
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
 * folder whose earlier removal was refused as busy is not tried again before its backoff runs out, unless `now` asks for it;
 * a tried folder is reaped and removed whatever its earlier attempts said; a busy refusal now, or any refusal of a folder
 * already busy, records the next attempt; a removal that succeeds ends the record. Never throws for a refused removal, so no
 * settle waits on or fails over a held folder.
 */
export const removeTracked = async (root: string, worktree: TrackedWorktree): Promise<TrackedRemoval> => {
    const pending = withLedger(root, (db) => busyRecordOf(db, worktree.path))
    if (pending !== undefined && worktree.now !== true && !busyDue(pending) && existsSync(worktree.path)) {
        return { removed: false, busy: true, detail: `left busy (attempt ${String(pending.attempt)}: ${pending.detail}); worktree gc retries it from ${pending.nextAt}`, retryAt: pending.nextAt }
    }
    const removal = await removeWorktreeFolder(worktree.repo, worktree.path, worktree.viaOrca, worktree.links ?? [], worktree.remnant === true || pending !== undefined)
    const { reap } = removal
    if (reap.killed.length > 0 || reap.survivors.length > 0 || reap.unreadable !== null) {
        withLedger(root, (db) => { recordEvent(db, REAPED_EVENT, busySubject(worktree.path), { path: worktree.path, owner: worktree.owner, kind: worktree.kind, killed: reap.killed, survivors: reap.survivors, terminals: reap.terminals, workspace: reap.workspace, unreadable: reap.unreadable }) })
    }
    if (removal.removed) {
        if (pending !== undefined) withLedger(root, (db) => { clearBusy(db, worktree.path, removal.detail) })
        const closed = reap.terminals.length === 0 ? "" : ` after closing its terminals ${reap.terminals.join(", ")}`
        const orca = removal.orca === null || removal.orca === "not listed" ? "" : `; Orca's record ${removal.orca}`
        return { removed: true, busy: false, detail: `${removal.detail}${closed}${orca}`, retryAt: null }
    }
    if (!removal.busy && pending === undefined) return { removed: false, busy: false, detail: removal.detail, retryAt: null }
    const holders = removal.holders ?? "not looked up: the refusal did not read as busy"
    withLedger(root, (db) => { recordEvent(db, HELD_EVENT, busySubject(worktree.path), { path: worktree.path, owner: worktree.owner, kind: worktree.kind, holders, detail: removal.detail, terminals: reap.terminals, workspace: reap.workspace }) })
    const record = await recordBusy(root, { path: worktree.path, repo: worktree.repo, owner: worktree.owner, kind: worktree.kind, detail: removal.detail, terminals: reap.terminals, holders })
    return { removed: false, busy: true, detail: `left busy (attempt ${String(record.attempt)}: ${removal.detail}; ${holders}); worktree gc retries it from ${record.nextAt}`, retryAt: record.nextAt }
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
    // The opt-in patterns the task's allowPaths need are declared on the branch first, so the Op is cut from a head that holds them.
    const workflowId = task.workflowId
    const needs = await patternsOfPaths(target, task.contract.context.allowPaths)
    if (needs.length > 0) {
        const db = openLedger(root)
        try {
            await enablePatterns({ db, checkout: target, branch: targetBranch, workflow: workflowId, task: taskId, why: "op-start" }, needs)
        } finally {
            db.close()
        }
    }
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
 * Removes an ended task's Op worktree and its branch, only after its attempt is settled (harness/prior.ts `settleTask`: MERGE,
 * DISCARD, or a KEEP or REPAIR whose one patch is saved first); while its Kernel has not decided, nothing is removed. The folder
 * goes by code (removeTracked: reaped, its install links unlinked as links, then Orca and git; `now` tries a folder left busy
 * whatever its backoff), then its branch is deleted whatever it carries, since what it held landed, was kept or was discarded.
 * A folder the host holds is left busy for `worktree gc` to retry and never fails the caller. Undefined when the task has no Op
 * worktree, it was removed already, or its settle awaits its Kernel.
 */
export const removeOpWorktree = async (root: string, taskId: string, now = false): Promise<WorktreeRemoval | undefined> => {
    if ((await settleTask(root, taskId)) === null) return undefined
    const { made, gone, orca } = withLedger(root, (db) => {
        const task = getTask(db, taskId)
        const runner = task.workflowId === null ? undefined : getWorkflow(db, task.workflowId).header.runner
        return { made: opWorktreeOf(db, taskId), gone: lastEvent(db, REMOVED_EVENT, taskId) !== undefined, orca: runner === "orca" }
    })
    if (made === undefined || gone) return undefined
    const removal = await removeTracked(root, { path: made.path, repo: made.target, owner: taskId, kind: "op", viaOrca: orca, links: made.links, remnant: true, now })
    if (!removal.removed) {
        if (removal.busy) return { task: taskId, path: made.path, removed: false, branch: "kept", detail: removal.detail, busy: true }
        const detail = `worktree remove failed (${removal.detail}); the next workflow step tries again`
        withLedger(root, (db) => { recordEvent(db, "op-worktree-left", taskId, { path: made.path, detail }) })
        return { task: taskId, path: made.path, removed: false, branch: "kept", detail }
    }
    await captureGit(["worktree", "prune"], made.target)
    const branch = await settleBranch(made)
    const detail = `branch ${made.branch} ${branch}`
    withLedger(root, (db) => { recordEvent(db, REMOVED_EVENT, taskId, { path: made.path, branch, detail, removal: removal.detail }) })
    return { task: taskId, path: made.path, removed: true, branch, detail }
}

/**
 * Deletes a removed Op worktree's branch: its attempt is settled, so what it carried landed (MERGE), was saved as the key's one
 * patch (KEEP, REPAIR) or was discarded (DISCARD), and no branch that never landed outlives its decision. Another settler (a
 * detached verify job, a step's sweep) may delete it at any point between the look and the delete: a git failure while the
 * branch is gone means it is gone.
 */
const settleBranch = async (made: OpWorktree): Promise<"deleted" | "gone"> => {
    const ref = `refs/heads/${made.branch}`
    try {
        if (!(await refExists(made.target, ref))) return "gone"
        await git(made.target, ["branch", "-D", made.branch])
        return "deleted"
    } catch (error: unknown) {
        if (!(await refExists(made.target, ref))) return "gone"
        throw error
    }
}

/**
 * Removes the Op worktree of every task of the repository's ledger that ended (done, failed or cancelled, holding no intent)
 * and still has one, once its attempt is settled (`removeOpWorktree`): the safety net behind the removal each verify and cancel
 * does, for a task a fence, a stall, a crash or its Kernel's later decision ended. A task awaiting the owner keeps its
 * worktree, where its work was left for the owner.
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
