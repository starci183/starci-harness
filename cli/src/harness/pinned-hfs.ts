import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { captureNpm, captureTool } from "../shared/exec.js"
import { evidenceTail } from "../shared/output.js"
import { mainCheckoutOf, runtimeRoot, stateBase } from "./ledger.js"

/**
 * The skeleton an app is judged against is the one of the @starci/hfs version the app pins and installs, never the CLI's
 * bundled hfs: a skeleton update reaches an app only when the app raises its hfs (then `starci app sync`), never through a
 * check the harness runs. The pin is the version the app checkout's lockfile resolves for `node_modules/@starci/hfs` (the
 * hoisted copy, else the first nested one, as `starci-harness` brings it), else an exact version its package.json names. Its
 * files come from an installed copy at that version (the checkout's node_modules) or else from that exact published version,
 * unpacked once into `<state base>/cache/hfs/<version>`. A command check naming a path inside the CLI's own hfs (the harness
 * checkout's `packages/hfs`, or the copy the CLI installs) reads the same path inside the pinned copy (`toPinnedHfs`).
 */

const HFS = "@starci/hfs"
const LOCK_KEY = `node_modules/${HFS}`
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const

/** The pinned @starci/hfs of an app checkout: its version and the folder its files are read from. */
export interface PinnedHfs {
    readonly version: string
    readonly root: string
    readonly from: "installed" | "registry"
}

const readJson = (file: string): Record<string, unknown> | undefined => {
    try {
        const value = JSON.parse(readFileSync(file, "utf8")) as unknown
        return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
    } catch {
        return undefined
    }
}

const versionAt = (folder: string): string | undefined => {
    const version = readJson(join(folder, "package.json"))?.version
    return typeof version === "string" ? version : undefined
}

/** The @starci/hfs version the app checkout at `root` pins: its lockfile's resolution, else an exact package.json pin; undefined when neither names one. */
export const pinnedHfsVersion = (root: string): string | undefined => {
    const packages = readJson(join(root, "package-lock.json"))?.packages
    if (typeof packages === "object" && packages !== null) {
        const entries = Object.entries(packages as Record<string, unknown>)
            .filter(([key]) => key === LOCK_KEY || key.endsWith(`/${LOCK_KEY}`))
            .sort(([left], [right]) => left.length - right.length)
        for (const [, entry] of entries) {
            const version = (entry as Record<string, unknown> | null)?.version
            if (typeof version === "string") return version
        }
    }
    const manifest = readJson(join(root, "package.json"))
    for (const field of DEPENDENCY_FIELDS) {
        const spec = (manifest?.[field] as Record<string, unknown> | undefined)?.[HFS]
        if (typeof spec === "string" && EXACT.test(spec)) return spec
    }
    return undefined
}

/** The installed copies of @starci/hfs a checkout may hold, hoisted first, then the one `starci-harness` nests. */
const installedCopies = (root: string): string[] => [join(root, "node_modules", "@starci", "hfs"), join(root, "node_modules", "starci-harness", "node_modules", "@starci", "hfs")]

/** The folder the exact published `version` is unpacked into: `<state base>/cache/hfs/<version>/package`. */
export const hfsCachePath = (version: string): string => join(stateBase(), "cache", "hfs", version, "package")

/** Unpacks the exact published `version` of @starci/hfs into the cache, once; throws with npm's or tar's output when either fails. */
const fetchPublished = async (version: string): Promise<string> => {
    const target = hfsCachePath(version)
    if (versionAt(target) === version) return target
    const holder = dirname(target)
    const staging = `${holder}.tmp-${String(process.pid)}`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    try {
        const packed = await captureNpm(["pack", `${HFS}@${version}`, "--ignore-scripts", "--silent"], staging)
        const tarball = readdirSync(staging).find((name) => name.endsWith(".tgz"))
        if (packed.exitCode !== 0 || tarball === undefined) throw new Error(`npm pack ${HFS}@${version} failed: ${evidenceTail(packed.stdout, packed.stderr)}`)
        // tar runs inside the staging folder on a bare file name: a drive letter in an argument reads as a remote host to GNU tar.
        const unpacked = await captureTool("tar", ["-xzf", tarball], staging)
        if (unpacked.exitCode !== 0 || versionAt(join(staging, "package")) !== version) throw new Error(`unpacking ${tarball} failed: ${evidenceTail(unpacked.stdout, unpacked.stderr)}`)
        rmSync(join(staging, tarball), { force: true })
        rmSync(holder, { recursive: true, force: true })
        mkdirSync(dirname(holder), { recursive: true })
        renameSync(staging, holder)
    } finally {
        rmSync(staging, { recursive: true, force: true })
    }
    return target
}

/**
 * The pinned @starci/hfs of the app checkout at `root`: an installed copy at the pinned version, else the exact published
 * version from the cache. Throws when the checkout pins none, or the pinned version can be neither found nor fetched.
 */
export const pinnedHfs = async (root: string): Promise<PinnedHfs> => {
    const version = pinnedHfsVersion(root)
    if (version === undefined) throw new Error(`${root} pins no ${HFS} (no package-lock.json entry ${LOCK_KEY}, no exact package.json pin): there is no skeleton to judge against`)
    const installed = installedCopies(root).find((folder) => versionAt(folder) === version)
    if (installed !== undefined) return { version, root: installed, from: "installed" }
    return { version, root: await fetchPublished(version), from: "registry" }
}

const realOf = (path: string): string => {
    try {
        return realpathSync(path)
    } catch {
        return resolve(path)
    }
}

const canonical = (path: string): string => realOf(path).replaceAll("\\", "/").replace(/\/+$/, "")

/** The folders of the CLI's own @starci/hfs: the harness checkout's `packages/hfs` (its main checkout's too) and the copy the CLI installs. */
export const bundledHfsRoots = (): string[] => {
    const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
    const harness = runtimeRoot()
    const folders = [join(harness, "packages", "hfs"), join(mainCheckoutOf(harness), "packages", "hfs"), join(cli, "node_modules", "@starci", "hfs")]
    return [...new Set(folders.filter((folder) => existsSync(folder)).flatMap((folder) => [resolve(folder).replaceAll("\\", "/"), canonical(folder)]))]
}

/** The part of `path` below one of `roots` (with its leading slash, "" for the root itself), or undefined when it is under none. */
const below = (path: string, roots: readonly string[]): string | undefined => {
    if (!isAbsolute(path)) return undefined
    const plain = resolve(path).replaceAll("\\", "/")
    const fold = (text: string): string => (process.platform === "win32" ? text.toLowerCase() : text)
    for (const root of roots) {
        if (fold(plain) === fold(root)) return ""
        if (fold(plain).startsWith(`${fold(root)}/`)) return plain.slice(root.length)
    }
    return undefined
}

/** A command's argv with every path inside the CLI's own hfs read inside the app's pinned hfs, and the line saying which it read. */
export type PinnedArgv = { readonly argv: readonly string[]; readonly detail?: string } | { readonly problem: string }

/**
 * Reads every argument of `argv` that names a path inside the CLI's own @starci/hfs (`bundledHfsRoots`) at the same path inside
 * the pinned @starci/hfs of the app checkout at `root` (`pinnedHfs`), so a skeleton parity a contract spells as
 * `git diff --no-index --exit-code <harness>/packages/hfs/templates/be/skeleton/<dir> be/<dir>` judges the app's own skeleton.
 * An argv naming no such path is returned as it is, and a checkout whose pin cannot be read is a problem, never the CLI's copy.
 */
export const toPinnedHfs = async (argv: readonly string[], root: string): Promise<PinnedArgv> => {
    const roots = bundledHfsRoots()
    if (!argv.some((part) => below(part, roots) !== undefined)) return { argv }
    let pinned: PinnedHfs
    try {
        pinned = await pinnedHfs(root)
    } catch (error: unknown) {
        return { problem: `the command reads the CLI's own ${HFS}, and the app's pinned one cannot be read: ${error instanceof Error ? error.message : String(error)}` }
    }
    const at = pinned.root.replaceAll("\\", "/")
    const mapped = argv.map((part) => {
        const rest = below(part, roots)
        return rest === undefined ? part : `${at}${rest}`
    })
    return { argv: mapped, detail: `the ${HFS} paths it names are read in the app's pinned ${HFS} ${pinned.version} (${pinned.from === "installed" ? "installed" : "published"}, ${at}), never the CLI's own` }
}
