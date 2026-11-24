import { existsSync, lstatSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { captureNpm, captureTool } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { withHeavySlot } from "../../harness/heavy.js"

/**
 * The after-push step of a HARNESS hotfix (contexts/authority/lanes.md "Hotfix"): nothing of the harness is a dev server, so what the machine runs is a built copy of
 * the CLI, `<lanes>/_cli-<sha9>` (a detached worktree of the pushed commit with `npm ci` and `npm run build` in its cli/), and `<lanes>/_cli-current` is the junction
 * every lane command of the machine runs through. After the push the new copy is built and the junction is repointed to it, so the next command runs the hotfix.
 * It never throws: a build that fails leaves `_cli-current` where it was and says so.
 */
export interface CliCopy {
    readonly state: "built" | "skipped" | "failed"
    readonly note: string
    /** The copy the junction points to now. */
    readonly path?: string
}

/** The trees the built CLI reads or embeds: its sources, its ops, its policy, the contexts its search index is built from and the skills it ships. */
const CLI_INPUTS = /^(?:cli|ops|policy|contexts|skills)\//u

/** Whether a hotfix of `files` changes what the built CLI is. Pure. */
export const cliCopyNeeded = (files: readonly string[]): boolean => files.some((file) => CLI_INPUTS.test(file.replaceAll("\\", "/")))

/** The folder name of the copy of a commit, as the harness names the CLI builds it makes. Pure. */
export const cliCopyName = (sha: string): string => `_cli-${sha.slice(0, 9)}`

/** The junction the machine runs the CLI through. Pure. */
export const cliCurrent = (dir: string): string => join(dir, "_cli-current")

/** Removes a link itself, never what it points to: a junction goes with `rmdir`, a symbolic link with `unlink`. */
const dropLink = (path: string): void => {
    try {
        rmdirSync(path)
    } catch {
        unlinkSync(path)
    }
}

/**
 * Points the junction `current` at `target`: the new junction is made beside it and renamed into place (one rename where the host allows it over an existing link),
 * else the old link is moved aside first and put back when the second rename fails. Only links are ever removed.
 */
export const repoint = (current: string, target: string): void => {
    const next = `${current}.next-${String(process.pid)}`
    if (lstatSync(next, { throwIfNoEntry: false }) !== undefined) dropLink(next)
    symlinkSync(resolve(target), next, "junction")
    try {
        renameSync(next, current)
        return
    } catch (error) {
        if (lstatSync(current, { throwIfNoEntry: false }) === undefined) {
            dropLink(next)
            throw error
        }
    }
    const aside = `${current}.old-${String(process.pid)}`
    renameSync(current, aside)
    try {
        renameSync(next, current)
    } catch (error) {
        renameSync(aside, current)
        dropLink(next)
        throw error
    }
    dropLink(aside)
}

/** Where a junction points, or undefined when it is none. */
export const linkTarget = (path: string): string | undefined => {
    try {
        return readlinkSync(path)
    } catch {
        return undefined
    }
}

/** The seams of the rebuild, real by default; the specs hand in their own. */
export interface CliCopyPorts {
    readonly git: (cwd: string, args: readonly string[]) => Promise<ToolRun>
    readonly npm: (args: readonly string[], cwd: string, label: string, kind: "install" | "build") => Promise<ToolRun>
    readonly built: (copy: string) => boolean
    readonly exists: (path: string) => boolean
    readonly repoint: (current: string, target: string) => void
}

export const realCliCopyPorts: CliCopyPorts = {
    git: (cwd, args) => captureTool("git", [...args], cwd),
    npm: (args, cwd, label, kind) => withHeavySlot(kind, label, cwd, {}, (held) => captureNpm(args, cwd, held.options)),
    built: (copy) => existsSync(join(copy, "cli", "dist", "main.js")),
    exists: existsSync,
    repoint,
}

const tail = (run: ToolRun): string => `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-4).join(" ").slice(0, 400)

/**
 * Builds the CLI copy of `sha` (a worktree of `root` under the lanes folder `dir`: `git worktree add --detach`, then `npm ci` and `npm run build` in its cli/) unless
 * a built one is there, and repoints `_cli-current` to it. `files` are the hotfix's files: a hotfix that touches none of what the CLI is built from skips it.
 */
export const rebuildCliCopy = async (given: { readonly root: string; readonly dir: string; readonly sha: string; readonly files: readonly string[]; readonly say: (line: string) => void }, ports: CliCopyPorts = realCliCopyPorts): Promise<CliCopy> => {
    const { root, dir, sha, say } = given
    if (!cliCopyNeeded(given.files)) return { state: "skipped", note: "the hotfix changes nothing the CLI is built from (cli/, ops/, policy/, contexts/, skills/)" }
    const copy = join(dir, cliCopyName(sha))
    try {
        if (!ports.built(copy)) {
            if (!ports.exists(copy)) {
                say(`CLI copy: git worktree add --detach ${copy} ${sha.slice(0, 10)}`)
                const added = await ports.git(root, ["worktree", "add", "--detach", copy, sha])
                if (added.exitCode !== 0) return { state: "failed", note: `git worktree add ${copy}: ${tail(added)}; _cli-current is unchanged` }
            }
            say(`CLI copy: npm ci and npm run build in ${join(copy, "cli")}`)
            const install = await ports.npm(["ci", "--no-audit", "--no-fund"], join(copy, "cli"), `hotfix ${cliCopyName(sha)}: npm ci`, "install")
            if (install.exitCode !== 0) return { state: "failed", note: `npm ci exited ${String(install.exitCode)} in ${join(copy, "cli")}: ${tail(install)}; _cli-current is unchanged` }
            const build = await ports.npm(["run", "build"], join(copy, "cli"), `hotfix ${cliCopyName(sha)}: build`, "build")
            if (build.exitCode !== 0) return { state: "failed", note: `npm run build exited ${String(build.exitCode)} in ${join(copy, "cli")}: ${tail(build)}; _cli-current is unchanged` }
        }
        ports.repoint(cliCurrent(dir), copy)
        return { state: "built", note: `${cliCurrent(dir)} now points to ${copy}`, path: copy }
    } catch (error) {
        return { state: "failed", note: `${error instanceof Error ? error.message : String(error)}; _cli-current is unchanged or put back` }
    }
}
