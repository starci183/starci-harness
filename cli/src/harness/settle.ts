import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { setTimeout as sleep } from "node:timers/promises"
import { asRefusal, Refusal } from "../shared/errors.js"
import { headline, pidAlive } from "../shared/exec.js"
import { captureGit, currentBranch, git, gitSucceeds, resolveSha } from "../shared/git.js"
import type { CleanVerify } from "./clean-verify.js"
import { taskPaths } from "./contract.js"
import type { Contract } from "./contract.js"
import { heavyOwner, queuedSince } from "./heavy.js"
import type { LandTarget } from "./land.js"
import { now } from "./ledger.js"
import { loadLiveness } from "./liveness.js"
import { loadOps } from "./ops.js"
import { clearStale } from "./preserve.js"
import type { StaleCleared } from "./preserve.js"
import type { ResultSource } from "./run-checks.js"
import { inOrder } from "./sequential.js"
import type { TaskRow } from "./tasks.js"
import { appendEvidence, digestRun, judgeUatResult, parseUatRecord, placeOfRecord, runFiles, uatBinding, writeRecordState } from "./work.js"
import type { EvidenceRun, UatBinding } from "./work.js"

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
    /** What the settle found dirty in the checkout it lands on and cleared first (preserve.ts clearStale); null when nothing was. */
    readonly stale: StaleCleared | null
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

/** The branch a checkout has checked out, which a settle there moves; a detached HEAD has none, so nothing can be settled. */
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

/** The verifier lock of a task: held from a settling verify's claim to its end, so --recover tells a live verify from a dead one. */
export const verifyLockKey = (taskId: string): string => `verify-lock:${taskId}`

const LOCK_POLL_MS = 500

/** How often the settle lock's holder stamps its heartbeat, and how old a heartbeat may grow before its holder counts as gone. */
const LOCK_BEAT_MS = 10_000

const LOCK_STALE_MS = 120_000

/** The settle lock row as stored: the verifier, its last heartbeat, when it took the lock and how long its heavy commands have waited in the queue since. */
interface LockRow extends Verifier {
    readonly beat: string
    readonly since: string
    readonly queuedMs: number
}

/**
 * How long one verify may hold a lock (ops/liveness.yaml verifyDeadlineMinutes), counted over the time its heavy commands ran,
 * never the time they waited in the heavy queue (`queuedMs`): past it the holder gives the lock up, and counts as gone.
 */
const verifyDeadlineMs = (): number => loadLiveness().verifyDeadlineMinutes * 60_000

const readLock = (db: DatabaseSync, key: string): LockRow | undefined => {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key)
    if (row === undefined) return undefined
    const value: unknown = JSON.parse(String(row.value))
    const verifier = asVerifier(value)
    if (verifier === undefined) return undefined
    const { beat, since, queuedMs } = value as Record<string, unknown>
    return { ...verifier, beat: typeof beat === "string" ? beat : verifier.at, since: typeof since === "string" ? since : verifier.at, queuedMs: typeof queuedMs === "number" ? queuedMs : 0 }
}

/**
 * True while the lock's holder lives: its heartbeat is fresh, it held the lock less than the verify deadline outside the heavy queue, and on this host
 * its pid still runs. A stale heartbeat frees the lock even when the pid runs, since Windows reuses pids and a reused pid would
 * otherwise hold the lock forever; a holder past the deadline (a verify hung in-process, its heartbeat still beating) is gone too,
 * so `task verify --recover` takes its task over.
 */
const holderAlive = (holder: LockRow): boolean => Date.now() - Date.parse(holder.beat) < LOCK_STALE_MS && Date.now() - Date.parse(holder.since) - holder.queuedMs < verifyDeadlineMs() && verifierAlive(holder)

/** The live holder of a lock (`verifyLockKey` of a task, or a land lock), if any: a verifying task with no live holder has no verifier left. */
export const settleLockHolder = (db: DatabaseSync, key: string): Verifier | undefined => {
    const holder = readLock(db, key)
    return holder !== undefined && holderAlive(holder) ? holder : undefined
}

const mine = "key = ? AND json_extract(value, '$.task') = ? AND json_extract(value, '$.pid') = ? AND json_extract(value, '$.host') = ?"

/** Takes the lock row if it is free or its holder died; one statement pair under BEGIN IMMEDIATE, so two verifiers never both win. */
const tryLock = (db: DatabaseSync, me: Verifier, key: string): Verifier | undefined => {
    db.exec("BEGIN IMMEDIATE")
    try {
        const holder = readLock(db, key)
        if (holder !== undefined && holderAlive(holder)) {
            db.exec("COMMIT")
            return holder
        }
        db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify({ ...me, beat: now(), since: now() }))
        db.exec("COMMIT")
        return undefined
    } catch (error: unknown) {
        db.exec("ROLLBACK")
        throw error
    }
}

/** Takes the settle lock, polling until `deadline`; refuses with SETTLE_BUSY when its holder outlasts it. */
const acquireLock = async (db: DatabaseSync, me: Verifier, key: string, deadline: number): Promise<void> => {
    const holder = tryLock(db, me, key)
    if (holder === undefined) return
    if (Date.now() >= deadline) {
        throw new Refusal("SETTLE_BUSY", `task ${holder.task} has been verifying since ${holder.at} (pid ${String(holder.pid)} on ${holder.host}); nothing changed, verify again when it ends`)
    }
    await sleep(LOCK_POLL_MS)
    await acquireLock(db, me, key, deadline)
}

/**
 * Refuses with VERIFY_DEADLINE once `me` no longer holds the lock `key`: a verify that resumes after the lock gave it up at its
 * deadline (another verifier may hold it now) records, preserves and lands nothing.
 */
export const assertSettleLockHeld = (db: DatabaseSync, me: Verifier, key: string): void => {
    if (db.prepare(`SELECT 1 FROM meta WHERE ${mine}`).get(key, me.task, me.pid, me.host) !== undefined) return
    throw new Refusal("VERIFY_DEADLINE", `the verify of ${me.task} no longer holds its lock (it passed its deadline); it settles nothing`)
}

/**
 * Runs `work` while this process holds the lock `key` (a ledger row): a task's verifier lock (`verifyLockKey`) for its whole
 * settling verify, or a land lock (harness/land.ts `landLockKey`), one per target branch, only while a verified commit is
 * integrated, so landings onto one branch run one at a time and each lands on the head the previous one left. A holder whose
 * process died is taken over; waiting longer than `waitMs` refuses with SETTLE_BUSY and changes nothing. The holder stamps a
 * heartbeat while it works (with the time its heavy commands have waited in the queue since it took the lock), so a lock whose
 * holder stopped beating is taken over even when its pid was reused, and gives the lock up once it held it for the verify deadline
 * outside the heavy queue, refusing with VERIFY_DEADLINE (work that resumes later is fenced by assertSettleLockHeld).
 */
export const withSettleLock = async <T>(db: DatabaseSync, me: Verifier, waitMs: number, key: string, work: () => Promise<T>): Promise<T> => {
    await acquireLock(db, me, key, Date.now() + waitMs)
    const taken = Date.now()
    const since = new Date(taken).toISOString()
    const keys = [key, me.task, me.pid, me.host] as const
    // An unreadable governor store counts no queue time: the deadline then runs as if every wait had run.
    const queued = (): number => {
        try {
            return queuedSince(heavyOwner(), since)
        } catch {
            return 0
        }
    }
    const beat = setInterval(() => {
        try {
            db.prepare(`UPDATE meta SET value = json_set(value, '$.beat', ?, '$.queuedMs', ?) WHERE ${mine}`).run(now(), queued(), ...keys)
        } catch {
            // A busy ledger skips one beat; the next one, well inside the stale window, lands.
        }
    }, LOCK_BEAT_MS)
    beat.unref()
    // The holder gives the lock up itself at the verify deadline, counted outside the heavy queue: a verify hung on an await
    // never holds it past that, and one whose commands wait for the host is never stopped for the wait.
    let deadline: NodeJS.Timeout | undefined
    const expired = new Promise<never>((_, refuse) => {
        const arm = (): void => {
            const left = verifyDeadlineMs() - (Date.now() - taken - queued())
            if (left <= 0) {
                refuse(new Refusal("VERIFY_DEADLINE", `the verify of ${me.task} held the lock ${key} past its deadline (ops/liveness.yaml verifyDeadlineMinutes, the heavy queue's wait aside) and gave it up; it reached no verdict`))
                return
            }
            deadline = setTimeout(arm, left)
            deadline.unref()
        }
        arm()
    })
    try {
        return await Promise.race([work(), expired])
    } finally {
        clearTimeout(deadline)
        clearInterval(beat)
        db.prepare(`DELETE FROM meta WHERE ${mine}`).run(...keys)
    }
}

const INDEX_TRIES = 5

const INDEX_RETRY_MS = 400

/** Refreshes the user's index for the settled paths; best effort, since the branch already moved: a held index.lock is retried, then reported. */
const refreshIndex = async (root: string, paths: readonly string[]): Promise<string[]> => {
    if (paths.length === 0) return []
    const last = await resetIndex(root, paths, 1)
    if (last === undefined) return []
    return [`the branch moved, but the index of the settled paths was not refreshed (${last}); \`git status\` may show them changed until \`git reset -q -- <paths>\` runs`]
}

/** One `git reset` of the paths, retried while a held index.lock is the only complaint; undefined when it worked, else the last complaint. */
const resetIndex = async (root: string, paths: readonly string[], attempt: number): Promise<string | undefined> => {
    const run = await captureGit(["reset", "-q", "--", ...paths.map((path) => `:(top,literal)${path}`)], root)
    if (run.exitCode === 0) return undefined
    const last = headline(run.stderr)
    if (!last.includes("index.lock") || attempt >= INDEX_TRIES) return last
    await sleep(INDEX_RETRY_MS * attempt)
    return resetIndex(root, paths, attempt + 1)
}

const literal = (path: string): string => `:(top,literal)${path}`

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
        const run = await captureGit(args, root, { env: { GIT_INDEX_FILE: index } })
        if (run.exitCode !== 0) {
            const why = headline(run.stderr) || `exit ${String(run.exitCode)}`
            throw new Refusal("CLI_TOOL_FAILED", `git ${args.join(" ")} failed: ${why}`)
        }
        return run.stdout
    }
    try {
        await indexed(["read-tree", onto])
        await inOrder(files, async (file) => {
            writeFileSync(scratch, file.text)
            const blob = await git(root, ["hash-object", "-w", `--path=${file.path}`, scratch])
            const listed = await git(root, ["ls-tree", onto, "--", literal(file.path)])
            const mode = listed === "" ? "100644" : (listed.split(" ")[0] ?? "100644")
            await indexed(["update-index", "--add", "--cacheinfo", `${mode},${blob},${file.path}`])
        })
        const tree = await indexed(["write-tree"])
        return await git(root, ["commit-tree", tree, "-p", parent, "-m", message])
    } finally {
        rmSync(scratch, { force: true })
        rmSync(index, { force: true })
    }
}

/** Puts the Work files of a landed commit into the user's work tree and index; best effort, since the branch already moved. */
const checkoutWork = async (root: string, commit: string, paths: readonly string[]): Promise<string[]> => {
    const run = await captureGit(["checkout", "-q", commit, "--", ...paths.map(literal)], root)
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
export const workLine = (work: WorkWrite): string => {
    if (work.skipped !== null) return `work: ${work.record} left as it was: ${work.skipped}`
    const atStep = work.step === null ? "" : " at step " + String(work.step)
    const warning = work.warning === null ? "" : "; warning: " + work.warning
    return `work: ${work.record} -> state ${String(work.state)}, activity ${String(work.activity)}${atStep}; run ${work.run} cited in its evidence.yaml (${String(work.commit?.slice(0, 12))})${warning}`
}

/**
 * Lands exactly the candidate the checks saw on the target's branch, only while it still points at the candidate's parent
 * (call it under the target's land lock). A task working in the target checkout itself moves the ref and refreshes the index of
 * the settled paths, whose files its work tree already holds; a task of an Op worktree fast-forwards the target checkout
 * (`git merge --ff-only`), which moves its branch, index and work tree together. What is dirty there on a path it writes or
 * under the task's allowPaths (a leftover of an earlier writer, the task's own escaped copy) is cleared first, recorded on the
 * task in `db` (preserve.ts clearStale: dropped when git holds its content, else preserved), so the merge never refuses over it,
 * never overwrites what only the work tree held, and the checkout holds none of the task's work once it landed. A uat task's
 * Work rides in the same harness commit: the candidate's tree plus the record's `state: done` and `activity: idle` and its run
 * cited in the flow's evidence.yaml, read in the target checkout; a Work file the user is editing is left alone, with a warning. Once the ref moved the settle stands: refreshing the index and the Work files is best effort and
 * only warns. Nothing is pushed.
 */
export const settle = async (target: LandTarget, built: CleanVerify, task?: TaskRow, db?: DatabaseSync): Promise<Settlement> => {
    const root = target.checkout
    const branch = await settleBranch(root)
    if (branch !== target.branch) throw new Refusal("SETTLE_BRANCH_MOVED", `${root} has ${branch} checked out, not ${target.branch}, the branch the task lands on; nothing was landed, verify again`)
    const moved = (head: string): Refusal =>
        new Refusal("HEAD_MOVED", `${branch} moved from ${built.parent.slice(0, 12)} to ${head.slice(0, 12)} after the candidate was built; the work tree is untouched and no try is spent, verify again`)
    const head = await resolveSha(root, "HEAD")
    if (head !== built.parent) throw moved(head)
    const binding = task === undefined ? undefined : uatBinding(task.contract, loadOps())
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
    const stale = target.own || db === undefined ? null : await clearStale(root, db, task?.id ?? `land:${branch}`, candidate, task === undefined ? [] : taskPaths(task))
    if (changed.length === 0) return { branch, commit: head, committed: false, warnings: [], work, stale }
    const update = target.own
        ? await captureGit(["update-ref", "-m", "starci settle", `refs/heads/${branch}`, candidate, built.parent], root)
        : await captureGit(["merge", "--ff-only", "--quiet", candidate], root)
    if (update.exitCode !== 0) {
        const after = await resolveSha(root, "HEAD")
        if (after !== built.parent) throw moved(after)
        throw new Refusal("SETTLE_REF_FAILED", `git ${target.own ? "update-ref" : "merge --ff-only"} of ${branch} failed: ${headline(update.stderr)}; ${stale === null ? "the work tree is untouched" : "its dirty paths were cleared first (land-stale)"} and no try is spent, verify again`)
    }
    const refreshed = target.own ? [...(await refreshIndex(root, built.paths)), ...(workPaths.length === 0 ? [] : await checkoutWork(root, candidate, workPaths))] : []
    return { branch, commit: candidate, committed: true, warnings: refreshed, work, stale }
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
    const binding = uatBinding(task.contract, loadOps())
    if (binding === undefined) return null
    const outcome = redOutcome(root, binding, result, red)
    try {
        const branch = await settleBranch(root)
        const head = await resolveSha(root, "HEAD")
        const plan = await planWork(root, head, task, binding, outcome)
        const where = outcome.step === undefined ? "" : ` at step ${String(outcome.step)}`
        const commit = await commitWork(root, head, head, plan.files, `work: ${plan.id} blocked${where}\n\nStarci-Task: ${task.id}`)
        const update = await captureGit(["update-ref", "-m", "starci work", `refs/heads/${branch}`, commit, head], root)
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
