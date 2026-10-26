import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { setTimeout as sleep } from "node:timers/promises"
import { asRefusal, Refusal } from "../shared/errors.js"
import { captureTool, headline, pidAlive } from "../shared/exec.js"
import { currentBranch, git, gitSucceeds, resolveSha } from "../shared/git.js"
import type { CleanVerify } from "./clean-verify.js"
import { resolveChecks } from "./contract.js"
import type { Contract } from "./contract.js"
import { now } from "./ledger.js"
import { loadOps } from "./ops.js"
import type { ResultSource } from "./run-checks.js"
import type { TaskRow } from "./tasks.js"
import { appendEvidence, digestRun, judgeUatResult, parseUatRecord, placeOfRecord, runFiles, writeRecordState } from "./work.js"
import type { EvidenceRun } from "./work.js"

/**
 * What a settle wrote into the Work of a uat task (one whose contract carries a uat-flow check): the record's new state and
 * activity and the run its evidence.yaml now cites, in `commit`; or, in `skipped`, why the Work was left as it was.
 */
export interface WorkWrite {
    readonly record: string
    readonly state: string | null
    readonly activity: string | null
    readonly run: string
    readonly verdict: "passed" | "failed"
    readonly step: number | null
    readonly commit: string | null
    readonly skipped: string | null
    readonly warning: string | null
}

/** What a settle did: the branch it moved and the commit it now points at; `committed` is false when the task changed nothing. */
export interface Settlement {
    readonly branch: string
    readonly commit: string
    readonly committed: boolean
    readonly warnings: readonly string[]
    readonly work: WorkWrite | null
}

/** Who verifies a task now: the process, its host and when it began; a dead pid on this host means nobody does. */
export interface Verifier {
    readonly task: string
    readonly pid: number
    readonly host: string
    readonly at: string
}

/** The message of a task's harness commit: `<label>: <summary>` and the task trailer. */
export const settleMessage = (contract: Contract, taskId: string): string => `${contract.label}: ${contract.input.summary}\n\nStarci-Task: ${taskId}`

/** The branch a settle will move; a detached HEAD has none, so nothing can be settled. */
export const settleBranch = async (root: string): Promise<string> => {
    const branch = await currentBranch(root)
    if (branch === undefined) throw new Refusal("HEAD_DETACHED", `${root} is on a detached HEAD; check out the branch the task lands on, then verify again`)
    return branch
}

/** This process as a verifier of `task`. */
export const thisVerifier = (task: string): Verifier => ({ task, pid: process.pid, host: hostname(), at: now() })

/** True when the verifier is a process still running on this host; one on another host is assumed alive. */
export const verifierAlive = (verifier: Verifier): boolean => verifier.host !== hostname() || pidAlive(verifier.pid)

/** Reads a verifier back from stored json, or undefined when it is not one. */
export const asVerifier = (value: unknown): Verifier | undefined => {
    if (typeof value !== "object" || value === null) return undefined
    const record = value as Record<string, unknown>
    const { task, pid, host, at } = record
    return typeof task === "string" && typeof pid === "number" && typeof host === "string" && typeof at === "string" ? { task, pid, host, at } : undefined
}

const LOCK_KEY = "settle-lock"

const LOCK_POLL_MS = 500

/** Takes the lock row if it is free or its holder died; one statement pair under BEGIN IMMEDIATE, so two verifiers never both win. */
const tryLock = (db: DatabaseSync, me: Verifier): Verifier | undefined => {
    db.exec("BEGIN IMMEDIATE")
    try {
        const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(LOCK_KEY)
        const holder = row === undefined ? undefined : asVerifier(JSON.parse(String(row.value)))
        if (holder !== undefined && verifierAlive(holder)) {
            db.exec("COMMIT")
            return holder
        }
        db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(LOCK_KEY, JSON.stringify(me))
        db.exec("COMMIT")
        return undefined
    } catch (error: unknown) {
        db.exec("ROLLBACK")
        throw error
    }
}

/**
 * Runs `work` while this process holds the project's settle lock (a ledger row), so verifies that settle run one at a time
 * (side serialisation): each builds its candidate on the HEAD the previous one left. A holder whose process died is taken
 * over; waiting longer than `waitMs` refuses with SETTLE_BUSY and changes nothing.
 */
export const withSettleLock = async <T>(db: DatabaseSync, me: Verifier, waitMs: number, work: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + waitMs
    for (;;) {
        const holder = tryLock(db, me)
        if (holder === undefined) break
        if (Date.now() >= deadline) {
            throw new Refusal("SETTLE_BUSY", `task ${holder.task} has been verifying since ${holder.at} (pid ${String(holder.pid)} on ${holder.host}); nothing changed, verify again when it ends`)
        }
        await sleep(LOCK_POLL_MS)
    }
    try {
        return await work()
    } finally {
        db.prepare("DELETE FROM meta WHERE key = ? AND value = ?").run(LOCK_KEY, JSON.stringify(me))
    }
}

const INDEX_TRIES = 5

const INDEX_RETRY_MS = 400

/** Refreshes the user's index for the settled paths; best effort, since the branch already moved: a held index.lock is retried, then reported. */
const refreshIndex = async (root: string, paths: readonly string[]): Promise<string[]> => {
    if (paths.length === 0) return []
    let last = ""
    for (let attempt = 1; attempt <= INDEX_TRIES; attempt++) {
        const run = await captureTool("git", ["reset", "-q", "--", ...paths.map((path) => `:(top,literal)${path}`)], root)
        if (run.exitCode === 0) return []
        last = headline(run.stderr)
        if (!last.includes("index.lock")) break
        await sleep(INDEX_RETRY_MS * attempt)
    }
    return [`the branch moved, but the index of the settled paths was not refreshed (${last}); \`git status\` may show them changed until \`git reset -q -- <paths>\` runs`]
}

const literal = (path: string): string => `:(top,literal)${path}`

/** The record and run folder a task's uat-flow check names. */
interface UatBinding {
    readonly record: string
    readonly run: string
}

/** The binding of a task that walks a Work flow; undefined for any other task. */
const uatBinding = (contract: Contract): UatBinding | undefined => {
    for (const { check } of resolveChecks(contract, loadOps())) if (check.kind === "uat-flow") return { record: check.record, run: check.run }
    return undefined
}

/** One file a Work write puts into a commit. */
interface WorkFile {
    readonly path: string
    readonly text: string
}

/** A planned Work write: the record id, the files to commit and what they say. */
interface WorkPlan {
    readonly id: string
    readonly files: readonly WorkFile[]
    readonly write: Omit<WorkWrite, "commit" | "skipped" | "warning">
}

/**
 * Reads a Work file of the work tree that a commit on `base` may rewrite: it must be what `base` holds (a user's uncommitted
 * edit is never overwritten), or absent from both when `base` has none.
 */
const cleanWorkText = async (root: string, base: string, path: string): Promise<string | undefined> => {
    const file = join(root, path)
    if (!(await gitSucceeds(root, ["cat-file", "-e", `${base}:${path}`]))) {
        if (existsSync(file)) throw new Refusal("WORK_DIRTY", `${path} exists in the work tree but not in ${base.slice(0, 12)}; it is left as it is`)
        return undefined
    }
    if (!(await gitSucceeds(root, ["diff", "--quiet", base, "--", literal(path)]))) throw new Refusal("WORK_DIRTY", `${path} has uncommitted changes; it is left as it is`)
    return readFileSync(file, "utf8")
}

/** The record's new state and activity and the run appended to its evidence.yaml, read against `base`. */
const planWork = async (root: string, base: string, task: TaskRow, binding: UatBinding, outcome: Pick<EvidenceRun, "verdict" | "step" | "reason">): Promise<WorkPlan> => {
    const place = placeOfRecord(binding.record)
    const recordText = await cleanWorkText(root, base, place.record)
    if (recordText === undefined) throw new Refusal("WORK_RECORD_MISSING", `${place.record} is not in ${base.slice(0, 12)}`)
    const record = parseUatRecord(recordText, place.record)
    const state = outcome.verdict === "passed" ? "done" : undefined
    const activity = outcome.verdict === "passed" ? "idle" : "blocked"
    const run: EvidenceRun = {
        run: binding.run.split("/").pop() ?? binding.run,
        task: task.id,
        at: now(),
        path: binding.run,
        ...outcome,
        files: digestRun(join(root, binding.run)),
    }
    return {
        id: record.id,
        files: [
            { path: place.record, text: writeRecordState(recordText, state === undefined ? { activity } : { state, activity }, place.record) },
            { path: place.evidence, text: appendEvidence(await cleanWorkText(root, base, place.evidence), record.id, run, place.evidence) },
        ],
        write: { record: place.record, state: state ?? record.state, activity, run: binding.run, verdict: outcome.verdict, step: outcome.step ?? null },
    }
}

/**
 * Commits `files` onto the tree of `onto` with `parent` as its parent, through a temporary index (the user's index and work
 * tree stay as they are). Each blob is hashed with its path, so the repository's line-ending rules apply as `git add` would.
 */
const commitWork = async (root: string, onto: string, parent: string, files: readonly WorkFile[], message: string): Promise<string> => {
    const scratch = join(tmpdir(), `starci-work-${randomBytes(6).toString("hex")}`)
    const index = `${scratch}.index`
    const indexed = async (args: readonly string[]): Promise<string> => {
        const run = await captureTool("git", args, root, { env: { GIT_INDEX_FILE: index } })
        if (run.exitCode !== 0) throw new Refusal("CLI_TOOL_FAILED", `git ${args.join(" ")} failed: ${headline(run.stderr) || `exit ${String(run.exitCode)}`}`)
        return run.stdout
    }
    try {
        await indexed(["read-tree", onto])
        for (const file of files) {
            writeFileSync(scratch, file.text)
            const blob = await git(root, ["hash-object", "-w", `--path=${file.path}`, scratch])
            const listed = await git(root, ["ls-tree", onto, "--", literal(file.path)])
            const mode = listed === "" ? "100644" : (listed.split(" ")[0] ?? "100644")
            await indexed(["update-index", "--add", "--cacheinfo", `${mode},${blob},${file.path}`])
        }
        const tree = await indexed(["write-tree"])
        return await git(root, ["commit-tree", tree, "-p", parent, "-m", message])
    } finally {
        rmSync(scratch, { force: true })
        rmSync(index, { force: true })
    }
}

/** Puts the Work files of a landed commit into the user's work tree and index; best effort, since the branch already moved. */
const checkoutWork = async (root: string, commit: string, paths: readonly string[]): Promise<string[]> => {
    const run = await captureTool("git", ["checkout", "-q", commit, "--", ...paths.map(literal)], root)
    return run.exitCode === 0 ? [] : [`the branch moved, but the Work files were not refreshed in the work tree (${headline(run.stderr)}); \`git checkout HEAD -- ${paths.join(" ")}\` brings them`]
}

const skippedWrite = (binding: UatBinding, verdict: WorkWrite["verdict"], step: number | undefined, why: string): WorkWrite => ({
    record: binding.record,
    state: null,
    activity: null,
    run: binding.run,
    verdict,
    step: step ?? null,
    commit: null,
    skipped: why,
    warning: null,
})

/** One line on what a settle did to the Work, for the verify report. */
export const workLine = (work: WorkWrite): string =>
    work.skipped === null
        ? `work: ${work.record} -> state ${String(work.state)}, activity ${String(work.activity)}${work.step === null ? "" : ` at step ${String(work.step)}`}; run ${work.run} cited in its evidence.yaml (${String(work.commit?.slice(0, 12))})${work.warning === null ? "" : `; warning: ${work.warning}`}`
        : `work: ${work.record} left as it was: ${work.skipped}`

/**
 * Lands exactly the candidate the checks saw: the branch moves to that commit only while it still points at the candidate's
 * parent. A uat task's Work rides in the same harness commit: the candidate's tree plus the record's `state: done` and
 * `activity: idle` and its run cited in the flow's evidence.yaml; a Work file the user is editing is left alone, with a
 * warning. Once the ref moved the settle stands: refreshing the index and the Work files is best effort and only warns.
 * The work tree is never written but for those Work files, and nothing is pushed.
 */
export const settle = async (root: string, built: CleanVerify, task?: TaskRow): Promise<Settlement> => {
    const branch = await settleBranch(root)
    const moved = (head: string): Refusal =>
        new Refusal("HEAD_MOVED", `${branch} moved from ${built.parent.slice(0, 12)} to ${head.slice(0, 12)} after the candidate was built; the work tree is untouched and no try is spent, verify again`)
    const head = await resolveSha(root, "HEAD")
    if (head !== built.parent) throw moved(head)
    const binding = task === undefined ? undefined : uatBinding(task.contract)
    let candidate = built.candidate
    let changed = built.changed
    let work: WorkWrite | null = null
    let workPaths: string[] = []
    if (task !== undefined && binding !== undefined) {
        try {
            const plan = await planWork(root, built.parent, task, binding, { verdict: "passed" })
            candidate = await commitWork(root, built.candidate, built.parent, plan.files, await git(root, ["log", "-1", "--format=%B", built.candidate]))
            workPaths = plan.files.map((file) => file.path)
            changed = [...new Set([...changed, ...workPaths])]
            work = { ...plan.write, commit: candidate, skipped: null, warning: null }
        } catch (error: unknown) {
            work = skippedWrite(binding, "passed", undefined, asRefusal(error).message)
        }
    }
    if (changed.length === 0) return { branch, commit: head, committed: false, warnings: [], work }
    const update = await captureTool("git", ["update-ref", "-m", "starci settle", `refs/heads/${branch}`, candidate, built.parent], root)
    if (update.exitCode !== 0) {
        const after = await resolveSha(root, "HEAD")
        if (after !== built.parent) throw moved(after)
        throw new Refusal("SETTLE_REF_FAILED", `git update-ref of ${branch} failed: ${headline(update.stderr)}; the work tree is untouched and no try is spent, verify again`)
    }
    const refreshed = [...(await refreshIndex(root, built.paths)), ...(workPaths.length === 0 ? [] : await checkoutWork(root, candidate, workPaths))]
    return { branch, commit: candidate, committed: true, warnings: refreshed, work }
}

/** Where a red walk stopped: the first failing step and its reason from the filed result, else the names of the red checks. */
const redOutcome = (root: string, binding: UatBinding, result: ResultSource | undefined, red: readonly string[]): Pick<EvidenceRun, "verdict" | "step" | "reason"> => {
    const fallback = { verdict: "failed" as const, reason: `red checks: ${red.join(", ") || "none named"}` }
    if (result === undefined || !("output" in result)) return fallback
    try {
        const record = parseUatRecord(readFileSync(join(root, binding.record), "utf8"), binding.record)
        const judged = judgeUatResult(record, result.output, new Set(runFiles(join(root, binding.run))))
        const first = judged.problems.find((problem) => problem.step === judged.failingStep) ?? judged.problems[0]
        if (first === undefined) return fallback
        return { verdict: "failed", ...(judged.failingStep === undefined ? {} : { step: judged.failingStep }), reason: first.text }
    } catch {
        return fallback
    }
}

/**
 * The Work write of a red uat task: the record's `activity: blocked` (its state kept) and the run cited in evidence.yaml with
 * its first failing step, in a commit of its own on HEAD, since a red verdict lands no harness commit. The run folder is
 * git-ignored, so the red verify never reset it and its files are digested as they are. Call it under the settle lock: the
 * branch moves only by compare-and-swap from the HEAD it read, nothing is pushed, and it never throws; a write it cannot make
 * comes back skipped with the reason.
 */
export const blockWork = async (root: string, task: TaskRow, result: ResultSource | undefined, red: readonly string[]): Promise<WorkWrite | null> => {
    const binding = uatBinding(task.contract)
    if (binding === undefined) return null
    const outcome = redOutcome(root, binding, result, red)
    try {
        const branch = await settleBranch(root)
        const head = await resolveSha(root, "HEAD")
        const plan = await planWork(root, head, task, binding, outcome)
        const where = outcome.step === undefined ? "" : ` at step ${String(outcome.step)}`
        const commit = await commitWork(root, head, head, plan.files, `work: ${plan.id} blocked${where}\n\nStarci-Task: ${task.id}`)
        const update = await captureTool("git", ["update-ref", "-m", "starci work", `refs/heads/${branch}`, commit, head], root)
        if (update.exitCode !== 0) throw new Refusal("HEAD_MOVED", `${branch} moved while the Work commit was built (${headline(update.stderr)}); nothing was written`)
        const warnings = await checkoutWork(
            root,
            commit,
            plan.files.map((file) => file.path),
        )
        return { ...plan.write, commit, skipped: null, warning: warnings[0] ?? null }
    } catch (error: unknown) {
        return skippedWrite(binding, "failed", outcome.step, asRefusal(error).message)
    }
}
