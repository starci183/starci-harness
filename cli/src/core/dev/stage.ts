import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureGit } from "../../shared/git.js"

/**
 * The build-first half of `dev sync` the new tree is installed and built in a staging worktree of the dev checkout while the running
 * api and web keep serving the old one, and only then swapped in, so the downtime of a sync is the swap and the restart. The staging worktree is
 * `<parent>/.<checkout>.starci-next`, a detached worktree of the checkout's own repository at the commit the sync moves to; the swap moves every path the
 * staging install and build produced (git's ignored entries of the staging tree: each `node_modules`, each `dist`, generated files) into the checkout by
 * rename on the same volume, re-points the workspace links npm made (on Windows absolute junctions into the staging tree) at the checkout, copies the
 * tracked files the install changed (the pins of a local overlay) and removes what it replaced. A move that fails puts back every move made before it.
 */

/** The suffix a replaced entry of the checkout carries until it is removed. */
export const OLD = ".starci-old"

/** The staging worktree of a dev checkout. */
export const stagingPath = (root: string): string => join(dirname(resolve(root)), `.${basename(resolve(root))}.starci-next`)

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
    const run = await captureGit(args, cwd)
    if (run.exitCode !== 0) throw new Refusal("DEV_SYNC_STAGE", `git ${args.join(" ")} in ${cwd}: ${run.stderr.trim()}`)
    return run.stdout
}

/** Makes (or resets) the staging worktree of `root` at `to`, empty of every ignored and untracked file a previous sync left. */
export const stageTree = async (root: string, to: string): Promise<string> => {
    const staging = stagingPath(root)
    const listed = await git(root, ["worktree", "list", "--porcelain"])
    const known = listed.split("\n").some((line) => line.startsWith("worktree ") && resolve(line.slice("worktree ".length)).toLowerCase() === staging.toLowerCase())
    if (!known) {
        if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
        await git(root, ["worktree", "prune"])
        await git(root, ["worktree", "add", "--detach", "--force", staging, to])
        return staging
    }
    await git(staging, ["checkout", "--quiet", "--detach", "--force", to])
    await git(staging, ["clean", "-fdxq"])
    return staging
}

/** The entries a staged build produced: git's ignored entries of the staging tree (folders whole), relative, with forward slashes. */
export const stagedOutputs = async (staging: string): Promise<string[]> =>
    outermost((await git(staging, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"])).split("\0").map((entry) => entry.replace(/\/$/u, "")).filter((entry) => entry !== ""))

/**
 * Drops every entry that lies inside another one of the list. Git lists a folder whose own .gitignore ignores its contents (husky's generated
 * `.husky/_` holds a `.gitignore` with `*`) both whole and file by file; the files go with the folder when it moves, so moving them on their own
 * fails with ENOENT. Pure.
 */
export const outermost = (entries: readonly string[]): string[] => {
    const all = new Set(entries)
    return entries.filter((entry) => {
        for (let at = entry.lastIndexOf("/"); at > 0; at = entry.lastIndexOf("/", at - 1)) if (all.has(entry.slice(0, at))) return false
        return true
    })
}

/** The tracked files the staged install changed (a local overlay's pins and lockfiles). */
export const stagedTrackedChanges = async (staging: string): Promise<string[]> => (await git(staging, ["diff", "--name-only", "HEAD"])).split("\n").filter((file) => file !== "")

/** The filesystem seam of the swap, real by default and replaced by the specs. */
export interface SwapFs {
    readonly rename: (from: string, to: string) => void
    readonly remove: (path: string) => void
    readonly exists: (path: string) => boolean
    readonly copy: (from: string, to: string) => void
}

export const realSwapFs: SwapFs = {
    rename: renameSync,
    remove: (path) => {
        rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    },
    exists: existsSync,
    copy: (from, to) => {
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(from, to)
    },
}

/** The codes of a rename or removal Windows refuses while something (a process, an antivirus scan of a large file) briefly holds a file. */
const BUSY = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"])

const codeOf = (error: unknown): string => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : "")

/** A rename retried while Windows says busy (an antivirus holds a large file for a moment): `tries` attempts, `pause` between them. */
const renameRetried = async (fs: SwapFs, from: string, to: string, pause: (ms: number) => Promise<void>, tries = 5): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            fs.rename(from, to)
            return
        } catch (error) {
            if (attempt >= tries || !BUSY.has(codeOf(error))) throw error
            await pause(1000 * attempt)
        }
    }
}

/**
 * Re-points every link of a moved `node_modules` (each entry, and each entry of an `@scope` folder) that targets the staging tree at the same path inside
 * the checkout; the links it re-pointed. npm links each workspace package from the root `node_modules`, on Windows as a junction with an absolute target.
 */
export const relinkInto = (modules: string, staging: string, root: string): string[] => {
    const relinked: string[] = []
    const prefix = resolve(staging).toLowerCase() + sep
    const visit = (dir: string, depth: number): void => {
        let names: string[]
        try {
            names = readdirSync(dir)
        } catch {
            return
        }
        for (const name of names) {
            const path = join(dir, name)
            let stat
            try {
                stat = lstatSync(path)
            } catch {
                continue
            }
            if (stat.isSymbolicLink()) {
                let target: string
                try {
                    target = resolve(dir, readlinkSync(path))
                } catch {
                    continue
                }
                if (!(target.toLowerCase() + sep).startsWith(prefix)) continue
                const moved = join(root, relative(staging, target))
                unlinkSync(path)
                symlinkSync(moved, path, process.platform === "win32" ? "junction" : "dir")
                relinked.push(path)
            } else if (stat.isDirectory() && depth === 0 && name.startsWith("@")) visit(path, 1)
        }
    }
    visit(modules, 0)
    return relinked
}

/** What a swap did. */
export interface Swapped {
    readonly moved: readonly string[]
    readonly copied: readonly string[]
    readonly relinked: number
    /** Replaced entries that could not be removed (a held file): left as `<entry>.starci-old`, removed by the next sync. */
    readonly leftover: readonly string[]
}

/**
 * Moves the staged outputs into the checkout and copies the tracked files the staged install changed. Each replaced entry is renamed aside first and
 * removed once every move succeeded; a move that fails moves back everything moved before it, puts the replaced entries back and refuses DEV_SYNC_SWAP.
 */
export const swapStaged = async (staging: string, root: string, listed: readonly string[], tracked: readonly string[], fs: SwapFs = realSwapFs, pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<Swapped> => {
    // A path inside another listed path moves with it.
    const outputs = outermost(listed)
    // An earlier swap's leftovers go first, so a name is free for this one.
    for (const entry of outputs) if (fs.exists(join(root, `${entry}${OLD}`))) fs.remove(join(root, `${entry}${OLD}`))
    const done: { readonly entry: string; readonly replaced: boolean }[] = []
    try {
        for (const entry of outputs) {
            const into = join(root, entry)
            const replaced = fs.exists(into)
            if (replaced) await renameRetried(fs, into, `${into}${OLD}`, pause)
            try {
                mkdirSync(dirname(into), { recursive: true })
                await renameRetried(fs, join(staging, entry), into, pause)
            } catch (error) {
                if (replaced) fs.rename(`${into}${OLD}`, into)
                throw error
            }
            done.push({ entry, replaced })
        }
    } catch (error) {
        for (const { entry, replaced } of done.toReversed()) {
            fs.rename(join(root, entry), join(staging, entry))
            if (replaced) fs.rename(join(root, `${entry}${OLD}`), join(root, entry))
        }
        throw new Refusal("DEV_SYNC_SWAP", `the staged build could not be moved into ${root} (${error instanceof Error ? error.message : String(error)}): every move was put back, the checkout runs its previous install; stop what holds the file and sync again`)
    }
    for (const file of tracked) fs.copy(join(staging, file), join(root, file))
    let relinked = 0
    for (const entry of outputs.filter((one) => basename(one) === "node_modules")) relinked += relinkInto(join(root, entry), staging, root).length
    const leftover: string[] = []
    for (const { entry } of done.filter((one) => one.replaced)) {
        try {
            fs.remove(join(root, `${entry}${OLD}`))
        } catch {
            leftover.push(`${entry}${OLD}`)
        }
    }
    return { moved: done.map((one) => one.entry), copied: tracked, relinked, leftover }
}
