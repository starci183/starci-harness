import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { asRefusal, Refusal } from "../shared/errors.js"
import { headline } from "../shared/exec.js"
import { captureGit, git, gitSucceeds } from "../shared/git.js"
import type { Contract } from "./contract.js"
import { now, openExistingLedger, openLedger, priorDir } from "./ledger.js"
import { inOrder } from "./sequential.js"
import type { TaskRow } from "./tasks.js"
import { getTask, lastEvent, latestAttempt, recordEvent, resultOf } from "./tasks.js"
import { taskPaths } from "./contract.js"

/** How an attempt's work was kept: the dirty work of a cancelled or red attempt (preserved), or the diff of a settled one (committed). */
export type PriorKind = "preserved" | "committed"

/** One stored patch of an earlier attempt, as the ledger's prior_work table indexes it; `file` is its place in the store. */
export interface PriorPatch {
    readonly workflowId: string
    readonly planKey: string
    readonly contractHash: string
    readonly attemptId: string
    readonly kind: PriorKind
    readonly sha256: string
    readonly taskId: string
    readonly base: string
    readonly source: string
    readonly createdAt: string
    readonly file: string
}

/** What the launch-time apply did with the newest prior patch of a task's key. */
export interface PriorApplied {
    readonly outcome: "applied" | "conflicted" | "none"
    readonly patch: string | null
    readonly sha256: string | null
    readonly kind: PriorKind | null
    readonly fromTask: string | null
    readonly detail: string
}

/** The key the store files a task's work under: its workflow ('' for none) and its plan key, or `task:<first try>` for a task outside a graph. */
export interface PriorKey {
    readonly workflowId: string
    readonly planKey: string
}

const APPLIED_EVENT = "prior-applied"

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
        kind: text(row.kind) as PriorKind,
        sha256,
        taskId: text(row.task_id),
        base: text(row.base),
        source: text(row.source),
        createdAt: text(row.created_at),
        file: join(priorDir(root), `${sha256}.patch`),
    }
}

/** The stored patches of a task's key, from every other task of it, newest attempt first. */
export const priorPatches = (root: string, db: DatabaseSync, task: TaskRow): PriorPatch[] => {
    const key = priorKey(db, task)
    return db
        .prepare(
            "SELECT prior_work.* FROM prior_work JOIN tasks ON tasks.id = prior_work.task_id WHERE prior_work.workflow_id = ? AND prior_work.plan_key = ? AND prior_work.task_id <> ? ORDER BY tasks.created_at DESC, tasks.rowid DESC, prior_work.attempt_id DESC, prior_work.created_at DESC",
        )
        .all(key.workflowId, key.planKey, task.id)
        .map((row) => toPatch(root, row))
}

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

/** The attempt of a task that was running at `at` (its newest attempt when `at` is not given); '' when it had none. */
const attemptAt = (db: DatabaseSync, taskId: string, at?: string): string => {
    if (at === undefined) return latestAttempt(db, taskId)?.id ?? ""
    const row = db.prepare("SELECT id FROM attempts WHERE task_id = ? AND started_at <= ? ORDER BY seq DESC LIMIT 1").get(taskId, at)
    return row === undefined ? (latestAttempt(db, taskId)?.id ?? "") : text(row.id)
}

/** The row already stored for a source of a task, if any: a source is stored once however often it is collected. */
const storedFrom = (root: string, db: DatabaseSync, taskId: string, source: string): PriorPatch | undefined => {
    const row = db.prepare("SELECT * FROM prior_work WHERE task_id = ? AND source = ?").get(taskId, source)
    return row === undefined ? undefined : toPatch(root, row)
}

/**
 * Files the patch in `out` under its sha256 (written once, by rename, so a reader never sees half a file) and indexes it by
 * (workflow, plan key, contract hash, attempt, kind, sha256). Idempotent; an empty patch stores nothing.
 */
const fileStored = (root: string, db: DatabaseSync, task: TaskRow, out: string, entry: { readonly attemptId: string; readonly kind: PriorKind; readonly base: string; readonly source: string }): PriorPatch | undefined => {
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
    ).run(key.workflowId, key.planKey, task.contractHash, entry.attemptId, entry.kind, sha256, task.id, entry.base, entry.source, now())
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

/**
 * Stores the work a preserve kept in `dir` (preserved/<task>[.n]: changes.patch, untracked/ and manifest.json) as one patch
 * against the preserve's head: the tracked changes and the untracked files alike, so one `git apply` brings all of it back.
 * The attempt is the one running at `at` (the preserve's time), else the task's newest. Idempotent per folder.
 */
export const storePreserved = async (root: string, db: DatabaseSync, task: TaskRow, dir: string, at?: string): Promise<PriorPatch | undefined> => {
    const known = storedFrom(root, db, task.id, dir)
    if (known !== undefined) return known
    const manifest = readManifest(dir)
    const changes = join(dir, "changes.patch")
    const files = manifest.untracked.map((path) => ({ path, file: join(dir, "untracked", path) })).filter((item) => existsSync(item.file))
    const tree = await treeOf(root, manifest.head, existsSync(changes) ? changes : null, files)
    const out = storeScratch(root)
    try {
        await diffInto(root, manifest.head, tree, specsOf(task), out)
        return fileStored(root, db, task, out, { attemptId: attemptAt(db, task.id, at), kind: "preserved", base: manifest.head, source: dir })
    } finally {
        rmSync(out, { force: true })
    }
}

/**
 * Stores the work a settle committed for a task: the diff of `commit` against its first parent, limited to the task's
 * allowPaths. The attempt is the task's green one, else its newest. Idempotent per commit.
 */
export const storeCommitted = async (root: string, db: DatabaseSync, task: TaskRow, commit: string): Promise<PriorPatch | undefined> => {
    const sha = (await git(root, ["rev-parse", `${commit}^{commit}`])).trim()
    const known = storedFrom(root, db, task.id, sha)
    if (known !== undefined) return known
    const base = (await git(root, ["rev-parse", `${sha}^1`])).trim()
    const green = db.prepare("SELECT id FROM attempts WHERE task_id = ? AND verdict = 'green' ORDER BY seq DESC LIMIT 1").get(task.id)
    const out = storeScratch(root)
    try {
        await diffInto(root, base, sha, specsOf(task), out)
        return fileStored(root, db, task, out, { attemptId: green === undefined ? attemptAt(db, task.id) : text(green.id), kind: "committed", base, source: sha })
    } finally {
        rmSync(out, { force: true })
    }
}

/** The commit a settle landed for a done task, found by its `Starci-Task` trailer on the local branches; Work-only commits are skipped. */
const settledCommit = async (root: string, taskId: string): Promise<string | undefined> => {
    const log = await git(root, ["log", "--branches", "-F", `--grep=Starci-Task: ${taskId}`, "--format=%H %s"])
    return log
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .find((line) => !line.slice(41).startsWith("work: "))
        ?.slice(0, 40)
}

/**
 * Collects into the store every earlier attempt of the task's key that is not there yet: each preserve the ledger recorded
 * (`task-preserved` events) and the settle commit of a done task. Never throws for one source: a source it cannot read is an
 * event, and the rest is still collected. Returns the key's stored patches, newest first.
 */
export const collectPriorWork = async (root: string, db: DatabaseSync, task: TaskRow): Promise<PriorPatch[]> => {
    const ids = priorTaskIds(db, task, priorKey(db, task))
    await inOrder(ids, async (id) => {
        const prior = getTask(db, id)
        const preserves = db.prepare("SELECT at, data_json FROM events WHERE kind = 'task-preserved' AND subject = ? ORDER BY id").all(id)
        await inOrder(preserves, async (event) => {
            const data: unknown = JSON.parse(text(event.data_json))
            const dir = typeof data === "object" && data !== null && "dir" in data && typeof data.dir === "string" ? data.dir : undefined
            if (dir === undefined || !existsSync(join(dir, "manifest.json"))) return
            try {
                await storePreserved(root, db, prior, dir, text(event.at))
            } catch (error: unknown) {
                recordEvent(db, "prior-store-failed", id, { source: dir, error: asRefusal(error).message })
            }
        })
        if (prior.status !== "done") return
        try {
            const commit = await settledCommit(root, id)
            if (commit !== undefined) await storeCommitted(root, db, prior, commit)
        } catch (error: unknown) {
            recordEvent(db, "prior-store-failed", id, { source: "settle commit", error: asRefusal(error).message })
        }
    })
    return priorPatches(root, db, task)
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

/** Applies the newest patch to a clean checkout; the caller records the answer. */
const applyNewest = async (worktree: string, task: TaskRow, newest: PriorPatch): Promise<PriorApplied> => {
    const from = { patch: newest.file, sha256: newest.sha256, kind: newest.kind, fromTask: newest.taskId }
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
 * The launch-time apply: before a worker starts, brings the newest prior patch of the task's key (collected into the store
 * first) back onto the worker's checkout `worktree` with `git apply --3way`, limited to the task's allowPaths. A patch that
 * does not apply cleanly leaves no conflict markers: the checkout is put back and the brief points at the patch instead.
 * Records a `prior-applied` event the brief reads, so call it before the brief is written (or write the brief again after).
 */
export const applyPriorWork = async (root: string, worktree: string, task: TaskRow): Promise<PriorApplied> => {
    const db = openLedger(root)
    try {
        const newest = (await collectPriorWork(root, db, task))[0]
        let applied: PriorApplied
        if (newest === undefined) applied = { outcome: "none", patch: null, sha256: null, kind: null, fromTask: null, detail: "no earlier attempt of this key left work" }
        else {
            try {
                applied = await applyNewest(worktree, task, newest)
            } catch (error: unknown) {
                applied = { outcome: "conflicted", patch: newest.file, sha256: newest.sha256, kind: newest.kind, fromTask: newest.taskId, detail: asRefusal(error).message }
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
    if (newest === undefined) return "Prior patch: none; the earlier attempts left no stored change."
    const where = `${slashed(newest.file)} (${newest.kind}, task ${newest.taskId}, against ${newest.base.slice(0, 12)})`
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
            `This task repeats ${String(ids.length)} earlier task(s) of the same work (${ids.join(", ")}). Start from their work; never redo it blindly.`,
            changes.length === 0 ? "Contract, previous -> this: unchanged." : `Contract, previous (${previous.id}) -> this:\n\n${changes.map((change) => "- " + change).join("\n")}`,
            resultLines(db, previous).join("\n"),
            patchLine(task, stored[0], asApplied(lastEvent(db, APPLIED_EVENT, task.id))),
        ]
        return lines.join("\n\n")
    } finally {
        db.close()
    }
}
