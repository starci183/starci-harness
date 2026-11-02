import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import type { Stats } from "node:fs"
import { randomUUID } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"
import { Refusal } from "../shared/errors.js"
import { captureGitSync, git, nulPaths, samePath } from "../shared/git.js"
import { unlinkInstallLinks } from "./install-cache.js"
import { findLedgerId, now, openMachine, projectDir, projectsRoot } from "./ledger.js"

// These are reproducible installs and compiler/test caches, never custody or runtime state.
const CACHE_FOLDERS = new Set(["node_modules", ".next", ".turbo", "coverage", "storybook-static"])

interface FileStamp {
    readonly path: string
    readonly size: number
    readonly mtime: number
    readonly ctime: number
    readonly mode: number
    readonly ino: number
    readonly dev: number
}

interface CheckoutFiles {
    readonly files: readonly FileStamp[]
    readonly links: readonly { readonly path: string; readonly target: string; readonly metadata: FileStamp }[]
    readonly directories: readonly string[]
    readonly directoryMetadata: readonly FileStamp[]
    readonly root: FileStamp
}

const metadata = (path: string, stat: Stats): FileStamp => ({ path, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, mode: stat.mode, ino: stat.ino, dev: stat.dev })

const stamp = (root: string, path: string): FileStamp => {
    const stat = lstatSync(join(root, path))
    if (!stat.isFile()) throw new Refusal("WORKTREE_PRESERVE_UNSAFE", `${path}: not a regular file`)
    return metadata(path, stat)
}

/** Metadata only, never entering links; a remnant includes every install/cache because Git cannot prove its ownership. */
export const checkoutFiles = (root: string, tracked: ReadonlySet<string> = new Set(), inventory: "checkout" | "remnant" = "checkout"): CheckoutFiles => {
    const files: FileStamp[] = []
    const links: { path: string; target: string; metadata: FileStamp }[] = []
    const directories: string[] = []
    const directoryMetadata: FileStamp[] = []
    const rootStat = lstatSync(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Refusal("WORKTREE_PRESERVE_UNSAFE", "checkout root is not a real directory; nothing removed")
    const walk = (relative: string): void => {
        for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.toLowerCase() === ".git") {
                if (relative !== "" || inventory === "remnant") throw new Refusal("WORKTREE_PRESERVE_UNSAFE", `${relative === "" ? "." : relative}: nested checkout needs its own preservation; nothing removed`)
                continue
            }
            const path = relative === "" ? entry.name : `${relative}/${entry.name}`
            const stat = lstatSync(join(root, path))
            if (stat.isSymbolicLink()) links.push({ path, target: readlinkSync(join(root, path)), metadata: metadata(path, stat) })
            else if (stat.isDirectory()) {
                const holdsTracked = [...tracked].some((file) => file.startsWith(`${path}/`))
                if (inventory === "checkout" && CACHE_FOLDERS.has(entry.name) && !holdsTracked && captureGitSync(["check-ignore", "--quiet", "--", path], root).exitCode === 0) continue
                directories.push(path)
                directoryMetadata.push(metadata(path, stat))
                walk(path)
            } else files.push(stamp(root, path))
        }
    }
    walk("")
    return { files, links, directories, directoryMetadata, root: metadata("", rootStat) }
}

const unchanged = (root: string, before: CheckoutFiles, tracked: ReadonlySet<string>): void => {
    if (JSON.stringify(checkoutFiles(root, tracked)) !== JSON.stringify(before)) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "checkout metadata changed during preservation; nothing removed")
}

/** A durable snapshot and a check run again immediately before its checkout may be removed. */
export interface PreservedCheckout {
    readonly directory: string
    verify(): Promise<void>
}

const realDirectory = (path: string): void => {
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat?.isDirectory() !== true || stat.isSymbolicLink() || !samePath(resolve(path), realpathSync(path))) throw new Refusal("WORKTREE_REMNANT_SCOPE", "remnant custody requires canonical real directories; nothing removed")
}

/** Proves a Git-less folder is one real direct child of this registered repository's own runtime worktrees directory. */
export const inspectRemnant = (root: string, path: string): CheckoutFiles => {
    const id = findLedgerId(root)
    const repository = captureGitSync(["rev-parse", "--path-format=absolute", "--git-common-dir"], root)
    if (id === undefined || repository.exitCode !== 0) throw new Refusal("WORKTREE_REMNANT_SCOPE", "remnant has no registered Git repository provenance; nothing removed")
    const registered = (() => {
        const db = openMachine()
        try {
            return db.prepare("SELECT repo_common_dir FROM ledgers WHERE ledger_id = ?").get(id)
        } finally {
            db.close()
        }
    })()
    if (registered === undefined || !samePath(realpathSync(String(registered.repo_common_dir)), realpathSync(repository.stdout.trim()))) throw new Refusal("WORKTREE_REMNANT_SCOPE", "repository identity no longer matches the registered project; nothing removed")
    if (basename(id) !== id || id === "." || id === "..") throw new Refusal("WORKTREE_REMNANT_SCOPE", "project ledger id is not a direct state directory; nothing removed")
    const project = join(projectsRoot(), id)
    const worktrees = join(project, "worktrees")
    for (const folder of [projectsRoot(), project, worktrees, path]) realDirectory(folder)
    if (!samePath(dirname(resolve(path)), worktrees) || basename(path).endsWith(".ops")) throw new Refusal("WORKTREE_REMNANT_SCOPE", "selected remnant is not a direct worktree of this project; nothing removed")
    if (lstatSync(join(path, ".git"), { throwIfNoEntry: false }) !== undefined) throw new Refusal("WORKTREE_REMNANT_SCOPE", "selected remnant still holds Git metadata; nothing removed")
    return checkoutFiles(path, new Set(), "remnant")
}

const equalMetadata = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const sameDirectoryIdentity = (left: FileStamp, right: FileStamp): boolean => left.path === right.path && left.ino === right.ino && left.dev === right.dev && left.mode === right.mode

const verifyCustody = (before: CheckoutFiles, after: CheckoutFiles, removedLinks: ReadonlySet<string>): void => {
    const expectedLinks = before.links.filter((link) => !removedLinks.has(link.path))
    const changedParents = new Set([...removedLinks].map((path) => dirname(path).replaceAll("\\", "/")).map((path) => path === "." ? "" : path))
    const directoriesUnchanged = before.directoryMetadata.length === after.directoryMetadata.length && before.directoryMetadata.every((directory, index) => {
        const current = after.directoryMetadata[index]
        return current !== undefined && (changedParents.has(directory.path) ? sameDirectoryIdentity(directory, current) : equalMetadata(directory, current))
    })
    // A rename changes the root's ctime; unlinking a dependency changes only its parent directory's timestamps/size.
    const rootUnchanged = sameDirectoryIdentity(before.root, after.root) && (changedParents.has("") || before.root.mtime === after.root.mtime)
    if (!rootUnchanged || !directoriesUnchanged || !equalMetadata(before.files, after.files) || !equalMetadata(expectedLinks, after.links)) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "remnant identity or bytes metadata changed during quarantine; custody retained for review")
}

/** A complete quarantine, or retained custody whose source replacement, changed tree or held dependency link needs review. */
export interface QuarantinedRemnant {
    readonly directory: string
    readonly removed: boolean
    readonly quarantine: "complete" | "held" | "changed"
    readonly detail: string
}

/** The first folder of `parent` named `name`, or `name.2`, `name.3` and so on, that does not exist yet. */
const freeFolder = (parent: string, name: string): string => {
    let folder = join(parent, name)
    let n = 2
    while (existsSync(folder)) {
        folder = join(parent, `${name}.${String(n)}`)
        n += 1
    }
    return folder
}

/** Moves every byte into same-project custody atomically, then unlinks dependency links only; it never recursively deletes. */
export const quarantineRemnant = async (root: string, path: string, verifySelection: () => Promise<void>): Promise<QuarantinedRemnant> => {
    await verifySelection()
    const before = inspectRemnant(root, path)
    const preserved = join(projectDir(root), "preserved")
    if (!existsSync(preserved)) mkdirSync(preserved, { mode: 0o700 })
    realDirectory(preserved)
    const directory = freeFolder(preserved, `gc-${basename(path)}`)
    mkdirSync(directory, { mode: 0o700 })
    const reserved = metadata("", lstatSync(directory))
    const checkout = join(directory, "checkout")
    const dependencyLinks = new Set(before.links.filter((link) => link.path.split("/").some((part) => (process.platform === "win32" ? part.toLowerCase() : part) === "node_modules")).map((link) => link.path))
    const receipt = (state: string, removedLinks?: readonly string[]): void => {
        realDirectory(directory)
        if (!sameDirectoryIdentity(reserved, metadata("", lstatSync(directory)))) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "reserved custody was replaced; nothing further changed")
        const temporary = join(directory, `.manifest-${randomUUID()}.tmp`)
        writeFileSync(temporary, `${JSON.stringify({ schema: "starci/remnant-quarantine@1", state, worktree: path, checkout, metadata: before, dependencyLinks: [...dependencyLinks], ...(removedLinks === undefined ? {} : { removedLinks }), at: now() }, null, 2)}\n`, { mode: 0o600, flag: "wx" })
        renameSync(temporary, join(directory, "manifest.json"))
    }
    receipt("prepared")
    const prepared = stamp(directory, "manifest.json")
    await verifySelection()
    if (!equalMetadata(inspectRemnant(root, path), before)) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "remnant changed before quarantine; nothing moved")
    realDirectory(directory)
    if (!sameDirectoryIdentity(reserved, metadata("", lstatSync(directory))) || !equalMetadata(prepared, stamp(directory, "manifest.json"))) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "reserved custody changed before quarantine; nothing moved")
    if (lstatSync(checkout, { throwIfNoEntry: false }) !== undefined) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "reserved checkout destination is no longer empty; nothing moved")
    renameSync(path, checkout)
    try {
        verifyCustody(before, checkoutFiles(checkout, new Set(), "remnant"), new Set())
        if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "source path was replaced during quarantine; the replacement is untouched")
    } catch {
        receipt("changed")
        return { directory, removed: false, quarantine: "changed", detail: "quarantined custody needs review; source replacement or changed metadata was retained, nothing deleted" }
    }
    try {
        unlinkInstallLinks(checkout, [...dependencyLinks])
    } catch {
        receipt("held")
        return { directory, removed: false, quarantine: "held", detail: "all bytes are quarantined; a dependency link could not be unlinked, custody needs review" }
    }
    try {
        verifyCustody(before, checkoutFiles(checkout, new Set(), "remnant"), dependencyLinks)
        if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "source path was replaced during quarantine; the replacement is untouched")
    } catch {
        receipt("changed")
        return { directory, removed: false, quarantine: "changed", detail: "quarantined custody needs review after dependency unlink; all regular bytes retained, nothing deleted" }
    }
    receipt("complete", [...dependencyLinks])
    return { directory, removed: true, quarantine: "complete", detail: "entire remnant quarantined with all regular bytes; dependency links unlinked as links, no Git reference inferred" }
}

/** Preserves binary/index patches, opaque working-file copies, link metadata and a durable HEAD ref. */
export const preserveCheckout = async (root: string, path: string): Promise<PreservedCheckout | null> => {
    if (!existsSync(path)) return null
    if (!existsSync(join(path, ".git"))) throw new Refusal("WORKTREE_PRESERVE_UNSAFE", "existing folder lacks Git metadata; retain it until its bytes have a preservation owner")
    const head = await git(path, ["rev-parse", "HEAD"])
    const branch = await git(path, ["branch", "--show-current"])
    const tracked = new Set(nulPaths(await git(path, ["ls-files", "-z"])))
    const untracked = new Set(nulPaths(await git(path, ["ls-files", "--others", "--exclude-standard", "-z"])))
    const index = await git(path, ["ls-files", "--stage", "-z"])
    const before = checkoutFiles(path, tracked)
    const directory = freeFolder(join(projectDir(root), "preserved"), `gc-${basename(path)}`)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    await git(path, ["diff", "--binary", `--output=${join(directory, "changes.patch")}`, "HEAD"])
    await git(path, ["diff", "--binary", "--cached", `--output=${join(directory, "index.patch")}`])
    const copied: { path: string; stored: string; size: number }[] = []
    for (const file of before.files) {
        // Git filters and assume-unchanged flags can omit working bytes from a patch; opaque tracked copies keep those too.
        const stored = `${tracked.has(file.path) ? "tracked" : untracked.has(file.path) ? "untracked" : "ignored"}/${file.path}`
        const target = join(directory, stored)
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
        copyFileSync(join(path, file.path), target, constants.COPYFILE_EXCL)
        chmodSync(target, file.mode & 0o777)
        if (lstatSync(target).size !== file.size || JSON.stringify(stamp(path, file.path)) !== JSON.stringify(file)) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "a file changed during its opaque copy; nothing removed")
        copied.push({ path: file.path, stored, size: file.size })
    }
    unchanged(path, before, tracked)
    const ref = `refs/starci/preserved/${head}/${basename(directory).replaceAll(/[^a-zA-Z0-9._-]/g, "-")}`
    await git(path, ["update-ref", ref, head])
    writeFileSync(join(directory, "manifest.json"), `${JSON.stringify({ worktree: path, head, branch, ref, files: copied, metadata: before, at: now() }, null, 2)}\n`, { mode: 0o600 })
    return {
        directory,
        verify: async (): Promise<void> => {
            unchanged(path, before, tracked)
            if ((await git(path, ["rev-parse", "HEAD"])) !== head || (await git(path, ["branch", "--show-current"])) !== branch) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "HEAD changed during preservation; nothing removed")
            if ((await git(path, ["ls-files", "--stage", "-z"])) !== index) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "index changed during preservation; nothing removed")
            for (const file of copied) if (lstatSync(join(directory, file.stored)).size !== file.size) throw new Refusal("WORKTREE_PRESERVE_UNSAFE", "a preserved file is incomplete; nothing removed")
        },
    }
}
