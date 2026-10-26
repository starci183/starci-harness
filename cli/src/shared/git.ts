import { Refusal } from "./errors.js"
import { captureTool, runTool } from "./exec.js"

/** Runs git in `cwd` and returns its trimmed stdout, refusing when git fails. */
export const git = async (cwd: string, args: readonly string[]): Promise<string> => (await runTool("git", args, cwd)).stdout

/** True when the git command exits 0; for yes/no questions such as ancestry. */
export const gitSucceeds = async (cwd: string, args: readonly string[]): Promise<boolean> => (await captureTool("git", args, cwd)).exitCode === 0

/** The top directory of the repository that holds `cwd`. */
export const repositoryRoot = async (cwd: string): Promise<string> => {
    const root = await captureTool("git", ["rev-parse", "--show-toplevel"], cwd)
    if (root.exitCode !== 0) throw new Refusal("GIT_NOT_A_REPOSITORY", `${cwd} is not inside a git repository`)
    return root.stdout
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

/** Files that differ between `base` and the working tree, plus untracked files, repository-relative with forward slashes. */
export const changedFiles = async (cwd: string, base: string): Promise<string[]> => {
    const committed = await git(cwd, ["diff", "--name-only", base])
    const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"])
    const files = [...committed.split("\n"), ...untracked.split("\n")].map((file) => file.trim()).filter((file) => file !== "")
    return [...new Set(files)].sort((left, right) => left.localeCompare(right))
}
