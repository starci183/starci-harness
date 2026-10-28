import { createHash, randomBytes } from "node:crypto"
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { captureNpm, npmVersion } from "../shared/exec.js"
import type { RunOptions, ToolRun } from "../shared/exec.js"
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

/** The key of an install: the lockfile's bytes, Node's version and npm's, so any of them changing installs anew. */
export const installKey = (lockfile: string): string =>
    createHash("sha256")
        .update(readFileSync(lockfile))
        .update(`\0${process.version}\0${npmVersion() ?? "no-npm"}`)
        .digest("hex")
        .slice(0, 24)

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
export const cachedInstall = async (dir: string, lockfile: string, options: RunOptions, materialize: boolean): Promise<CachedInstall> => {
    const key = installKey(lockfile)
    const entry = installCachePath(key)
    if (existsSync(join(entry, LINKS_FILE)) && !existsSync(join(dir, "node_modules"))) {
        try {
            fromCache(dir, entry, materialize)
            return { run: null, key, reused: true, note: `node_modules ${materialize ? "copied" : "linked"} from the install cache ${key} (no npm ci)` }
        } catch (error: unknown) {
            unlinkInstallLinks(dir)
            rmSync(join(dir, "node_modules"), { recursive: true, force: true })
            const why = error instanceof Error ? error.message : String(error)
            return { ...(await freshInstall(dir, entry, key, options)), note: `the install cache ${key} could not be used (${why}); npm ci ran` }
        }
    }
    return freshInstall(dir, entry, key, options)
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

/** The node_modules folders of a checkout, down to a few levels, never inside one another or inside .git. */
const modulesFolders = (root: string, depth: number): string[] => {
    if (depth < 0 || !existsSync(root)) return []
    const found: string[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === ".git") continue
        const path = join(root, entry.name)
        if (entry.name === "node_modules") found.push(path)
        else found.push(...modulesFolders(path, depth - 1))
    }
    return found
}

const MODULES_DEPTH = 4

/**
 * Removes every link a checkout's node_modules holds at its package level (the cache links, and the links npm made to the
 * checkout's own folders) with a plain unlink, never a recursive delete through it, so removing the checkout afterwards cannot
 * reach the cache or the folder a link names.
 */
export const unlinkInstallLinks = (checkout: string): void => {
    for (const modules of modulesFolders(checkout, MODULES_DEPTH)) {
        for (const name of entriesOf(modules)) {
            const path = join(modules, name)
            if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true) unlinkSync(path)
        }
    }
}
