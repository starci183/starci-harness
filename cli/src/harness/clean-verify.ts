import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { captureNpm, captureTool, headline, pidAlive } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { changedFiles, git, resolveSha } from "../shared/git.js"
import { underPaths } from "./contract.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import { WORK_DIR } from "./ledger.js"
import { runCheck, strayFiles } from "./run-checks.js"
import type { CheckOutcome, CheckPlace, ResultSource } from "./run-checks.js"

const DETAIL_LINES = 30

const LIST_SHOWN = 20

/** The folder name every clean-verify checkout starts with; the pid in it tells a live verifier's checkout from a leftover. */
const VERIFY_PREFIX = "starci-verify-"

/** What a clean verify built and what its checks said about it; `paths` are the allowPaths added whole, `notes` what was skipped and why. */
export interface CleanVerify {
    readonly candidate: string
    readonly tree: string
    readonly parent: string
    readonly base: string
    readonly changed: readonly string[]
    readonly paths: readonly string[]
    readonly notes: readonly string[]
    readonly checks: readonly CheckOutcome[]
    readonly verdict: "green" | "red"
}

/**
 * What the caller hands a clean verify: the task's name for the temp folder and the message the candidate commit carries;
 * `taskId` and `since` scope the stray-files judgement, `result` feeds `@result` json checks, `timeoutMs` bounds npm ci and each check.
 */
export interface CleanVerifyInput {
    readonly root: string
    readonly contract: Contract
    readonly checks: readonly ResolvedCheck[]
    readonly name: string
    readonly message: string
    readonly taskId?: string
    readonly since?: string
    readonly result?: ResultSource
    readonly timeoutMs?: number
}

interface Built {
    readonly facts: Omit<CleanVerify, "base" | "checks" | "verdict">
    readonly lands: CheckOutcome
}

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter((line) => line !== "")

const listed = (files: readonly string[]): string => `${files.slice(0, LIST_SHOWN).join(", ")}${files.length > LIST_SHOWN ? ` and ${String(files.length - LIST_SHOWN)} more` : ""}`

const literal = (path: string): string => `:(top,literal)${path}`

// The temporary index lives only in GIT_INDEX_FILE of the child, so the user's index is never touched.
const gitIndexed = (cwd: string, index: string, args: readonly string[]): Promise<ToolRun> => captureTool("git", args, cwd, { env: { GIT_INDEX_FILE: index } })

const gitIndexedOk = async (cwd: string, index: string, args: readonly string[]): Promise<string> => {
    const run = await gitIndexed(cwd, index, args)
    if (run.exitCode !== 0) throw new Refusal("CLI_TOOL_FAILED", `git ${args.join(" ")} failed: ${headline(run.stderr) || `exit ${String(run.exitCode)}`}`)
    return run.stdout
}

interface Staged {
    readonly whole: readonly string[]
    readonly trackedOnly: readonly string[]
    readonly notes: readonly string[]
}

/**
 * Sorts the allowPaths for `git add`: one that names nothing is left out (git refuses a pathspec matching nothing), and one the
 * repository ignores lands only its tracked files (`git add` refuses an ignored path), with a note saying so.
 */
const stagePlan = async (root: string, index: string, allowPaths: readonly string[]): Promise<Staged> => {
    const whole: string[] = []
    const trackedOnly: string[] = []
    const notes: string[] = []
    for (const path of allowPaths) {
        if (underPaths(path, [WORK_DIR])) continue
        const tracked = (await gitIndexedOk(root, index, ["ls-files", "--", literal(path)])) !== ""
        if (!existsSync(join(root, path)) && !tracked) continue
        // --no-index: `git add` refuses a named path its ignore rules match even when files below it are tracked.
        const ignored = (await gitIndexed(root, index, ["check-ignore", "-q", "--no-index", "--", path])).exitCode === 0
        if (!ignored) whole.push(path)
        else if (tracked) {
            trackedOnly.push(path)
            notes.push(`${path} is gitignored: only its tracked files land`)
        } else notes.push(`${path} is gitignored and untracked: skipped, nothing of it lands`)
    }
    return { whole, trackedOnly, notes }
}

/**
 * Commits HEAD plus the work tree's allowPaths (never .starciwork) through a temporary index; the user's index and work tree stay
 * as they are. The `lands` outcome is red when a dirty or untracked file under allowPaths is missing from the candidate, so a
 * task can never settle "done, nothing landed" while its work sits in the tree.
 */
const buildCandidate = async (input: CleanVerifyInput): Promise<Built> => {
    const { root, contract, message } = input
    const parent = await resolveSha(root, "HEAD")
    const index = join(tmpdir(), `starci-index-${randomBytes(6).toString("hex")}`)
    try {
        await gitIndexedOk(root, index, ["read-tree", "HEAD"])
        const plan = await stagePlan(root, index, contract.context.allowPaths)
        if (plan.whole.length > 0) await gitIndexedOk(root, index, ["add", "-A", "--", ...plan.whole.map(literal)])
        if (plan.trackedOnly.length > 0) await gitIndexedOk(root, index, ["add", "-u", "--", ...plan.trackedOnly.map(literal)])
        // An exclude pathspec in `add` fails when .starciwork is gitignored, so the work folder is put back to HEAD's afterwards instead.
        await gitIndexedOk(root, index, ["reset", "-q", "HEAD", "--", literal(WORK_DIR)])
        const tree = await gitIndexedOk(root, index, ["write-tree"])
        const candidate = await git(root, ["commit-tree", tree, "-p", parent, "-m", message])
        const changed = lines(await git(root, ["diff", "--name-only", parent, candidate]))
        const dirty = (await changedFiles(root, "HEAD")).filter((file) => underPaths(file, contract.context.allowPaths) && !underPaths(file, [WORK_DIR]))
        const missing = dirty.filter((file) => !changed.includes(file))
        const lands: CheckOutcome = {
            name: "lands",
            kind: "files",
            status: missing.length === 0 ? "green" : "red",
            exitCode: null,
            detail: [
                missing.length === 0
                    ? changed.length === 0
                        ? "nothing changed under allowPaths; nothing lands"
                        : `${String(changed.length)} file(s) land: ${listed(changed)}`
                    : `changed under allowPaths but not in the candidate, so they would never land: ${listed(missing)}`,
                ...plan.notes,
            ].join("\n"),
        }
        return { facts: { candidate, tree, parent, changed, paths: [...plan.whole, ...plan.trackedOnly], notes: plan.notes }, lands }
    } finally {
        rmSync(index, { force: true })
    }
}

const tail = (stdout: string, stderr: string): string => [stdout, stderr].filter((text) => text !== "").join("\n").split("\n").slice(-DETAIL_LINES).join("\n")

/** `npm ci` where the candidate carries a lockfile (the contract's cwd first, then the root); undefined when there is none. */
const install = async (place: CheckPlace): Promise<CheckOutcome | undefined> => {
    const dir = [place.cwd, place.root].find((candidate) => existsSync(join(candidate, "package-lock.json")))
    if (dir === undefined) return undefined
    const run = await captureNpm(["ci", "--no-audit", "--no-fund"], dir, place.timeoutMs === undefined ? {} : { timeoutMs: place.timeoutMs })
    return { name: "install", kind: "install", status: run.exitCode === 0 ? "green" : "red", exitCode: run.exitCode, detail: tail(run.stdout, run.stderr) }
}

/**
 * Runs one check against the candidate. The paths-only check judges two things: what would land (the candidate against its
 * parent, never against a pinned base that other settled tasks moved past), and what the task may have written outside its
 * allowPaths in the user's work tree, which never lands but must not pass unseen.
 */
const checkCandidate = async (check: ResolvedCheck, input: CleanVerifyInput, place: CheckPlace, built: Built): Promise<CheckOutcome> => {
    const primitive = check.check
    if (primitive.kind !== "files" || primitive.onlyAllowPaths !== true) return runCheck(check, input.contract, place)
    const problems: string[] = []
    const allowPaths = input.contract.context.allowPaths
    const landing = built.facts.changed.filter((file) => !underPaths(file, allowPaths))
    if (landing.length > 0) problems.push(`the candidate changes outside allowPaths: ${listed(landing)}`)
    const stray = await strayFiles(input.root, allowPaths, { ...(input.taskId === undefined ? {} : { taskId: input.taskId }), ...(input.since === undefined ? {} : { since: input.since }) })
    if (stray.written.length > 0) problems.push(`written outside allowPaths in the work tree (dirty or untracked, not leased by another live task): ${listed(stray.written)}`)
    if (primitive.mustExist !== undefined) {
        const rest = await runCheck({ ...check, check: { kind: "files", mustExist: primitive.mustExist } }, input.contract, place)
        if (rest.status === "red") problems.push(rest.detail)
    }
    const notes = stray.older.length > 0 ? [`outside allowPaths but older than the task, not judged: ${listed(stray.older)}`] : []
    return {
        name: check.name,
        kind: "files",
        status: problems.length === 0 ? "green" : "red",
        exitCode: null,
        detail: [...(problems.length === 0 ? ["the candidate touches only allowPaths and nothing else was written"] : problems), ...notes].join("\n"),
    }
}

const removeWorktree = async (root: string, dir: string): Promise<void> => {
    await captureTool("git", ["worktree", "remove", "--force", dir], root)
    rmSync(dir, { recursive: true, force: true })
}

const verifierPid = (dir: string): number | undefined => {
    const pid = /-p(\d+)-[^-]*$/.exec(basename(dir))?.[1]
    return pid === undefined ? undefined : Number(pid)
}

/** Removes this repository's clean-verify checkouts whose verifier is gone (a killed verify leaves its worktree); returns them. */
export const pruneVerifyWorktrees = async (root: string): Promise<string[]> => {
    const listing = await captureTool("git", ["worktree", "list", "--porcelain"], root)
    const dirs = [...listing.stdout.matchAll(/^worktree (.+)$/gm)].map((match) => (match[1] ?? "").trim()).filter((dir) => basename(dir).startsWith(VERIFY_PREFIX))
    const pruned: string[] = []
    for (const dir of dirs) {
        const pid = verifierPid(dir)
        if (pid !== undefined && (pid === process.pid || pidAlive(pid))) continue
        await removeWorktree(root, dir)
        pruned.push(dir)
    }
    await captureTool("git", ["worktree", "prune"], root)
    return pruned
}

/** Verifies a task on a clean checkout of HEAD plus its allowPaths, so a dirty or lucky work tree can never turn a check green. */
export const cleanVerify = async (input: CleanVerifyInput): Promise<CleanVerify> => {
    const { root, contract } = input
    const base = await resolveSha(root, contract.context.base)
    const built = await buildCandidate(input)
    const dir = mkdtempSync(join(tmpdir(), `${VERIFY_PREFIX}${input.name}-p${String(process.pid)}-`))
    try {
        await git(root, ["worktree", "add", "--detach", dir, built.facts.candidate])
        const resolved: Contract = { ...contract, context: { ...contract.context, base } }
        // Scoped starci checks diff the candidate against its parent: in the detached checkout HEAD is the candidate itself.
        const place: CheckPlace = {
            root: dir,
            cwd: join(dir, contract.context.cwd ?? "."),
            diffBase: built.facts.parent,
            ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
            ...(input.result === undefined ? {} : { result: input.result }),
        }
        const checks: CheckOutcome[] = [built.lands]
        const installed = await install(place)
        if (installed !== undefined) checks.push(installed)
        if (installed?.status !== "red") {
            for (const check of input.checks) checks.push(await checkCandidate(check, { ...input, contract: resolved }, place, built))
        }
        const verdict = checks.every((check) => check.status === "green") ? "green" : "red"
        return { ...built.facts, base, checks, verdict }
    } finally {
        await removeWorktree(root, dir)
        await captureTool("git", ["worktree", "prune"], root)
    }
}
