import { createHash, randomBytes } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { Worker } from "node:worker_threads"
import { captureGitSync } from "../shared/git.js"
import { INSTALL_INPUTS, installInputs, installKey, installSatisfies, modulesFolders, unlinkInstallLinks } from "./install-cache.js"
import { installHazard } from "./install-guard.js"
import { placeChunk } from "./place-chunk.js"
import type { PlacedFile } from "./place-chunk.js"
import { assertNotRemoving, removeLockOf } from "./remove-lock.js"

/**
 * The shared install of a lane (contexts/authority/lanes.md "Gate and land"): a fresh worktree of an app gets its node_modules from a reference install whose
 * lockfile and manifests are byte for byte its own, instead of a full `npm ci`.
 *
 * The reference is a per-repository cache entry under the lanes folder (`<lanes>/_install-cache/<repo>/<key>`), made once per key by COPYING the app's dev checkout's
 * node_modules (when its lockfiles equal the lane's and its install satisfies them) or a lane's own fresh `npm ci` of an unchanged dev lockfile. A lane takes the entry by
 * HARD LINKS: every file is another name of the cached file, so nothing is copied and no directory junction into the cache exists. Three rules keep that safe:
 *
 * - The dev checkout is never a link source. The running dev stack serves from it, and a tool writing in place through a hard link would change the served file; the
 *   cache copy is the only thing a lane links to, and a later `npm ci` there removes names only.
 * - A file npm itself rewrites in place (`node_modules/.package-lock.json` and every `.bin` shim) is copied, not linked, so a later `npm install` in the lane cannot change
 *   the cache. A tool's own cache (`node_modules/.cache`) is never shared.
 * - The links npm makes to the checkout's own workspace folders are junctions (symlinks off Windows) re-made to the lane's own folders, never copied from the cache; a
 *   lane removed afterwards loses them through `unlinkInstallLinks` first, as every worktree does (contexts/authority/README.md "Worktrees").
 *
 * Anything else sends the lane to `npm ci` as before: lockfile or manifest differing, a node_modules already there, a link or a removal lock on the worktree, a member that
 * declares an install script, a hard link that fails (a file is copied instead; a missing source or a failed verification discards the partial result).
 */

/** `off` turns the shared install off; `copy` fills the lane by copying instead of hard links. */
export const SHARED_INSTALL_ENV = "STARCI_SHARED_INSTALL"

/** The folder of the per-repository install cache under the lanes folder. */
export const INSTALL_CACHE_DIR = "_install-cache"

const ENTRY_FILE = "entry.json"
const TREE_DIR = "tree"
/** Entries of a node_modules folder never shared: a tool's own cache. */
const UNSHARED = new Set([".cache", ".starci-linked", ".starci-hardlinked"])
/** The lifecycle scripts `npm ci` runs for the root project, in its order. */
export const ROOT_LIFECYCLE: readonly string[] = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare"]

const toSlash = (path: string): string => path.split(sep).join("/")

/** One link of an install tree that is not a file: a link to the checkout's own folder, or a link inside the install. */
interface RecordedLink {
    readonly kind: "own" | "inner"
    /** The link's own path, relative to the checkout, posix. */
    readonly path: string
    /** Where it points, relative to the checkout, posix. */
    readonly target: string
}

/** What a cache entry records. */
interface Entry {
    readonly schema: "starci/shared-install@1"
    readonly key: string
    readonly at: string
    readonly source: string
    readonly folders: readonly string[]
    readonly links: readonly RecordedLink[]
    readonly files: number
}

/** What the shared install did: linked from an entry, or nothing (the caller runs `npm ci`) and why. */
export type SharedInstall =
    | { readonly status: "linked"; readonly key: string; readonly files: number; readonly copied: number; readonly ms: number; readonly source: string; readonly scripts: readonly string[] }
    | { readonly status: "miss"; readonly key?: string; readonly reason: string }

/** A reference that cannot be shared: the reason, never an error to the user. */
class Unshareable extends Error {}

const isLink = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true

/** The worktrees of the repository that holds `dir` (the main checkout first), from `git worktree list`. */
const worktrees = (dir: string): string[] => {
    const listing = captureGitSync(["worktree", "list", "--porcelain"], dir)
    if (listing.exitCode !== 0) return []
    return listing.stdout.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => resolve(line.slice("worktree ".length).trim()))
}

/** The folder that holds the install cache of the repository `root` belongs to: `<lanes>/_install-cache/<main checkout name>-<hash of its git dir>`. */
export const repoCacheDir = (lanes: string, root: string): string => {
    const main = worktrees(root)[0] ?? resolve(root)
    const common = captureGitSync(["rev-parse", "--git-common-dir"], root).stdout.trim()
    const id = createHash("sha1").update(resolve(root, common).replaceAll("\\", "/").toLowerCase()).digest("hex").slice(0, 8)
    return join(lanes, INSTALL_CACHE_DIR, `${basename(main).replace(/[^A-Za-z0-9._-]/g, "_")}-${id}`)
}

/** The folder of one cache entry. */
export const entryDir = (cache: string, key: string): string => join(cache, key)

const readEntry = (entry: string): Entry | undefined => {
    try {
        return JSON.parse(readFileSync(join(entry, ENTRY_FILE), "utf8")) as Entry
    } catch {
        return undefined
    }
}

/** The dev checkouts of the repository a lane may fill a cache entry from: the dev sync's checkout of this machine's settings, then the main checkout. */
export const referenceCheckouts = (root: string, devSyncCheckout?: string): string[] => {
    const trees = worktrees(root).map((tree) => tree.replaceAll("\\", "/").toLowerCase())
    const named = devSyncCheckout === undefined ? [] : [resolve(devSyncCheckout)]
    const all = [...named, ...worktrees(root).slice(0, 1)]
    return [...new Set(all.map((dir) => resolve(dir)))].filter((dir) => trees.includes(dir.replaceAll("\\", "/").toLowerCase()) && resolve(dir) !== resolve(root))
}

const walk = (fromRoot: string, toRoot: string, modules: string, at: string, depth: number, plan: Plan): void => {
    for (const dirent of readdirSync(at, { withFileTypes: true })) {
        const from = join(at, dirent.name)
        const rel = toSlash(relative(modules, from))
        if (depth === 0 && UNSHARED.has(dirent.name)) continue
        const dest = join(toRoot, relative(fromRoot, from))
        if (dirent.isSymbolicLink()) {
            const target = resolve(dirname(from), readlinkSync(from))
            const inside = relative(fromRoot, target)
            if (inside.startsWith("..") || resolve(inside) === inside) throw new Unshareable(`${toSlash(relative(fromRoot, from))} links outside the checkout`)
            const kind = inside.split(sep).includes("node_modules") ? "inner" : "own"
            plan.links.push({ kind, path: toSlash(relative(fromRoot, from)), target: toSlash(inside) })
        } else if (dirent.isDirectory()) {
            plan.dirs.push(dest)
            walk(fromRoot, toRoot, modules, from, depth + 1, plan)
        } else if (dirent.isFile()) {
            const writtenByNpm = rel === ".package-lock.json" || rel.split("/").includes(".bin")
            plan.files.push({ from, to: dest, copy: writtenByNpm })
        } else throw new Unshareable(`${toSlash(relative(fromRoot, from))} is neither a file, a folder nor a link`)
    }
}

interface Plan {
    readonly dirs: string[]
    readonly files: { readonly from: string; readonly to: string; readonly copy: boolean }[]
    readonly links: RecordedLink[]
}

/** Trees under this many files are done inline: a worker thread costs more than it saves. */
const INLINE_BELOW = 4000
/** Worker threads of a big tree. Synchronous file system calls run truly in parallel in them (the libuv pool of async calls is four threads and measured no faster than one). */
const WORKERS = 8

/** Links or copies every file of the plan: inline when small, else over WORKERS threads, each a contiguous chunk. Returns how many were copied. */
const place = async (files: readonly PlacedFile[], linking: boolean): Promise<number> => {
    if (files.length < INLINE_BELOW) return placeChunk(files, linking)
    const size = Math.ceil(files.length / WORKERS)
    const chunks = Array.from({ length: WORKERS }, (_, index) => files.slice(index * size, (index + 1) * size)).filter((chunk) => chunk.length > 0)
    const worker = new URL("./place-worker.js", import.meta.url)
    const copied = await Promise.all(chunks.map((chunk) => new Promise<number>((resolveChunk, reject) => {
        const thread = new Worker(worker, { workerData: { files: chunk, linking } })
        thread.once("message", (message: { copied?: number; error?: string }) => {
            if (message.error === undefined) resolveChunk(message.copied ?? 0)
            else reject(new Unshareable(message.error))
        })
        thread.once("error", reject)
    })))
    return copied.reduce((sum, each) => sum + each, 0)
}

/**
 * Mirrors the node_modules folders `folders` (relative to `fromRoot`) into `toRoot`: files hard linked (or copied with `mode` copy, and the files npm rewrites in place
 * always), folders made, links returned as records. A file whose link the volume refuses is copied. A source that vanishes is an Unshareable.
 */
const mirror = async (fromRoot: string, toRoot: string, folders: readonly string[], mode: "link" | "copy"): Promise<{ readonly links: RecordedLink[]; readonly files: number; readonly copied: number }> => {
    const plan: Plan = { dirs: [], files: [], links: [] }
    for (const folder of folders) {
        const modules = join(fromRoot, folder)
        if (isLink(modules)) throw new Unshareable(`${folder} is a link`)
        plan.dirs.push(join(toRoot, folder))
        walk(fromRoot, toRoot, modules, modules, 0, plan)
    }
    for (const dir of plan.dirs) mkdirSync(dir, { recursive: true })
    let copied: number
    try {
        copied = await place(plan.files, mode === "link")
    } catch (error) {
        throw error instanceof Unshareable ? error : new Unshareable(error instanceof Error ? error.message : String(error))
    }
    return { links: plan.links, files: plan.files.length, copied }
}

/** A directory link: a junction on Windows, a symlink elsewhere. */
const linkDir = (target: string, path: string): void => {
    mkdirSync(dirname(path), { recursive: true })
    symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir")
}

/** Removes what a failed fill made: its links by a plain unlink, then its folders, never a recursive delete through a link. */
const discard = (root: string, folders: readonly string[], links: readonly RecordedLink[]): void => {
    for (const link of links) {
        const path = join(root, link.path)
        if (isLink(path)) {
            try {
                unlinkSync(path)
            } catch {
                // a junction that refuses a file unlink goes with its folder below, after unlinkInstallLinks
            }
        }
    }
    unlinkInstallLinks(root, folders)
    for (const folder of folders) rmSync(join(root, folder), { recursive: true, force: true })
}

/** The lifecycle scripts the root of `dir` runs in `npm ci`, and the first workspace member that declares one (which makes the install unshareable). */
export const lifecycleOf = (dir: string): { readonly root: readonly string[]; readonly member?: string } => {
    const scriptsOf = (file: string): Record<string, unknown> => {
        try {
            const scripts = (JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, unknown> }).scripts
            return scripts ?? {}
        } catch {
            return {}
        }
    }
    const root = ROOT_LIFECYCLE.filter((name) => typeof scriptsOf(join(dir, "package.json"))[name] === "string")
    const members = installInputs(dir).filter((path) => path.endsWith("/package.json"))
    const member = members.find((path) => [...ROOT_LIFECYCLE, "prepublish"].some((name) => typeof scriptsOf(join(dir, path))[name] === "string"))
    return member === undefined ? { root } : { root, member: dirname(member) }
}

/** Whether the install in `dir` may be a cache source: a real node_modules whose npm record satisfies its lockfile and that no removal is under way over. */
const usableSource = (dir: string, key: string): string | undefined => {
    if (!existsSync(join(dir, "node_modules", ".package-lock.json"))) return "its npm record is missing (an install is not finished there)"
    if (isLink(join(dir, "node_modules"))) return "its node_modules is a link"
    if (removeLockOf(dir) !== undefined) return "it is being removed"
    if (installKey(dir) !== key) return "its lockfile or manifests differ"
    if (installSatisfies(dir) !== true) return "its install does not satisfy its lockfile"
    return undefined
}

/**
 * Writes a cache entry from the install in `source` by copy: staged beside it and renamed into place, so a reader sees a whole entry or none. The source is read only; it is
 * re-verified after the copy and the entry dropped when the source changed meanwhile. An entry of this key that appears first is kept.
 */
export const fillEntry = async (cache: string, key: string, source: string): Promise<{ readonly entry: string; readonly files: number } | undefined> => {
    const entry = entryDir(cache, key)
    if (existsSync(join(entry, ENTRY_FILE))) return undefined
    const reason = usableSource(source, key)
    if (reason !== undefined) throw new Unshareable(reason)
    const folders = modulesFolders(source)
    const staging = `${entry}.tmp-${String(process.pid)}-${randomBytes(4).toString("hex")}`
    const before = readFileSync(join(source, "node_modules", ".package-lock.json"), "utf8")
    try {
        mkdirSync(join(staging, TREE_DIR), { recursive: true })
        const done = await mirror(source, join(staging, TREE_DIR), folders, "copy")
        if (readFileSync(join(source, "node_modules", ".package-lock.json"), "utf8") !== before) throw new Unshareable("the source install changed while it was copied")
        const record: Entry = { schema: "starci/shared-install@1", key, at: new Date().toISOString(), source: resolve(source), folders, links: done.links, files: done.files }
        writeFileSync(join(staging, ENTRY_FILE), `${JSON.stringify(record, null, 2)}\n`)
        try {
            renameSync(staging, entry)
        } catch {
            rmSync(staging, { recursive: true, force: true })
            return undefined
        }
        return { entry, files: done.files }
    } catch (error) {
        rmSync(staging, { recursive: true, force: true })
        throw error
    }
}

/** How many entries a repository's cache keeps: the newest by creation; older ones go (a lane's hard links outlive their entry). */
const KEEP_ENTRIES = 3
const PRUNE_AFTER_MS = 60 * 60_000

/** Drops the oldest entries past KEEP_ENTRIES that are over an hour old, and leftover staging folders of dead fills. Best effort. */
export const pruneEntries = (cache: string): void => {
    try {
        const names = readdirSync(cache)
        const now = Date.now()
        const entries = names.filter((name) => !name.includes(".tmp-") && existsSync(join(cache, name, ENTRY_FILE))).map((name) => ({ name, at: Date.parse(readEntry(join(cache, name))?.at ?? "") || 0 })).sort((left, right) => right.at - left.at)
        for (const old of entries.slice(KEEP_ENTRIES)) if (now - old.at > PRUNE_AFTER_MS) rmSync(join(cache, old.name), { recursive: true, force: true })
        for (const name of names.filter((each) => each.includes(".tmp-"))) if (now - (lstatSync(join(cache, name), { throwIfNoEntry: false })?.mtimeMs ?? now) > 6 * PRUNE_AFTER_MS) rmSync(join(cache, name), { recursive: true, force: true })
    } catch {
        // a cache that cannot be pruned is only larger
    }
}

/** The ports the install runs scripts and reports through. */
export interface SharedInstallPorts {
    readonly lanes: string
    readonly say: (line: string) => void
    /** Runs `npm run <script> --ignore-scripts` in the lane (the lifecycle scripts `npm ci` would run); true when it exited 0. */
    readonly runScript: (script: string) => Promise<boolean>
    /** The dev sync checkout of this machine's settings, when it names one for this repository. */
    readonly devSyncCheckout?: string | undefined
    readonly mode?: "link" | "copy"
}

/**
 * Gives the fresh worktree `root` its node_modules from the install cache, filling the entry of its key from a dev checkout when none exists. Returns `miss` (nothing left
 * behind) whenever the lane must run `npm ci` instead.
 */
export const sharedInstall = async (root: string, ports: SharedInstallPorts): Promise<SharedInstall> => {
    const mode = ports.mode ?? (process.env[SHARED_INSTALL_ENV] === "copy" ? "copy" : "link")
    if (process.env[SHARED_INSTALL_ENV] === "off") return { status: "miss", reason: `${SHARED_INSTALL_ENV}=off` }
    assertNotRemoving(root)
    if (!existsSync(join(root, "package-lock.json")) && !existsSync(join(root, "npm-shrinkwrap.json"))) return { status: "miss", reason: "no lockfile" }
    if (existsSync(join(root, "node_modules"))) return { status: "miss", reason: "node_modules is already there: npm ci replaces it" }
    const hazard = installHazard(root)
    if (hazard !== undefined) return { status: "miss", reason: hazard.message }
    const lifecycle = lifecycleOf(root)
    if (lifecycle.member !== undefined) return { status: "miss", reason: `the workspace member ${lifecycle.member} declares an install script` }
    const key = installKey(root)
    const cache = repoCacheDir(ports.lanes, root)
    const entry = entryDir(cache, key)
    if (!existsSync(join(entry, ENTRY_FILE))) {
        const started = Date.now()
        let reason = "no dev checkout of this repository"
        for (const source of referenceCheckouts(root, ports.devSyncCheckout)) {
            try {
                ports.say(`shared install: filling the cache entry ${key} from ${source} (copy, once per lockfile)`)
                const filled = await fillEntry(cache, key, source)
                if (filled !== undefined) ports.say(`shared install: cache entry ${key} filled, ${String(filled.files)} files in ${String(Math.round((Date.now() - started) / 1000))}s`)
                reason = ""
                break
            } catch (error) {
                reason = `${source}: ${error instanceof Error ? error.message : String(error)}`
            }
        }
        if (!existsSync(join(entry, ENTRY_FILE))) return { status: "miss", key, reason: `no cache entry for ${key} (${reason})` }
    }
    const recorded = readEntry(entry)
    if (recorded?.key !== key) return { status: "miss", key, reason: `the cache entry ${key} is unreadable` }
    const started = Date.now()
    const made: RecordedLink[] = []
    try {
        const done = await mirror(join(entry, TREE_DIR), root, recorded.folders, mode)
        for (const link of recorded.links) {
            const path = join(root, link.path)
            const target = resolve(root, link.target)
            if (link.kind === "own" && !existsSync(target)) throw new Unshareable(`${link.path} links to ${link.target}, which this checkout lacks`)
            if (link.kind === "inner" && !existsSync(target)) continue
            linkDir(target, path)
            made.push(link)
        }
        if (installSatisfies(root) !== true) throw new Unshareable("the linked install does not satisfy the lockfile")
        writeFileSync(join(root, "node_modules", ".starci-hardlinked"), `${key} ${entry}\n`)
        const scripts: string[] = []
        for (const script of lifecycle.root) {
            if (!(await ports.runScript(script))) throw new Unshareable(`npm run ${script} failed`)
            scripts.push(script)
        }
        return { status: "linked", key, files: done.files, copied: done.copied, ms: Date.now() - started, source: recorded.source, scripts }
    } catch (error) {
        discard(root, recorded.folders, made)
        return { status: "miss", key, reason: error instanceof Error ? error.message : String(error) }
    }
}

/** Whether the lane's install inputs equal the base's: no manifest, lockfile or .npmrc differs between `ref` and HEAD, so its `npm ci` is the dev line's install. */
export const followsBase = (root: string, ref: string): boolean => {
    const diff = captureGitSync(["diff", "--name-only", ref, "HEAD"], root)
    if (diff.exitCode !== 0) return false
    return !diff.stdout.split(/\r?\n/).some((file) => INSTALL_INPUTS.includes(basename(file)))
}

/** After a lane's own `npm ci` of the dev line's lockfile: caches that install for the next lane, by copy. Best effort; returns a note. */
export const cacheLaneInstall = async (root: string, lanes: string): Promise<string> => {
    const key = installKey(root)
    const cache = repoCacheDir(lanes, root)
    try {
        const filled = await fillEntry(cache, key, root)
        pruneEntries(cache)
        return filled === undefined ? `install cache ${key} already holds this lockfile` : `install cache ${key} filled from this lane (${String(filled.files)} files) for the next lane`
    } catch (error) {
        return `install cache ${key} not filled: ${error instanceof Error ? error.message : String(error)}`
    }
}
