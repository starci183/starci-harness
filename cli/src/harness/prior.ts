import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { asRefusal, Refusal } from "../shared/errors.js"
import { headline } from "../shared/exec.js"
import { captureGit, git, gitSucceeds, refExists, resolveSha } from "../shared/git.js"
import type { Contract } from "./contract.js"
import { taskPaths } from "./contract.js"
import { KERNEL_SETTLES } from "./coordinator-commands.js"
import type { KernelSettle } from "./coordinator-commands.js"
import { inTransaction, now, openExistingLedger, openLedger, priorDir, projectDir } from "./ledger.js"
import { opWorktreeOf } from "./land.js"
import { readMachine } from "./machine.js"
import { harnessCause } from "./revive.js"
import { inOrder } from "./sequential.js"
import type { TaskRow } from "./tasks.js"
import { getTask, hostHeldAttempt, isTerminal, lastEvent, latestAttempt, recordEvent, resultOf } from "./tasks.js"

/**
 * How an ended attempt of a task is settled (owner decision `op-settle-merge-or-discard`): `merge`, its green verify landed it;
 * `discard`, nothing of it is kept; `repair`, its Kernel's decision that the next attempt repairs this work, which keeps one
 * patch for that one attempt; `keep`, a stop the harness caused or a waiter parked on a shared need, which keeps one patch for
 * the attempt that continues it.
 */
export type SettleDecision = "merge" | "discard" | "repair" | "keep"

/** Why a task's attempt is settled the way it is, and who decided it. */
export interface SettleDue {
    readonly decision: SettleDecision
    readonly by: "harness" | "kernel"
    readonly cause: string
}

/** The event that records how a task's ended attempt was settled; the task's status at that moment is in it. */
export const OP_SETTLED = "op-settled"

/** The event a Kernel command records on each task whose decision it answers: the settle the Kernel named (discard by default). */
export const SETTLE_RULED = "op-settle-ruled"

/** The event recorded for each stored patch dropped from the prior-work store. */
export const PRIOR_DROPPED = "prior-dropped"

/** One stored patch of an earlier attempt, as the ledger's prior_work table indexes it; `file` is its place in the store. */
export interface PriorPatch {
    readonly workflowId: string
    readonly planKey: string
    readonly contractHash: string
    readonly attemptId: string
    readonly sha256: string
    readonly taskId: string
    readonly base: string
    readonly source: string
    readonly createdAt: string
    readonly file: string
}

/** What the launch-time apply did with the patch kept for a task's key. */
export interface PriorApplied {
    readonly outcome: "applied" | "conflicted" | "none"
    readonly patch: string | null
    readonly sha256: string | null
    readonly fromTask: string | null
    readonly detail: string
}

/** The key the store files a task's work under: its workflow ('' for none) and its plan key, or `task:<first try>` for a task outside a graph. */
export interface PriorKey {
    readonly workflowId: string
    readonly planKey: string
}

const APPLIED_EVENT = "prior-applied"

// Every stored patch is the work an attempt preserved (with the commits its Op branch carried); the table's kind says so.
const STORED_KIND = "preserved"

const literal = (path: string): string => `:(top,literal)${path}`

const specsOf = (task: TaskRow): string[] => taskPaths(task).map(literal)

const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

const scratchFile = (suffix: string): string => join(tmpdir(), `starci-prior-${randomBytes(6).toString("hex")}${suffix}`)

/** A patch file being written for the store, inside the store's folder, so filing it is a rename on one device (never EXDEV). */
const storeScratch = (root: string): string => {
    const dir = priorDir(root)
    mkdirSync(dir, { recursive: true })
    return join(dir, `.writing-${randomBytes(6).toString("hex")}.patch`)
}

/** The key of a task's work: the plan key it was dispatched for, else the first task of its retry chain. */
export const priorKey = (db: DatabaseSync, task: TaskRow): PriorKey => {
    const plan = db.prepare("SELECT plan_key FROM tasks WHERE id = ?").get(task.id)?.plan_key
    if (typeof plan === "string" && plan !== "") return { workflowId: task.workflowId ?? "", planKey: plan }
    let first = task
    while (first.retryOf !== null) first = getTask(db, first.retryOf)
    return { workflowId: task.workflowId ?? "", planKey: `task:${first.id}` }
}

/** The ids of every task of the key other than `task`, oldest first. */
const priorTaskIds = (db: DatabaseSync, task: TaskRow, key: PriorKey): string[] => {
    const rows = key.planKey.startsWith("task:")
        ? db
              .prepare("WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT tasks.id FROM tasks JOIN chain ON tasks.retry_of = chain.id) SELECT tasks.id FROM tasks JOIN chain ON chain.id = tasks.id ORDER BY tasks.created_at, tasks.rowid")
              .all(key.planKey.slice("task:".length))
        : db.prepare("SELECT id FROM tasks WHERE COALESCE(workflow_id, '') = ? AND plan_key = ? ORDER BY created_at, rowid").all(key.workflowId, key.planKey)
    return rows.map((row) => text(row.id)).filter((id) => id !== task.id)
}

const toPatch = (root: string, row: Record<string, unknown>): PriorPatch => {
    const sha256 = text(row.sha256)
    return {
        workflowId: text(row.workflow_id),
        planKey: text(row.plan_key),
        contractHash: text(row.contract_hash),
        attemptId: text(row.attempt_id),
        sha256,
        taskId: text(row.task_id),
        base: text(row.base),
        source: text(row.source),
        createdAt: text(row.created_at),
        file: join(priorDir(root), `${sha256}.patch`),
    }
}

/** Every stored patch of a key, newest attempt first. */
const keyRows = (root: string, db: DatabaseSync, key: PriorKey): PriorPatch[] =>
    db
        .prepare(
            "SELECT prior_work.* FROM prior_work JOIN tasks ON tasks.id = prior_work.task_id WHERE prior_work.workflow_id = ? AND prior_work.plan_key = ? ORDER BY tasks.created_at DESC, tasks.rowid DESC, prior_work.attempt_id DESC, prior_work.created_at DESC",
        )
        .all(key.workflowId, key.planKey)
        .map((row) => toPatch(root, row))

/** The patch kept for a task's key by another task of it (at most one: settleWork keeps one per key). */
export const priorPatches = (root: string, db: DatabaseSync, task: TaskRow): PriorPatch[] => keyRows(root, db, priorKey(db, task)).filter((row) => row.taskId !== task.id)

/** Runs git with a temporary index, refusing on a non-zero exit. */
const indexed = async (cwd: string, index: string, args: readonly string[]): Promise<string> => {
    const run = await captureGit(args, cwd, { env: { GIT_INDEX_FILE: index } })
    if (run.exitCode !== 0) throw new Refusal("CLI_TOOL_FAILED", `git ${args.join(" ")} failed: ${headline(run.stderr) || "exit " + String(run.exitCode)}`)
    return run.stdout.trim()
}

/**
 * The tree of `base` with `patch` applied and `files` added, built in a temporary index, so neither the user's index nor any
 * work tree is touched; the blobs land in the repository's object store, which a later `git apply --3way` merges from.
 */
const treeOf = async (cwd: string, base: string, patch: string | null, files: readonly { readonly path: string; readonly file: string }[]): Promise<string> => {
    const index = scratchFile(".index")
    try {
        await indexed(cwd, index, ["read-tree", base])
        if (patch !== null) await indexed(cwd, index, ["apply", "--cached", "--binary", patch])
        await inOrder(files, async (item) => {
            const blob = (await git(cwd, ["hash-object", "-w", `--path=${item.path}`, item.file])).trim()
            await indexed(cwd, index, ["update-index", "--add", "--cacheinfo", `100644,${blob},${item.path}`])
        })
        return await indexed(cwd, index, ["write-tree"])
    } finally {
        rmSync(index, { force: true })
    }
}

/** Writes the binary diff `from` -> `to` limited to `specs` (literal pathspecs) into `out`. */
const diffInto = async (cwd: string, from: string, to: string, specs: readonly string[], out: string): Promise<void> => {
    await git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--binary", "--full-index", "--src-prefix=a/", "--dst-prefix=b/", `--output=${out}`, from, to, "--", ...specs])
}

/** The row already stored for a source of a task, if any: a source is stored once however often it is kept. */
const storedFrom = (root: string, db: DatabaseSync, taskId: string, source: string): PriorPatch | undefined => {
    const row = db.prepare("SELECT * FROM prior_work WHERE task_id = ? AND source = ?").get(taskId, source)
    return row === undefined ? undefined : toPatch(root, row)
}

/**
 * Files the patch in `out` under its sha256 (written once, by rename, so a reader never sees half a file) and indexes it by
 * (workflow, plan key, contract hash, attempt, sha256). Idempotent; an empty patch stores nothing.
 */
const fileStored = (root: string, db: DatabaseSync, task: TaskRow, out: string, entry: { readonly base: string; readonly source: string }): PriorPatch | undefined => {
    if (!existsSync(out) || statSync(out).size === 0) return undefined
    const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex")
    const dir = priorDir(root)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${sha256}.patch`)
    if (existsSync(file)) rmSync(out, { force: true })
    else renameSync(out, file)
    const key = priorKey(db, task)
    db.prepare(
        "INSERT INTO prior_work (workflow_id, plan_key, contract_hash, attempt_id, kind, sha256, task_id, base, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    ).run(key.workflowId, key.planKey, task.contractHash, latestAttempt(db, task.id)?.id ?? "", STORED_KIND, sha256, task.id, entry.base, entry.source, now())
    return storedFrom(root, db, task.id, entry.source)
}

/** A preserve's manifest.json, as preserve.ts writes it: the commit it was taken against and the untracked files it copied. */
const readManifest = (dir: string): { readonly head: string; readonly untracked: readonly string[] } => {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
    const { head, untracked } = record
    if (typeof head !== "string" || head === "") throw new Refusal("PRIOR_UNREADABLE", `${join(dir, "manifest.json")} names no head commit`)
    return { head, untracked: Array.isArray(untracked) ? untracked.filter((item): item is string => typeof item === "string") : [] }
}

/** True when `dir` lies inside the project's preserved/ folder, the only place a settle deletes a preserve from. */
const underPreserved = (root: string, dir: string): boolean => {
    const rel = relative(join(projectDir(root), "preserved"), dir)
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/** The preserve folders a task's ending wrote (its `task-preserved` events) that are still on disk, oldest first. */
const stagedOf = (root: string, db: DatabaseSync, taskId: string): string[] =>
    db
        .prepare("SELECT data_json FROM events WHERE kind = 'task-preserved' AND subject = ? ORDER BY id")
        .all(taskId)
        .map((row) => {
            const data: unknown = JSON.parse(text(row.data_json))
            return typeof data === "object" && data !== null && "dir" in data && typeof data.dir === "string" ? data.dir : ""
        })
        .filter((dir) => dir !== "" && existsSync(join(dir, "manifest.json")) && underPreserved(root, dir))

/**
 * The one patch a keep or a repair stores for the next attempt of a task's key: the newest work its ending preserved, diffed from
 * the fork of its Op worktree when it was preserved there (so commits its Op branch carried come too), else from the preserve's
 * own head; with no preserve, the commits its Op branch carries past its fork. Limited to the task's allowPaths. Undefined when
 * the attempt left nothing.
 */
const keepPatch = async (root: string, db: DatabaseSync, task: TaskRow): Promise<PriorPatch | undefined> => {
    const made = opWorktreeOf(db, task.id)
    const ref = made === undefined ? undefined : `refs/heads/${made.branch}`
    const tip = made === undefined || ref === undefined || !(await refExists(made.target, ref)) ? undefined : await resolveSha(made.target, ref)
    const dir = stagedOf(root, db, task.id).at(-1)
    const out = storeScratch(root)
    try {
        if (dir !== undefined) {
            const manifest = readManifest(dir)
            const changes = join(dir, "changes.patch")
            const files = manifest.untracked.map((path) => ({ path, file: join(dir, "untracked", path) })).filter((item) => existsSync(item.file))
            const tree = await treeOf(root, manifest.head, existsSync(changes) ? changes : null, files)
            const base = made !== undefined && tip === manifest.head ? made.fork : manifest.head
            await diffInto(root, base, tree, specsOf(task), out)
            return fileStored(root, db, task, out, { base, source: dir })
        }
        if (made === undefined || tip === undefined || tip === made.fork) return undefined
        await diffInto(root, made.fork, tip, specsOf(task), out)
        return fileStored(root, db, task, out, { base: made.fork, source: tip })
    } finally {
        rmSync(out, { force: true })
    }
}

/** Drops stored patches from the store: each row goes with a `prior-dropped` event, and its file once no row names it. */
const dropRows = (db: DatabaseSync, rows: readonly PriorPatch[], reason: string): string[] => {
    for (const row of rows) {
        db.prepare("DELETE FROM prior_work WHERE workflow_id = ? AND plan_key = ? AND attempt_id = ? AND sha256 = ? AND task_id = ?").run(row.workflowId, row.planKey, row.attemptId, row.sha256, row.taskId)
        recordEvent(db, PRIOR_DROPPED, row.taskId, { workflowId: row.workflowId, planKey: row.planKey, sha256: row.sha256, reason })
        if (db.prepare("SELECT 1 FROM prior_work WHERE sha256 = ?").get(row.sha256) === undefined) rmSync(row.file, { force: true })
    }
    return rows.map((row) => row.sha256)
}

/** The parked waiters of shared needs: a task with a waiter row in the host store (harness/needs.ts). */
const parkedOnNeed = (taskId: string): boolean => readMachine((machine) => machine.prepare("SELECT 1 FROM shared_need_waiters WHERE task_id = ? LIMIT 1").get(taskId) !== undefined, false)

/**
 * The harness cause that owes an ended task's work a continuation, or null: the owner's custody hold (awaiting_owner), a cause
 * revive.ts `harnessCause` names (a fenced or lost launch, a verify stopped by infrastructure or its deadline, a wave red not its
 * own, a done task whose work never landed), a verify the host held, or a waiter parked on a shared need.
 */
const harnessKept = (db: DatabaseSync, task: TaskRow): string | null => {
    if (task.status === "awaiting_owner") return "custody"
    const cause = harnessCause(db, task.id)
    if (cause !== null) return cause
    if (hostHeldAttempt(db, task.id)) return "host-held"
    return parkedOnNeed(task.id) ? "waiter" : null
}

/** The settle a Kernel command named on the task (`SETTLE_RULED`), if one did. */
const ruledOf = (db: DatabaseSync, taskId: string): KernelSettle | undefined => {
    const data = lastEvent(db, SETTLE_RULED, taskId)
    const decision = typeof data === "object" && data !== null && "decision" in data ? data.decision : undefined
    return KERNEL_SETTLES.find((one) => one === decision)
}

/** Records the settle a Kernel command names on a task whose decision it answers (discard unless it names repair). */
export const recordRuledSettle = (db: DatabaseSync, taskId: string, decision: KernelSettle, cmdId: string): void => {
    recordEvent(db, SETTLE_RULED, taskId, { decision, cmdId })
}

/** True when a task of the key was created after `task`: the key went on without a settle named for it. */
const laterOfKey = (db: DatabaseSync, task: TaskRow): boolean => {
    const key = priorKey(db, task)
    if (key.planKey.startsWith("task:")) return db.prepare("SELECT 1 FROM tasks WHERE retry_of = ?").get(task.id) !== undefined
    return (
        db
            .prepare("SELECT 1 FROM tasks WHERE COALESCE(workflow_id, '') = ? AND plan_key = ? AND id <> ? AND (created_at > ? OR (created_at = ? AND rowid > (SELECT rowid FROM tasks WHERE id = ?)))")
            .get(key.workflowId, key.planKey, task.id, task.createdAt, task.createdAt, task.id) !== undefined
    )
}

/** True when a workflow ended or is ending, so no Kernel decision on its tasks is still to come. */
const workflowEnded = (db: DatabaseSync, workflowId: string): boolean => ["done", "stopped", "stopping"].includes(text(db.prepare("SELECT status FROM workflows WHERE id = ?").get(workflowId)?.status))

/** The settle already recorded for the task in its current status, if any (a done task a wave or a recover failed settles again). */
const settledOf = (db: DatabaseSync, task: TaskRow): SettleDecision | undefined => {
    const data = lastEvent(db, OP_SETTLED, task.id)
    if (typeof data !== "object" || data === null || !("decision" in data) || !("status" in data) || data.status !== task.status) return undefined
    const decision = data.decision
    return (["merge", "discard", "repair", "keep"] as const).find((one) => one === decision)
}

/**
 * How a task's ended attempt settles now, or null while it waits for its Kernel's decision (or has not ended, or holds an
 * intent): done is MERGE (its green verify landed it); a harness cause that owes it a continuation (`harnessKept`) is KEEP; else
 * the settle its Kernel named answering its decision (`SETTLE_RULED`: DISCARD or REPAIR); a task with no Kernel (outside a
 * workflow) or cancelled is DISCARD; a failed one whose Kernel answered nothing is DISCARD once its workflow ended or its key
 * went on to a later task.
 */
export const settleDue = (db: DatabaseSync, task: TaskRow): SettleDue | null => {
    if (task.intent !== null) return null
    if (task.status === "done") return { decision: "merge", by: "harness", cause: "verify-green" }
    if (!isTerminal(task.status)) return null
    const kept = harnessKept(db, task)
    if (kept !== null) return { decision: "keep", by: "harness", cause: kept }
    const ruled = ruledOf(db, task.id)
    if (ruled !== undefined) return { decision: ruled, by: "kernel", cause: "ruled" }
    if (task.workflowId === null) return { decision: "discard", by: "harness", cause: "no-kernel" }
    if (task.status === "cancelled") return { decision: "discard", by: "harness", cause: "cancelled" }
    if (workflowEnded(db, task.workflowId) || laterOfKey(db, task)) return { decision: "discard", by: "harness", cause: "unanswered" }
    return null
}

/** True while a task's ended attempt waits for its Kernel's settle: nothing of it, its worktree and branch included, is removed yet. */
export const settlePending = (db: DatabaseSync, task: TaskRow): boolean => settledOf(db, task) === undefined && settleDue(db, task) === null

/**
 * Settles one ended attempt: a keep or a repair stores its one patch (`keepPatch`) and drops every other patch of its key; a merge
 * or a discard drops every patch of its key (the attempt that applied it settled); a keep or a repair that left nothing new keeps
 * what its key holds. Every preserve folder its ending wrote is deleted, so no partial work stays beside the store. Recorded
 * `op-settled` with the task's status.
 */
const settleWork = async (root: string, db: DatabaseSync, task: TaskRow, due: SettleDue): Promise<SettleDecision> => {
    const keeps = due.decision === "keep" || due.decision === "repair"
    const kept = keeps ? await keepPatch(root, db, task) : undefined
    const rows = keyRows(root, db, priorKey(db, task))
    const stale = kept === undefined ? (keeps ? [] : rows) : rows.filter((row) => row.sha256 !== kept.sha256 || row.taskId !== kept.taskId)
    inTransaction(db, () => {
        const dropped = dropRows(db, stale, `task ${task.id} settled ${due.decision}`)
        recordEvent(db, OP_SETTLED, task.id, { ...due, status: task.status, kept: kept?.sha256 ?? null, dropped })
    })
    for (const dir of stagedOf(root, db, task.id)) rmSync(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 })
    return due.decision
}

/**
 * Settles a task's ended attempt once its decision is due (`settleDue`) and returns it; its earlier settle when it has one in its
 * status; null while it waits for its Kernel. Its Op worktree and branch are removed only after this (harness/land.ts).
 */
export const settleTask = async (root: string, taskId: string): Promise<SettleDecision | null> => {
    const db = openLedger(root)
    try {
        const task = getTask(db, taskId)
        const known = settledOf(db, task)
        if (known !== undefined) return known
        const due = settleDue(db, task)
        return due === null ? null : await settleWork(root, db, task, due)
    } finally {
        db.close()
    }
}

/** Settles every earlier task of the key whose decision is due, oldest first, so the patch it keeps is in the store. */
const settleEarlier = async (root: string, db: DatabaseSync, task: TaskRow): Promise<void> => {
    await inOrder(priorTaskIds(db, task, priorKey(db, task)), async (id) => {
        const earlier = getTask(db, id)
        if (settledOf(db, earlier) !== undefined) return
        const due = settleDue(db, earlier)
        if (due === null) return
        try {
            await settleWork(root, db, earlier, due)
        } catch (error: unknown) {
            recordEvent(db, "prior-store-failed", id, { decision: due.decision, error: asRefusal(error).message })
        }
    })
}

/**
 * Drops from the store every patch that is not one kept patch per key (gc's migration of a store written before settles): a row
 * whose task's settle did not keep it, or, unsettled, whose task no harness cause owes a continuation, and every row but the
 * newest of its key. Each dropped row is a `prior-dropped` event. Returns how many went.
 */
export const pruneUnkeptPrior = (root: string): number => {
    const db = openExistingLedger(root)
    if (db === undefined) return 0
    try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prior_work'").get() === undefined) return 0
        const rows = db
            .prepare("SELECT prior_work.* FROM prior_work JOIN tasks ON tasks.id = prior_work.task_id ORDER BY tasks.created_at DESC, tasks.rowid DESC, prior_work.attempt_id DESC, prior_work.created_at DESC")
            .all()
            .map((row) => ({ row: toPatch(root, row), kind: text(row.kind) }))
        const seen = new Set<string>()
        const unkept: PriorPatch[] = []
        const older: PriorPatch[] = []
        for (const { row, kind } of rows) {
            const settled = lastEvent(db, OP_SETTLED, row.taskId)
            const keptBySettle = typeof settled === "object" && settled !== null && "kept" in settled && settled.kept === row.sha256
            const kept = settled === undefined ? kind === STORED_KIND && harnessKept(db, getTask(db, row.taskId)) !== null : keptBySettle
            const key = `${row.workflowId}\0${row.planKey}`
            if (!kept) unkept.push(row)
            else if (seen.has(key)) older.push(row)
            else seen.add(key)
        }
        inTransaction(db, () => {
            dropRows(db, unkept, "gc: not a kept kind (a harness-caused stop, a parked waiter or a repair)")
            dropRows(db, older, "gc: an older patch of a key that keeps its newest")
        })
        return unkept.length + older.length
    } finally {
        db.close()
    }
}

/** The repository paths a patch touches, from git's own parse of it. */
const patchPaths = async (cwd: string, patch: string): Promise<string[]> =>
    (await git(cwd, ["apply", "--numstat", "-z", patch]))
        .split("\0")
        .map((field) => field.split("\t").pop() ?? "")
        .filter((path) => path !== "")

/** Puts `paths` back to HEAD after a failed apply: a path HEAD has comes back from it, any other leaves index and work tree. */
const restorePaths = async (cwd: string, paths: readonly string[]): Promise<void> => {
    await inOrder(paths, async (path) => {
        if (await gitSucceeds(cwd, ["cat-file", "-e", `HEAD:${path}`])) {
            await git(cwd, ["checkout", "HEAD", "--", literal(path)])
            return
        }
        await git(cwd, ["rm", "-q", "-f", "--cached", "--ignore-unmatch", "--", literal(path)])
        rmSync(join(cwd, path), { force: true })
    })
}

/** Applies the kept patch to a clean checkout; the caller records the answer. */
const applyNewest = async (worktree: string, task: TaskRow, newest: PriorPatch): Promise<PriorApplied> => {
    const from = { patch: newest.file, sha256: newest.sha256, fromTask: newest.taskId }
    const specs = specsOf(task)
    const top = (await git(worktree, ["rev-parse", "--show-toplevel"])).trim()
    const filtered = scratchFile(".patch")
    try {
        // Only the part under this contract's allowPaths, cut with literal pathspecs from the tree the patch makes of its base.
        await diffInto(top, newest.base, await treeOf(top, newest.base, newest.file, []), specs, filtered)
        if (!existsSync(filtered) || statSync(filtered).size === 0) return { outcome: "none", ...from, detail: "the prior patch touches nothing under this task's allowPaths" }
        // A patch that landed in HEAD, or an apply run twice, finds its result already in the work tree.
        if (await gitSucceeds(top, ["apply", "--reverse", "--check", "--binary", filtered])) return { outcome: "applied", ...from, detail: "the checkout already holds it" }
        if ((await git(top, ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...specs])) !== "") {
            return { outcome: "conflicted", ...from, detail: "the checkout already has other changes under this task's allowPaths; nothing was applied" }
        }
        const paths = await patchPaths(top, filtered)
        const run = await captureGit(["apply", "--3way", "--binary", filtered], top)
        if (run.exitCode === 0) {
            // --3way stages what it applied; the worker starts from an unstaged work tree, as if it had made the edits itself.
            await git(top, ["reset", "-q", "--", ...paths.map(literal)])
            return { outcome: "applied", ...from, detail: `git apply --3way brought back ${String(paths.length)} file(s)` }
        }
        await restorePaths(top, paths)
        return { outcome: "conflicted", ...from, detail: `git apply --3way met conflicts (${headline(run.stderr) || "exit " + String(run.exitCode)}); the checkout was put back, no markers left` }
    } finally {
        rmSync(filtered, { force: true })
    }
}

/**
 * The launch-time apply: before a worker starts, settles every earlier task of its key whose decision is due (so a keep or a
 * repair has stored its patch), then brings the one patch kept for the key back onto the worker's checkout `worktree` with
 * `git apply --3way`, limited to the task's allowPaths. A patch that does not apply cleanly leaves no conflict markers: the
 * checkout is put back and the brief points at the patch instead. The patch stays in the store until this attempt settles
 * (`settleWork`). Records a `prior-applied` event the brief reads, so call it before the brief is written (or write it again after).
 */
export const applyPriorWork = async (root: string, worktree: string, task: TaskRow): Promise<PriorApplied> => {
    const db = openLedger(root)
    try {
        await settleEarlier(root, db, task)
        const newest = priorPatches(root, db, task)[0]
        let applied: PriorApplied
        if (newest === undefined) applied = { outcome: "none", patch: null, sha256: null, fromTask: null, detail: "no earlier attempt of this key kept work" }
        else {
            try {
                applied = await applyNewest(worktree, task, newest)
            } catch (error: unknown) {
                applied = { outcome: "conflicted", patch: newest.file, sha256: newest.sha256, fromTask: newest.taskId, detail: asRefusal(error).message }
            }
        }
        recordEvent(db, APPLIED_EVENT, task.id, applied)
        return applied
    } finally {
        db.close()
    }
}

// Paths go into the brief with forward slashes, so a command copied from it runs the same in every shell.
const slashed = (path: string): string => path.replaceAll("\\", "/")

const MAX_TEXT = 2000

const clip = (value: string): string => (value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT)} … (${String(value.length - MAX_TEXT)} more characters)`)

/** The parts of a contract a worker compares across attempts. */
const comparable = (contract: Contract): Readonly<Record<string, readonly string[]>> => ({
    summary: [contract.input.summary],
    details: contract.input.details === undefined ? [] : [contract.input.details],
    allowPaths: [...contract.context.allowPaths],
    inputs: Object.entries({ ...contract.input.base, ...contract.input.extend }).map(([name, value]) => `${name}=${value}`),
    checks: [...(contract.checks?.base ?? []), ...(contract.checks?.extend ?? [])].map((entry) => JSON.stringify(entry)),
})

/** The previous contract -> this contract, field by field, in words; empty when nothing a worker reads changed. */
export const contractChanges = (before: Contract, after: Contract): string[] => {
    const old = comparable(before)
    const next = comparable(after)
    return Object.keys(next).flatMap((field) => {
        const was = old[field] ?? []
        const is = next[field] ?? []
        if (JSON.stringify(was) === JSON.stringify(is)) return []
        if (field === "summary" || field === "details") return [`${field}: ${was.length === 0 ? "(none)" : JSON.stringify(clip(was[0] ?? ""))} -> ${is.length === 0 ? "(none)" : JSON.stringify(clip(is[0] ?? ""))}`]
        const added = is.filter((item) => !was.includes(item))
        const removed = was.filter((item) => !is.includes(item))
        const moves = [...added.map((item) => "+ " + item), ...removed.map((item) => "- " + item)]
        return [`${field}: ${moves.join("; ") || "reordered"}`]
    })
}

const asApplied = (value: unknown): PriorApplied | undefined => {
    if (typeof value !== "object" || value === null || !("outcome" in value)) return undefined
    return value as PriorApplied
}

/** One line on the prior patch: applied at launch, or where to read it when it did not apply. */
const patchLine = (task: TaskRow, newest: PriorPatch | undefined, applied: PriorApplied | undefined): string => {
    if (newest === undefined) return "Prior patch: none; no earlier attempt of this work was kept."
    const where = `${slashed(newest.file)} (kept by task ${newest.taskId}, against ${newest.base.slice(0, 12)})`
    if (applied?.sha256 === newest.sha256 && applied.outcome === "applied") return `Prior patch: applied to your checkout at launch: ${where}. ${applied.detail}. Start from it: review it against the contract above and keep what holds.`
    if (applied?.sha256 === newest.sha256 && applied.outcome === "none") return `Prior patch: ${where}; ${applied.detail}, so nothing was applied.`
    const why = applied?.sha256 === newest.sha256 ? ` (${applied.detail})` : ` (the launch of task ${task.id} did not apply it)`
    return `Prior patch: did not apply cleanly${why}: read ${where}, port what still holds.`
}

/** The previous attempt's result in words: its task status, verdict, red checks and filed output. */
const resultLines = (db: DatabaseSync, previous: TaskRow): string[] => {
    const attempt = latestAttempt(db, previous.id)
    if (attempt === undefined) return [`Previous result: task ${previous.id} (${previous.status}) never launched.`]
    const result = resultOf(db, attempt.id)
    const red = db
        .prepare("SELECT DISTINCT name FROM check_runs WHERE attempt_id = ? AND status = 'red' ORDER BY name")
        .all(attempt.id)
        .map((row) => text(row.name))
    const filed = result === undefined ? "filed no result" : "filed " + result.status
    const redChecks = red.length === 0 ? "" : ", red checks: " + red.join(", ")
    return [
        `Previous result: task ${previous.id} is ${previous.status}; attempt ${attempt.id} ${filed}, verdict ${attempt.verdict ?? "none"}${redChecks}.`,
        ...(result === undefined ? [] : ["```json", clip(JSON.stringify(result.output, null, 2)), "```"]),
    ]
}

/**
 * The brief's "Prior work" section of a task whose key had earlier tasks, read from the ledger without writing it; undefined
 * for a first attempt or a project with no ledger yet.
 */
export const priorWorkSection = (root: string, task: TaskRow): string | undefined => {
    const db = openExistingLedger(root)
    if (db === undefined) return undefined
    try {
        const ids = priorTaskIds(db, task, priorKey(db, task))
        const previousId = ids.at(-1)
        if (previousId === undefined) return undefined
        const previous = getTask(db, previousId)
        const stored = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prior_work'").get() === undefined ? [] : priorPatches(root, db, task)
        const changes = contractChanges(previous.contract, task.contract)
        const lines = [
            stored.length === 0
                ? `This task repeats ${String(ids.length)} earlier task(s) of the same work (${ids.join(", ")}), which kept no work: they were discarded, so start from the branch and learn from why the last one ended.`
                : `This task repeats ${String(ids.length)} earlier task(s) of the same work (${ids.join(", ")}), whose one kept patch is yours to continue. Start from it; never redo it blindly.`,
            changes.length === 0 ? "Contract, previous -> this: unchanged." : `Contract, previous (${previous.id}) -> this:\n\n${changes.map((change) => "- " + change).join("\n")}`,
            resultLines(db, previous).join("\n"),
            patchLine(task, stored[0], asApplied(lastEvent(db, APPLIED_EVENT, task.id))),
        ]
        return lines.join("\n\n")
    } finally {
        db.close()
    }
}
