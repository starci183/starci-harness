import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { Refusal } from "../shared/errors.js"
import { captureGitSync, git, nulPaths } from "../shared/git.js"
import { now, projectDir } from "./ledger.js"

// These are reproducible installs and compiler/test caches, never custody or runtime state.
const CACHE_FOLDERS = new Set(["node_modules", ".next", ".turbo", "coverage", "storybook-static"])

interface FileStamp {
    readonly path: string
    readonly size: number
    readonly mtime: number
    readonly ctime: number
    readonly mode: number
    readonly ino: number
}

interface CheckoutFiles {
    readonly files: readonly FileStamp[]
    readonly links: readonly { readonly path: string; readonly target: string }[]
    readonly directories: readonly string[]
}

const stamp = (root: string, path: string): FileStamp => {
    const stat = lstatSync(join(root, path))
    if (!stat.isFile()) throw new Refusal("WORKTREE_PRESERVE_UNSAFE", `${path}: not a regular file`)
    return { path, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, mode: stat.mode, ino: stat.ino }
}

/** Metadata only, without entering any link or reproducible install/cache folder. */
export const checkoutFiles = (root: string, tracked: ReadonlySet<string> = new Set()): CheckoutFiles => {
    const files: FileStamp[] = []
    const links: { path: string; target: string }[] = []
    const directories: string[] = []
    const walk = (relative: string): void => {
        for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === ".git") {
                if (relative !== "") throw new Refusal("WORKTREE_PRESERVE_UNSAFE", `${relative}: nested checkout needs its own preservation; nothing removed`)
                continue
            }
            const path = relative === "" ? entry.name : `${relative}/${entry.name}`
            const stat = lstatSync(join(root, path))
            if (stat.isSymbolicLink()) links.push({ path, target: readlinkSync(join(root, path)) })
            else if (stat.isDirectory()) {
                const holdsTracked = [...tracked].some((file) => file.startsWith(`${path}/`))
                if (CACHE_FOLDERS.has(entry.name) && !holdsTracked && captureGitSync(["check-ignore", "--quiet", "--", path], root).exitCode === 0) continue
                directories.push(path)
                walk(path)
            } else files.push(stamp(root, path))
        }
    }
    walk("")
    return { files, links, directories }
}

const unchanged = (root: string, before: CheckoutFiles, tracked: ReadonlySet<string>): void => {
    if (JSON.stringify(checkoutFiles(root, tracked)) !== JSON.stringify(before)) throw new Refusal("WORKTREE_CHANGED_DURING_GC", "checkout metadata changed during preservation; nothing removed")
}

/** A durable snapshot and a check run again immediately before its checkout may be removed. */
export interface PreservedCheckout {
    readonly directory: string
    verify(): Promise<void>
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
    let directory = join(projectDir(root), "preserved", `gc-${basename(path)}`)
    for (let n = 2; existsSync(directory); n += 1) directory = join(projectDir(root), "preserved", `gc-${basename(path)}.${String(n)}`)
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
