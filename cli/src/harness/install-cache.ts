import { createHash, randomBytes } from "node:crypto"
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { readRecord, reapplyLocal } from "../core/deps/packages.js"
import { captureNpm, npmVersion, pidAlive } from "../shared/exec.js"
import type { RunOptions, ToolRun } from "../shared/exec.js"
import { evidenceTail } from "../shared/output.js"
import { withHeavySlot } from "./heavy.js"
import { installCachePath } from "./ledger.js"

/** What one install of a checkout did: npm's run on a miss (null on a hit), and the line saying where node_modules came from. */
export interface CachedInstall {
    readonly run: ToolRun | null
    readonly key: string
    readonly reused: boolean
    readonly note: string
}

/** The marker a linked install leaves in its node_modules, so a leftover checkout's links are found and unlinked before it is removed. */
const LINKED_MARKER = ".starci-linked"

/** The cache entry's record of the links npm made to the checkout's own folders (workspace members), re-made in each checkout. */
const LINKS_FILE = "links.json"

/** Entries of node_modules never shared: a tool's own cache is written per checkout. */
const UNSHARED = new Set([".cache", LINKED_MARKER])

interface OwnLink {
    readonly path: string
    readonly target: string
}

const toSlash = (path: string): string => path.split(sep).join("/")

/** The names of the files an npm install reads in a folder: only a change to one of them can change what the install holds. */
export const INSTALL_INPUTS: readonly string[] = ["package-lock.json", "npm-shrinkwrap.json", "package.json", ".npmrc"]

interface Locked {
    readonly version?: unknown
    readonly link?: unknown
    readonly optional?: unknown
}

/** A lockfile's `packages` map, or an empty one when the file is missing or unreadable. */
const lockedPackages = (file: string): Readonly<Record<string, Locked | undefined>> => {
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { readonly packages?: unknown }
        return typeof parsed.packages === "object" && parsed.packages !== null ? (parsed.packages as Readonly<Record<string, Locked>>) : {}
    } catch {
        return {}
    }
}

/** The lockfile of an install folder: npm-shrinkwrap.json wins over package-lock.json, as npm reads them. */
const lockfileOf = (dir: string): string => (existsSync(join(dir, "npm-shrinkwrap.json")) ? join(dir, "npm-shrinkwrap.json") : join(dir, "package-lock.json"))

/**
 * The install inputs of a lockfile folder, relative to it and sorted: its own INSTALL_INPUTS, and those of each workspace member
 * its lockfile names (a `packages` key outside node_modules), so a member's manifest or lockfile changing changes the key too.
 */
export const installInputs = (dir: string): string[] => {
    const members = Object.keys(lockedPackages(lockfileOf(dir))).filter((key) => key !== "" && !key.split("/").includes("node_modules"))
    return ["", ...members]
        .flatMap((member) => INSTALL_INPUTS.map((name) => (member === "" ? name : `${member}/${name}`)))
        .filter((path) => existsSync(join(dir, path)))
        .sort((left, right) => left.localeCompare(right))
}

/**
 * The key of the install of a lockfile folder: the path and bytes of every install input (`installInputs`: the folder's lockfile,
 * manifest and .npmrc, and each workspace member's), Node's version and npm's. A candidate whose lockfile or any manifest differs
 * from the one a cache entry was made from therefore never gets that entry: it runs `npm ci` and is cached under its own key.
 */
export const installKey = (dir: string): string => {
    const hash = createHash("sha256")
    for (const path of installInputs(dir)) hash.update(`${path}\0`).update(readFileSync(join(dir, path))).update("\0")
    return hash.update(`\0${process.version}\0${npmVersion() ?? "no-npm"}`).digest("hex").slice(0, 24)
}

/**
 * Whether the install a folder holds (its node_modules, or the folder it links to) satisfies its lockfile: every package the
 * lockfile places under node_modules is in npm's record of that install (node_modules/.package-lock.json, which npm ci writes and
 * the cache carries) at the locked version and link, an optional one (a platform build npm may skip) aside. Undefined when it
 * cannot be told: no node_modules, no lockfile, or no record.
 */
export const installSatisfies = (dir: string): boolean | undefined => {
    const record = join(dir, "node_modules", ".package-lock.json")
    const lockfile = lockfileOf(dir)
    if (!existsSync(lockfile) || !existsSync(record)) return undefined
    const installed = lockedPackages(record)
    return Object.entries(lockedPackages(lockfile)).every(([key, locked]) => {
        if (locked === undefined || !key.split("/").includes("node_modules") || locked.optional === true) return true
        const found = installed[key]
        return found !== undefined && found.version === locked.version && found.link === locked.link
    })
}

/** The entries of a node_modules folder one level down, a `@scope` folder opened to its members, as paths relative to it. */
const entriesOf = (modules: string): string[] =>
    readdirSync(modules)
        .filter((name) => !UNSHARED.has(name))
        .flatMap((name) => {
            const path = join(modules, name)
            if (!name.startsWith("@") || lstatSync(path).isSymbolicLink()) return [name]
            return readdirSync(path).map((member) => `${name}/${member}`)
        })

/**
 * Copies a fresh install's node_modules into the cache under its key: every entry but the links npm made to the checkout's own
 * folders, which are recorded relative to the install folder and re-made per checkout. Written to a staging folder and renamed into
 * place, so a reader sees a whole entry or none; when another verify landed the same key first, the staging copy is dropped.
 */
const populate = (dir: string, entry: string): void => {
    const staging = `${entry}.tmp-${String(process.pid)}-${randomBytes(4).toString("hex")}`
    const modules = join(dir, "node_modules")
    const links: OwnLink[] = []
    mkdirSync(join(staging, "node_modules"), { recursive: true })
    for (const name of entriesOf(modules)) {
        const from = join(modules, name)
        if (lstatSync(from).isSymbolicLink()) {
            links.push({ path: name, target: toSlash(relative(dir, resolve(dirname(from), readlinkSync(from)))) })
            continue
        }
        cpSync(from, join(staging, "node_modules", name), { recursive: true, verbatimSymlinks: true })
    }
    writeFileSync(join(staging, LINKS_FILE), `${JSON.stringify(links, null, 2)}\n`)
    try {
        renameSync(staging, entry)
    } catch {
        // Another verify cached the same key first; this copy holds no link of ours, so it is removed as plain files.
        rmSync(staging, { recursive: true, force: true })
    }
}

/** A directory link: a junction on Windows (no privilege needed), a symlink elsewhere. */
const linkDir = (target: string, path: string): void => {
    mkdirSync(dirname(path), { recursive: true })
    symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir")
}

/**
 * Builds the checkout's node_modules from a cache entry. Linked: a real node_modules folder whose every package (or scope member)
 * is a link into the cache, the links npm made to the checkout's own folders re-made to this checkout, and the marker. Copied
 * (`materialize`, for a repository in local package mode, whose copies are written over installed packages): the whole tree.
 */
const fromCache = (dir: string, entry: string, materialize: boolean): void => {
    const modules = join(dir, "node_modules")
    const cached = join(entry, "node_modules")
    if (materialize) cpSync(cached, modules, { recursive: true, verbatimSymlinks: true })
    else {
        mkdirSync(modules, { recursive: true })
        writeFileSync(join(modules, LINKED_MARKER), `${entry}\n`)
        for (const name of entriesOf(cached)) {
            const from = join(cached, name)
            if (lstatSync(from).isDirectory()) linkDir(from, join(modules, name))
            else cpSync(from, join(modules, name), { verbatimSymlinks: true })
        }
    }
    const links = JSON.parse(readFileSync(join(entry, LINKS_FILE), "utf8")) as OwnLink[]
    for (const link of links) linkDir(resolve(dir, link.target), join(modules, link.path))
}

/**
 * The install of a clean checkout's lockfile folder `dir`, shared through the cache keyed by installKey: a hit links (or copies)
 * the cached node_modules into the checkout without running npm; a miss runs `npm ci` under a heavy-command slot and caches its
 * result for the next checkout. A cache entry that cannot be read falls back to `npm ci`.
 */
export const cachedInstall = async (dir: string, options: RunOptions, materialize: boolean): Promise<CachedInstall> => {
    const key = installKey(dir)
    const entry = installCachePath(key)
    // A checkout that already holds a node_modules (a tracked one) can take nothing from the cache: npm ci runs over it.
    if (existsSync(join(dir, "node_modules"))) return freshInstall(dir, entry, key, options)
    return singleFill(dir, entry, key, options, materialize, Date.now() + FILL_WAIT_MS, false)
}

/** How long a checkout waits for another process's `npm ci` of the same key before it runs its own. */
const FILL_WAIT_MS = 15 * 60_000

const FILL_POLL_MS = 2_000

/** How old a fill lock may grow before its holder counts as gone even when its pid runs (Windows reuses pids). */
const FILL_STALE_MS = 30 * 60_000

/** The fill lock of a cache entry: a file the one process running `npm ci` for that key creates exclusively and removes after. */
const fillLockOf = (entry: string): string => `${entry}.filling`

/** Whether a fill lock's holder still fills: its pid runs and the lock is younger than FILL_STALE_MS; a lock still being written counts as live. */
const fillHolderAlive = (lock: string): boolean => {
    const stat = lstatSync(lock, { throwIfNoEntry: false })
    if (stat === undefined) return false
    if (Date.now() - stat.mtimeMs > FILL_STALE_MS) return false
    try {
        const holder = JSON.parse(readFileSync(lock, "utf8")) as { readonly pid?: unknown }
        return typeof holder.pid === "number" && pidAlive(holder.pid)
    } catch {
        return true
    }
}

/** Creates the fill lock exclusively; a lock whose holder is gone is removed and taken once more. True when this process holds it. */
const takeFill = (lock: string): boolean => {
    mkdirSync(dirname(lock), { recursive: true })
    const create = (): boolean => {
        try {
            writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" })
            return true
        } catch {
            return false
        }
    }
    if (create()) return true
    if (fillHolderAlive(lock)) return false
    rmSync(lock, { force: true })
    return create()
}

/**
 * One `npm ci` per key at a time across every process of the host: a hit is linked at once; on a miss the process that takes the
 * key's fill lock runs `npm ci` and caches it, and every other one waits for that entry and links it, so concurrent checkouts of
 * one lockfile never install side by side. A waiter whose filler died takes the lock over; one that waited FILL_WAIT_MS runs its own.
 */
const singleFill = async (dir: string, entry: string, key: string, options: RunOptions, materialize: boolean, deadline: number, waited: boolean): Promise<CachedInstall> => {
    if (existsSync(join(entry, LINKS_FILE))) return fromEntry(dir, entry, key, options, materialize, waited)
    const lock = fillLockOf(entry)
    if (takeFill(lock)) {
        try {
            // Filled between the look above and the lock: linked, not installed again.
            if (existsSync(join(entry, LINKS_FILE))) return await fromEntry(dir, entry, key, options, materialize, waited)
            return await freshInstall(dir, entry, key, options)
        } finally {
            rmSync(lock, { force: true })
        }
    }
    if (Date.now() >= deadline) {
        const run = await freshInstall(dir, entry, key, options)
        return { ...run, note: `another process held the install of ${key} past ${String(FILL_WAIT_MS / 60_000)} minutes; ${run.note}` }
    }
    await sleep(FILL_POLL_MS)
    return singleFill(dir, entry, key, options, materialize, deadline, true)
}

/** Links (or copies) a cache entry into the checkout; an entry that cannot be used falls back to `npm ci`. */
const fromEntry = async (dir: string, entry: string, key: string, options: RunOptions, materialize: boolean, waited: boolean): Promise<CachedInstall> => {
    try {
        fromCache(dir, entry, materialize)
        const after = waited ? ", after waiting for another process's install of it" : ""
        return { run: null, key, reused: true, note: `node_modules ${materialize ? "copied" : "linked"} from the install cache ${key}${after} (no npm ci)` }
    } catch (error: unknown) {
        unlinkInstallLinks(dir)
        rmSync(join(dir, "node_modules"), { recursive: true, force: true })
        const why = error instanceof Error ? error.message : String(error)
        return { ...(await freshInstall(dir, entry, key, options)), note: `the install cache ${key} could not be used (${why}); npm ci ran` }
    }
}

const freshInstall = async (dir: string, entry: string, key: string, options: RunOptions): Promise<CachedInstall> => {
    const run = await withHeavySlot("install", "npm ci", dir, options, (held) => captureNpm(["ci", "--no-audit", "--no-fund"], dir, held.options))
    if (run.exitCode !== 0 || existsSync(entry)) return { run, key, reused: false, note: `npm ci ran (install cache ${key})` }
    try {
        populate(dir, entry)
        return { run, key, reused: false, note: `npm ci ran; its node_modules is cached as ${key}` }
    } catch (error: unknown) {
        return { run, key, reused: false, note: `npm ci ran; caching it as ${key} failed: ${error instanceof Error ? error.message : String(error)}` }
    }
}

/** Whether a folder holds an install already made in it: npm's own record of it, or the marker of one linked from the cache. */
export const isInstalled = (dir: string): boolean => existsSync(join(dir, "node_modules", ".package-lock.json")) || existsSync(join(dir, "node_modules", LINKED_MARKER))

/** What giving one lockfile folder its install did: green or red, npm's exit (0 when npm did not run), and where node_modules and its local copies came from. */
export interface CheckoutInstall {
    readonly status: "green" | "red"
    readonly exitCode: number
    readonly detail: string
}

/**
 * Gives a lockfile folder `dir` of a checkout the install every judged or served copy of the app runs against, a wave's clean
 * checkout and a walk's checkout alike: an install the folder does not hold yet comes from the cache (cachedInstall; copied, not
 * linked, when the repository of `source` is in local package mode, `starci deps source --local`), and in local package mode the
 * repository's local copies are applied over whichever install the folder holds (reapplyLocal), so the checkout runs the `@starci`
 * packages its work tree runs, never the registry pins. Undefined when the folder holds an install and the repository is in npm
 * mode: there is nothing to give it.
 */
export const installCheckout = async (dir: string, source: string, options: RunOptions): Promise<CheckoutInstall | undefined> => {
    const local = (readRecord(source)?.packages.length ?? 0) > 0
    let installed: CheckoutInstall | undefined
    if (!isInstalled(dir)) {
        const cached = await cachedInstall(dir, options, local)
        const exitCode = cached.run?.exitCode ?? 0
        const tail = cached.run === null ? "" : `\n${evidenceTail(cached.run.stdout, cached.run.stderr)}`
        installed = { status: exitCode === 0 ? "green" : "red", exitCode, detail: `${cached.note}${tail}` }
        if (installed.status === "red") return installed
    }
    if (!local) return installed
    const reapplied = await reapplyLocal(source, dir)
    if (reapplied === undefined) return installed
    const lines = [installed?.detail ?? "node_modules already installed", "local package sources (starci deps source):", reapplied.detail]
    return { status: reapplied.status, exitCode: installed?.exitCode ?? 0, detail: lines.join("\n") }
}

/**
 * Links the cached install of a lockfile folder `dir` into it when the install cache holds its key (a real node_modules whose
 * every package is a link into the cache, as a clean checkout gets it), without running npm; false on a miss, or when `dir`
 * has no lockfile or already holds a node_modules.
 */
export const linkCachedInstall = (dir: string): boolean => {
    if (!existsSync(lockfileOf(dir)) || existsSync(join(dir, "node_modules"))) return false
    const entry = installCachePath(installKey(dir))
    if (!existsSync(join(entry, LINKS_FILE))) return false
    try {
        fromCache(dir, entry, false)
        return true
    } catch {
        unlinkInstallLinks(dir)
        rmSync(join(dir, "node_modules"), { recursive: true, force: true })
        return false
    }
}

const MODULES_DEPTH = 4

/** The node_modules folders of a checkout, relative to it, down to a few levels (a linked one included), never inside one another or inside .git. */
export const modulesFolders = (root: string, at = root, depth = MODULES_DEPTH): string[] => {
    if (depth < 0 || !existsSync(at)) return []
    const found: string[] = []
    for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (entry.name === ".git") continue
        const path = join(at, entry.name)
        if (entry.name === "node_modules" && (entry.isDirectory() || entry.isSymbolicLink())) found.push(toSlash(relative(root, path)))
        else if (entry.isDirectory()) found.push(...modulesFolders(root, path, depth - 1))
    }
    return found
}

/** The folders of a checkout holding a lockfile, relative to it ("." for the root), down to a few levels, never inside node_modules or .git. */
export const lockfileFolders = (root: string, at = root, depth = MODULES_DEPTH): string[] => {
    if (depth < 0 || !existsSync(at)) return []
    const found = existsSync(join(at, "package-lock.json")) ? [toSlash(relative(root, at)) || "."] : []
    for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") found.push(...lockfileFolders(root, join(at, entry.name), depth - 1))
    }
    return found
}

/**
 * Removes a link with a plain unlink (a junction that refuses one goes with a non-recursive rmdir), never a recursive delete
 * through it, so nothing removed afterwards can reach the folder the link names.
 */
const unlinkFolder = (path: string): void => {
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() !== true) return
    try {
        unlinkSync(path)
    } catch {
        rmdirSync(path)
    }
}

/**
 * Removes every install link of a checkout, link only: a node_modules folder that is itself a link (an Op worktree linked to its
 * target's install), and every link a real node_modules holds at its package level (the cache links, and the links npm made to
 * the checkout's own folders), for each node_modules found and each folder in `links` (relative to the checkout). Removing the
 * checkout afterwards therefore cannot reach the cache, a target's install or any folder a link names.
 */
export const unlinkInstallLinks = (checkout: string, links: readonly string[] = []): void => {
    for (const folder of new Set([...links, ...modulesFolders(checkout)])) {
        const modules = join(checkout, folder)
        const stat = lstatSync(modules, { throwIfNoEntry: false })
        if (stat === undefined) continue
        if (stat.isSymbolicLink()) unlinkFolder(modules)
        else if (stat.isDirectory()) for (const name of entriesOf(modules)) unlinkFolder(join(modules, name))
    }
}

/** One install folder reinstallStale made anew: the lockfile folder (relative to the checkout) and what its install did. */
export interface Reinstalled extends CachedInstall {
    readonly folder: string
}

/**
 * Makes every install of a long-lived checkout (an Op worktree) match its own lockfile again: a lockfile folder whose node_modules
 * does not satisfy its lockfile (`installSatisfies`: the task changed the lockfile after the checkout was given the install of the
 * branch it was cut from, that install was already behind, or npm left no record of it), or that lacks a node_modules the
 * checkout was given (`expected`, folders relative to it: an earlier reinstall stopped half-way), has that node_modules removed
 * (link only when it is a link to the target's install; a real one has its package links unlinked first) and is installed anew
 * through `cachedInstall` under the key of its own inputs: from the cache when that key is cached, else by `npm ci` under a
 * heavy-command slot, one fill per key. The caller reapplies local package sources afterwards.
 */
export const reinstallStale = async (checkout: string, expected: readonly string[], options: RunOptions, materialize: boolean): Promise<Reinstalled[]> => {
    const owed = new Set(expected)
    const stale = lockfileFolders(checkout).filter((folder) => {
        const modules = folder === "." ? "node_modules" : `${folder}/node_modules`
        if (lstatSync(join(checkout, modules), { throwIfNoEntry: false }) === undefined) return owed.has(modules)
        return installSatisfies(join(checkout, folder)) !== true
    })
    const done: Reinstalled[] = []
    for (const folder of stale) {
        const dir = join(checkout, folder)
        const modules = join(dir, "node_modules")
        const stat = lstatSync(modules, { throwIfNoEntry: false })
        if (stat?.isSymbolicLink() === true) unlinkFolder(modules)
        else if (stat !== undefined) {
            for (const name of entriesOf(modules)) unlinkFolder(join(modules, name))
            rmSync(modules, { recursive: true, force: true })
        }
        done.push({ folder, ...(await cachedInstall(dir, options, materialize)) })
    }
    return done
}

/**
 * Removes every link anywhere in a throwaway checkout (a clean-verify or wave checkout about to be deleted), link only, never
 * entering one: the install links unlinkInstallLinks knows, plus any a setup command or a tool made deeper down. Nothing a later
 * recursive delete of the checkout walks can then lead out of it.
 */
export const unlinkCheckoutLinks = (checkout: string): void => {
    unlinkInstallLinks(checkout)
    const walk = (at: string): void => {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
            const path = join(at, entry.name)
            // A Dirent reads the entry itself (lstat), so a junction is a link here and is never entered.
            if (entry.isSymbolicLink()) unlinkFolder(path)
            else if (entry.isDirectory() && entry.name !== ".git") walk(path)
        }
    }
    if (existsSync(checkout)) walk(checkout)
}
