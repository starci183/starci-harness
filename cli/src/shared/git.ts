import { resolve } from "node:path"
import { Refusal } from "./errors.js"
import { captureTool, captureToolSync, runTool } from "./exec.js"
import type { RunOptions, ToolRun } from "./exec.js"

/**
 * The configuration every harness git call runs under, whatever the user's config says: paths are printed as they are, never
 * quoted or octal-escaped (core.quotePath), and Windows paths past 260 characters work (core.longpaths).
 */
const HARNESS_CONFIG = ["-c", "core.quotePath=false", "-c", "core.longpaths=true"] as const

/** The one git runner: runs git under HARNESS_CONFIG and returns its exit code and output instead of throwing on a non-zero exit. */
export const captureGit = (args: readonly string[], cwd: string, options: RunOptions = {}): Promise<ToolRun> => captureTool("git", [...HARNESS_CONFIG, ...args], cwd, options)

/** captureGit for code that cannot await (opening the ledger); never throws. */
export const captureGitSync = (args: readonly string[], cwd: string): ToolRun => captureToolSync("git", [...HARNESS_CONFIG, ...args], cwd)

/** Runs git in `cwd` and returns its trimmed stdout, refusing when git fails. */
export const git = async (cwd: string, args: readonly string[]): Promise<string> => (await runTool("git", [...HARNESS_CONFIG, ...args], cwd)).stdout

/** True when the git command exits 0; for yes/no questions such as ancestry. */
export const gitSucceeds = async (cwd: string, args: readonly string[]): Promise<boolean> => (await captureGit(args, cwd)).exitCode === 0

/** The paths of a `-z` listing (NUL-separated): a path is never quoted, trimmed or split on a newline it carries. */
export const nulPaths = (listing: string): string[] => listing.split("\0").filter((path) => path !== "")

/** The top directory of the repository that holds `cwd`. */
export const repositoryRoot = async (cwd: string): Promise<string> => {
    const root = await captureGit(["rev-parse", "--show-toplevel"], cwd)
    if (root.exitCode !== 0) throw new Refusal("GIT_NOT_A_REPOSITORY", `${cwd} is not inside a git repository`)
    return root.stdout
}

/** The repository's common git dir, absolute: the same for every linked worktree of one repository. */
export const gitCommonDir = async (cwd: string): Promise<string> => git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])

/**
 * The main checkout of the repository a folder belongs to, the one Orca registers as the repository: a linked worktree
 * (a workflow's) is listed under it instead of becoming a project of its own. A bare common dir answers the folder itself.
 */
export const mainCheckout = async (cwd: string): Promise<string> => {
    const common = (await gitCommonDir(cwd)).trim()
    return /[\\/]\.git$/.test(common) ? common.slice(0, -".git".length - 1) : cwd
}

/** True when two paths name the same folder, however they are spelled (slashes; case on Windows). */
export const samePath = (left: string, right: string): boolean => {
    const spell = (path: string): string => {
        let slashed = resolve(path).replaceAll("\\", "/")
        while (slashed.endsWith("/")) slashed = slashed.slice(0, -1)
        return process.platform === "win32" ? slashed.toLowerCase() : slashed
    }
    return spell(left) === spell(right)
}

/** The newest commit reachable from `head` (after `since`, when given) whose message is exactly `message`; undefined when none. */
export const commitWithMessage = async (cwd: string, head: string, message: string, since?: string): Promise<string | undefined> => {
    const range = since === undefined ? head : `${since}..${head}`
    const trailer = /^Starci-Task: .+$/m.exec(message)?.[0]
    const grep = trailer === undefined ? [] : ["--grep=^" + trailer.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + "$"]
    const log = await git(cwd, ["log", "--max-count=200", ...grep, "--format=%H%x1f%B%x1e", range])
    const wanted = message.trim()
    for (const entry of log.split("\x1e")) {
        const [sha = "", body = ""] = entry.split("\x1f")
        if (sha.trim() !== "" && body.trim() === wanted) return sha.trim()
    }
    return undefined
}

/** The full sha of a revision. */
export const resolveSha = async (cwd: string, revision: string): Promise<string> => git(cwd, ["rev-parse", `${revision}^{commit}`])

/** The checked-out branch, or undefined on a detached HEAD. */
export const currentBranch = async (cwd: string): Promise<string | undefined> => {
    const name = await git(cwd, ["branch", "--show-current"])
    return name === "" ? undefined : name
}

/** Tracked changes in the working tree (staged or not); untracked files are ignored. */
export const trackedChanges = async (cwd: string): Promise<string[]> => {
    const names = await git(cwd, ["diff", "--name-only", "HEAD"])
    return names === "" ? [] : names.split("\n")
}

/** True when the ref exists locally (a branch, a remote-tracking branch or a tag). */
export const refExists = async (cwd: string, ref: string): Promise<boolean> => gitSucceeds(cwd, ["rev-parse", "--verify", "--quiet", ref])

/** True when `ancestor` is reachable from `descendant`. */
export const isAncestor = async (cwd: string, ancestor: string, descendant: string): Promise<boolean> =>
    gitSucceeds(cwd, ["merge-base", "--is-ancestor", ancestor, descendant])

/**
 * The base a change check compares against when none is given: the branch base. On `main` or a detached HEAD it is `origin/main`
 * when that exists, else HEAD (the working tree's own changes). On any other branch it is the latest fork point of the branch
 * from `main` or `origin/main`, whichever merge-base is newer, so a lane cut from a local main that runs ahead of origin is
 * judged on its own work, never on main's unpushed commits; HEAD when neither exists.
 */
export const branchBase = async (cwd: string): Promise<string> => {
    const branch = await currentBranch(cwd)
    const remote = (await refExists(cwd, "origin/main")) ? "origin/main" : "HEAD"
    if (branch === undefined || branch === "main") return remote
    const forks: string[] = []
    for (const trunk of ["main", "origin/main"]) {
        if (!(await refExists(cwd, trunk))) continue
        const run = await captureGit(["merge-base", "HEAD", trunk], cwd)
        if (run.exitCode === 0 && run.stdout.trim() !== "") forks.push(run.stdout.trim())
    }
    let newest: string | undefined
    for (const fork of forks) if (newest === undefined || (await isAncestor(cwd, newest, fork))) newest = fork
    return newest ?? "HEAD"
}

/** Files that differ between `base` and the working tree, plus untracked files, repository-relative with forward slashes. */
export const changedFiles = async (cwd: string, base: string): Promise<string[]> => {
    const committed = await git(cwd, ["diff", "--name-only", base])
    const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"])
    const files = [...committed.split("\n"), ...untracked.split("\n")].map((file) => file.trim()).filter((file) => file !== "")
    return [...new Set(files)].sort((left, right) => left.localeCompare(right))
}
