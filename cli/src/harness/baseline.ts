import { randomBytes } from "node:crypto"
import { copyFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { captureGit, changedFiles, git, nulPaths } from "../shared/git.js"
import { underPaths } from "./contract.js"
import { openExistingLedger, openLedger } from "./ledger.js"
import { applyPriorWork } from "./prior.js"
import type { PriorApplied } from "./prior.js"
import { lastEvent, recordEvent } from "./tasks.js"
import type { TaskRow } from "./tasks.js"

/** The ledger event that holds the tree a task's checkout had when its work began. */
const BASELINE_EVENT = "task-baseline"

/**
 * The work tree of a checkout as a git tree, tracked and untracked files alike (ignored ones aside), written through a
 * temporary copy of its index so its own index and files stay as they are; the copy keeps the index's file stamps, so
 * only the files that changed are hashed.
 */
export const worktreeTree = async (root: string): Promise<string> => {
    const index = join(tmpdir(), `starci-baseline-${randomBytes(6).toString("hex")}`)
    const own = await git(root, ["rev-parse", "--git-path", "index"])
    const ownPath = isAbsolute(own) ? own : join(root, own)
    try {
        const env = { GIT_INDEX_FILE: index }
        if (existsSync(ownPath)) copyFileSync(ownPath, index)
        else await captureGit(["read-tree", "HEAD"], root, { env })
        const added = await captureGit(["add", "-A", "--", ":/"], root, { env })
        if (added.exitCode !== 0) throw new Refusal("CLI_TOOL_FAILED", `git add -A failed in ${root}: ${added.stderr.trim()}`)
        const written = await captureGit(["write-tree"], root, { env })
        if (written.exitCode !== 0) throw new Refusal("CLI_TOOL_FAILED", `git write-tree failed in ${root}: ${written.stderr.trim()}`)
        return written.stdout.trim()
    } finally {
        rmSync(index, { force: true })
    }
}

/** Records the tree of a task's checkout the first time its work begins; a later begin (a resumed launch, an inline step) keeps it. */
const recordBaseline = async (db: DatabaseSync, worktree: string, task: TaskRow): Promise<void> => {
    if (lastEvent(db, BASELINE_EVENT, task.id) !== undefined) return
    recordEvent(db, BASELINE_EVENT, task.id, { tree: await worktreeTree(worktree), worktree })
}

/**
 * The moment a task's work begins in its checkout: the checkout's tree is recorded as the task's baseline, so what was dirty
 * or untracked before (another task's leftovers, the owner's edits) is never judged as this task's, and then the work an
 * earlier attempt of its key left is brought back, which is the task's own.
 */
export const beginWork = async (root: string, worktree: string, task: TaskRow): Promise<PriorApplied> => {
    const db = openLedger(root)
    try {
        await recordBaseline(db, worktree, task)
    } finally {
        db.close()
    }
    return applyPriorWork(root, worktree, task)
}

/**
 * What of a checkout's dirty files is a task's own: a file whose content differs from the task's baseline (written, changed or
 * deleted since its work began). Undefined when the task has no baseline (it began before baselines were recorded, or the
 * ledger lacks it) or the baseline tree is gone, so the caller judges as it did without one.
 */
export const ownChanges = async (root: string, taskId: string): Promise<ReadonlySet<string> | undefined> => {
    const db = openExistingLedger(root)
    if (db === undefined) return undefined
    let baseline: unknown
    try {
        baseline = lastEvent(db, BASELINE_EVENT, taskId)
    } finally {
        db.close()
    }
    const tree = typeof baseline === "object" && baseline !== null && "tree" in baseline && typeof baseline.tree === "string" ? baseline.tree : undefined
    if (tree === undefined || (await captureGit(["cat-file", "-e", `${tree}^{tree}`], root)).exitCode !== 0) return undefined
    const now = await worktreeTree(root)
    return new Set(nulPaths(await git(root, ["diff-tree", "-r", "--name-only", "-z", "--no-renames", tree, now])))
}

/**
 * The dirty files under a task's allowPaths that are not its own: there, unchanged, since its work began, such as another
 * task's leftovers in a shared worktree. None for a task without a baseline. A candidate, a preserve and a reset leave them be.
 */
export const notOwn = async (root: string, taskId: string, allowPaths: readonly string[]): Promise<string[]> => {
    const own = await ownChanges(root, taskId)
    if (own === undefined) return []
    return (await changedFiles(root, "HEAD")).filter((file) => underPaths(file, allowPaths) && !own.has(file))
}

/** The pathspec that leaves one repository path out of a git command. */
export const excludedSpec = (path: string): string => `:(exclude,top,literal)${path}`
