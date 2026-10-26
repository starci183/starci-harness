import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { Refusal } from "../shared/errors.js"
import { captureNpm, captureTool } from "../shared/exec.js"
import { git, resolveSha } from "../shared/git.js"
import type { Contract, ResolvedCheck } from "./contract.js"
import { WORK_DIR } from "./ledger.js"
import { runCheck } from "./run-checks.js"
import type { CheckOutcome, CheckPlace } from "./run-checks.js"

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 64 * 1024 * 1024

const DETAIL_LINES = 30

/** What a clean verify built and what its checks said about it. */
export interface CleanVerify {
    readonly candidate: string
    readonly tree: string
    readonly parent: string
    readonly base: string
    readonly changed: readonly string[]
    readonly paths: readonly string[]
    readonly checks: readonly CheckOutcome[]
    readonly verdict: "green" | "red"
}

/** What the caller hands a clean verify: the task's name for the temp folder and the message the candidate commit carries. */
export interface CleanVerifyInput {
    readonly root: string
    readonly contract: Contract
    readonly checks: readonly ResolvedCheck[]
    readonly name: string
    readonly message: string
}

const stderrOf = (error: unknown): string => {
    if (typeof error !== "object" || error === null || !("stderr" in error)) return ""
    const value: unknown = (error as Record<string, unknown>).stderr
    return typeof value === "string" ? value.trim() : ""
}

// shared/git.ts cannot pass an environment, and the temporary index lives only in GIT_INDEX_FILE of the child.
const gitWithIndex = async (cwd: string, index: string, args: readonly string[]): Promise<string> => {
    try {
        const { stdout } = await execFileAsync("git", [...args], { cwd, env: { ...process.env, GIT_INDEX_FILE: index }, windowsHide: true, maxBuffer: MAX_BUFFER })
        return stdout.trim()
    } catch (error: unknown) {
        const detail = stderrOf(error) || (error instanceof Error ? error.message : String(error))
        throw new Refusal("CLI_TOOL_FAILED", `git ${args.join(" ")} failed: ${detail.split("\n")[0] ?? detail}`)
    }
}

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter((line) => line !== "")

const toSlash = (path: string): string => path.replace(/\\/g, "/").replace(/\/$/, "")

const underAllowPaths = (file: string, allowPaths: readonly string[]): boolean =>
    allowPaths.some((allowed) => {
        const prefix = toSlash(allowed)
        return file === prefix || file.startsWith(`${prefix}/`)
    })

const literal = (path: string): string => `:(top,literal)${path}`

/** The allowPaths that name something, on disk or in HEAD; `git add` refuses a pathspec that matches nothing. */
const presentPaths = async (root: string, index: string, allowPaths: readonly string[]): Promise<string[]> => {
    const present: string[] = []
    for (const path of allowPaths.map(toSlash)) {
        if (path === WORK_DIR || path.startsWith(`${WORK_DIR}/`)) continue
        if (existsSync(join(root, path)) || (await gitWithIndex(root, index, ["ls-files", "--", literal(path)])) !== "") present.push(path)
    }
    return present
}

/** Commits HEAD plus the work tree's allowPaths (never .starciwork) through a temporary index; the user's index and work tree stay as they are. */
const buildCandidate = async (input: CleanVerifyInput): Promise<Omit<CleanVerify, "base" | "checks" | "verdict">> => {
    const { root, contract, message } = input
    const parent = await resolveSha(root, "HEAD")
    const index = join(tmpdir(), `starci-index-${randomBytes(6).toString("hex")}`)
    try {
        await gitWithIndex(root, index, ["read-tree", "HEAD"])
        const paths = await presentPaths(root, index, contract.context.allowPaths)
        if (paths.length > 0) await gitWithIndex(root, index, ["add", "-A", "--", ...paths.map(literal)])
        // An exclude pathspec in `add` fails when .starciwork is gitignored, so the work folder is put back to HEAD's afterwards instead.
        await gitWithIndex(root, index, ["reset", "-q", "HEAD", "--", literal(WORK_DIR)])
        const tree = await gitWithIndex(root, index, ["write-tree"])
        const candidate = await git(root, ["commit-tree", tree, "-p", parent, "-m", message])
        const changed = lines(await git(root, ["diff", "--name-only", parent, candidate]))
        return { candidate, tree, parent, changed, paths }
    } finally {
        rmSync(index, { force: true })
    }
}

const tail = (stdout: string, stderr: string): string => [stdout, stderr].filter((text) => text !== "").join("\n").split("\n").slice(-DETAIL_LINES).join("\n")

/** `npm ci` where the candidate carries a lockfile (the contract's cwd first, then the root); undefined when there is none. */
const install = async (place: CheckPlace): Promise<CheckOutcome | undefined> => {
    const dir = [place.cwd, place.root].find((candidate) => existsSync(join(candidate, "package-lock.json")))
    if (dir === undefined) return undefined
    const run = await captureNpm(["ci", "--no-audit", "--no-fund"], dir)
    return { name: "install", kind: "install", status: run.exitCode === 0 ? "green" : "red", exitCode: run.exitCode, detail: tail(run.stdout, run.stderr) }
}

/**
 * Runs one check against the candidate. run-checks' onlyAllowPaths diffs the work tree it runs in, where installs and test
 * output leave files; here it diffs the candidate commit against the base instead, so only what would land is judged.
 */
const checkCandidate = async (check: ResolvedCheck, contract: Contract, place: CheckPlace, built: { readonly base: string; readonly candidate: string }): Promise<CheckOutcome> => {
    const primitive = check.check
    if (primitive.kind !== "files" || primitive.onlyAllowPaths !== true) return runCheck(check, contract, place)
    const problems: string[] = []
    const outside = lines(await git(place.root, ["diff", "--name-only", built.base, built.candidate])).filter((file) => !underAllowPaths(file, contract.context.allowPaths))
    if (outside.length > 0) problems.push(`changed outside allowPaths: ${outside.slice(0, 20).join(", ")}`)
    if (primitive.mustExist !== undefined) {
        const rest = await runCheck({ ...check, check: { kind: "files", mustExist: primitive.mustExist } }, contract, place)
        if (rest.status === "red") problems.push(rest.detail)
    }
    return { name: check.name, kind: "files", status: problems.length === 0 ? "green" : "red", exitCode: null, detail: problems.length === 0 ? "candidate touches only allowPaths" : problems.join("\n") }
}

const removeWorktree = async (root: string, dir: string): Promise<void> => {
    await captureTool("git", ["worktree", "remove", "--force", dir], root)
    await captureTool("git", ["worktree", "prune"], root)
    rmSync(dir, { recursive: true, force: true })
}

/** Verifies a task on a clean checkout of HEAD plus its allowPaths, so a dirty or lucky work tree can never turn a check green. */
export const cleanVerify = async (input: CleanVerifyInput): Promise<CleanVerify> => {
    const { root, contract } = input
    const base = await resolveSha(root, contract.context.base)
    const built = await buildCandidate(input)
    const dir = mkdtempSync(join(tmpdir(), `starci-verify-${input.name}-`))
    try {
        await git(root, ["worktree", "add", "--detach", dir, built.candidate])
        const resolved: Contract = { ...contract, context: { ...contract.context, base } }
        const place: CheckPlace = { root: dir, cwd: join(dir, contract.context.cwd ?? ".") }
        const checks: CheckOutcome[] = []
        const installed = await install(place)
        if (installed !== undefined) checks.push(installed)
        if (installed?.status !== "red") {
            for (const check of input.checks) checks.push(await checkCandidate(check, resolved, place, { base, candidate: built.candidate }))
        }
        const verdict = checks.every((check) => check.status === "green") ? "green" : "red"
        return { ...built, base, checks, verdict }
    } finally {
        await removeWorktree(root, dir)
    }
}
