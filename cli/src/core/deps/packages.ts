import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, posix, relative, sep } from "node:path"
import { z } from "zod"
import { depsLocalPath, existingDepsLocalPath, runtimeRoot } from "../../harness/ledger.js"
import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { git, nulPaths } from "../../shared/git.js"

/**
 * How an app takes its `@starci` packages. The committed `package.json` files and `package-lock.json` always name npm
 * versions, which is what CI and production install. Local mode (`starci deps source --local`) is a local-only overlay for
 * npm, the one package manager StarCi apps use: it builds the package in its folder, asks npm which files it would publish
 * (`npm pack --dry-run`) and copies exactly those over every installed copy of the package in the app's `node_modules`
 * (the root and each workspace), with a marker file naming the folder. It never runs `npm install <folder>`, which would
 * rewrite the manifest or trip an `overrides` pin and leave the workspaces that require the npm version on a nested npm
 * copy, and it never links: a link resolves the package's peers (react) from its own folder, a second React, which is
 * why the harness's own packages install siblings with `install-links=true`. The record of which packages are local lives
 * in the project's state folder (`depsLocalPath`), so a clean-verify checkout of the same repository applies the same
 * copies after its `npm ci`. `npm ci` restores pure npm resolution and wipes every copy with its marker.
 */
export const SCOPE = "@starci/"

/** The file a local copy carries in its installed folder, naming where it came from; npm mode has none. */
export const LOCAL_MARKER = ".starci-local.json"

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"] as const

const manifestSchema = z.looseObject({
    name: z.string().optional(),
    version: z.string().optional(),
    scripts: z.record(z.string(), z.string()).optional(),
    dependencies: z.record(z.string(), z.unknown()).optional(),
    devDependencies: z.record(z.string(), z.unknown()).optional(),
    optionalDependencies: z.record(z.string(), z.unknown()).optional(),
    peerDependencies: z.record(z.string(), z.unknown()).optional(),
    overrides: z.record(z.string(), z.unknown()).optional(),
})

/** The fields of a package.json the deps verbs read. */
export type Manifest = z.infer<typeof manifestSchema>

const BYTE_ORDER_MARK = 0xfeff

/** A package.json's text read as a manifest; DEPS_MANIFEST_UNREADABLE names `where` when it is not one. */
export const parseManifest = (text: string, where: string): Manifest => {
    let raw: unknown
    try {
        raw = JSON.parse(text.codePointAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text)
    } catch {
        throw new Refusal("DEPS_MANIFEST_UNREADABLE", `${where} is not valid JSON`)
    }
    const parsed = manifestSchema.safeParse(raw)
    if (!parsed.success) throw new Refusal("DEPS_MANIFEST_UNREADABLE", `${where} is not a package manifest`)
    return parsed.data
}

const readManifest = (file: string): Manifest => parseManifest(readFileSync(file, "utf8"), file)

/** One `@starci` requirement a package.json makes: the package, its spec, the file and the field. */
export interface Pin {
    readonly name: string
    readonly spec: string
    readonly file: string
    readonly field: string
}

const pinsOf = (manifest: Manifest, file: string): Pin[] =>
    DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {})
            .filter((entry): entry is [string, string] => entry[0].startsWith(SCOPE) && typeof entry[1] === "string")
            .map(([name, spec]) => ({ name, spec, file, field })),
    )

const isManifest = (file: string): boolean => posix.basename(file) === "package.json" && !file.split("/").includes("node_modules")

/** The tracked package.json files of the repository, the root and every workspace, as repository paths. */
export const manifestFiles = async (root: string): Promise<string[]> => nulPaths(await git(root, ["ls-files", "-z"])).filter(isManifest)

/** The `@starci` pins of the tracked package.json files as the work tree holds them. */
export const workingPins = async (root: string): Promise<Pin[]> =>
    (await manifestFiles(root)).filter((file) => existsSync(join(root, file))).flatMap((file) => pinsOf(readManifest(join(root, file)), file))

/** The `@starci` pins of the package.json files committed at `revision`: what CI installs from that commit. */
export const committedPins = async (root: string, revision: string): Promise<Pin[]> => {
    const files = nulPaths(await git(root, ["ls-tree", "-r", "-z", "--name-only", revision])).filter(isManifest)
    const shown = await inOrder(files, async (file) => pinsOf(parseManifest(await git(root, ["show", `${revision}:${file}`]), `${revision}:${file}`), file))
    return shown.flat()
}

/** A package folder of the harness (or of `--from`): its npm name, folder, version and whether it builds. */
export interface LocalPackage {
    readonly name: string
    readonly folder: string
    readonly version: string
    readonly builds: boolean
}

/** Where the `@starci` package sources live by default: `packages/` of the harness this CLI runs from. */
export const defaultPackagesRoot = (): string => join(runtimeRoot(), "packages")

/** The `@starci` packages under `from`, by npm name; DEPS_FROM_MISSING when the folder does not exist. */
export const localPackages = (from: string): Map<string, LocalPackage> => {
    if (!existsSync(from)) throw new Refusal("DEPS_FROM_MISSING", `${from} does not exist; pass --from <folder holding the @starci package folders>`)
    const found = new Map<string, LocalPackage>()
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        const file = join(from, entry.name, "package.json")
        if (!entry.isDirectory() || !existsSync(file)) continue
        const manifest = readManifest(file)
        if (manifest.name?.startsWith(SCOPE) !== true || manifest.version === undefined) continue
        found.set(manifest.name, { name: manifest.name, folder: join(from, entry.name), version: manifest.version, builds: manifest.scripts?.build !== undefined })
    }
    return found
}

/** The name a `--package` value means: `grammar` and `@starci/grammar` are the same package. */
export const packageName = (value: string): string => (value.startsWith(SCOPE) ? value : `${SCOPE}${value}`)

/** Refuses an app whose package manager is not npm: the local overlay is written for npm's `node_modules` and `npm ci`. */
export const assertNpm = (root: string): void => {
    if (existsSync(join(root, "package-lock.json"))) return
    const other = ["pnpm-lock.yaml", "yarn.lock", "bun.lockb"].find((file) => existsSync(join(root, file)))
    if (other !== undefined) throw new Refusal("DEPS_MANAGER_UNSUPPORTED", `${other} found: the local package source is built for npm apps (package-lock.json); StarCi apps use npm workspaces`)
    throw new Refusal("DEPS_NO_LOCKFILE", `${root} has no package-lock.json; run it at the app root`)
}

const markSchema = z.object({ schema: z.literal("starci/deps-local-copy@1"), name: z.string(), version: z.string(), folder: z.string(), copiedAt: z.string() })

/** What the marker of a local copy says. */
export type LocalMark = z.infer<typeof markSchema>

/** One installed copy of a `@starci` package in the app: its folder (repository path), version, and the marker when it is local. */
export interface Install {
    readonly name: string
    readonly dir: string
    readonly version: string | undefined
    readonly local: LocalMark | undefined
}

const slashed = (path: string): string => path.split(sep).join("/")

const readMark = (dir: string): LocalMark | undefined => {
    const file = join(dir, LOCAL_MARKER)
    if (!existsSync(file)) return undefined
    const parsed = markSchema.safeParse(JSON.parse(readFileSync(file, "utf8")))
    return parsed.success ? parsed.data : undefined
}

/** The folders a package is (or would be) installed in: `node_modules` of the root and of each workspace holding a manifest. */
const installDirs = (root: string, manifests: readonly string[], name: string): string[] =>
    [...new Set(["", ...manifests.map((file) => posix.dirname(file)).filter((dir) => dir !== ".")])].map((base) => join(root, base, "node_modules", ...name.split("/")))

/** Every installed copy of the named packages, at the root and in each workspace's own node_modules. */
export const installsOf = (root: string, manifests: readonly string[], names: readonly string[]): Install[] =>
    names.flatMap((name) =>
        installDirs(root, manifests, name)
            .filter((dir) => existsSync(dir))
            .map((dir) => {
                const file = join(dir, "package.json")
                return { name, dir: slashed(relative(root, dir)), version: existsSync(file) ? readManifest(file).version : undefined, local: readMark(dir) }
            }),
    )

const tail = (stdout: string, stderr: string): string => [stdout, stderr].join("\n").trim().split("\n").slice(-15).join("\n")

/** Builds a package in its folder (`npm ci` first when it has no node_modules); DEPS_BUILD_FAILED with the output's tail. */
export const buildPackage = async (pkg: LocalPackage): Promise<void> => {
    if (!pkg.builds) return
    if (!existsSync(join(pkg.folder, "node_modules"))) {
        const install = await captureNpm(existsSync(join(pkg.folder, "package-lock.json")) ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"], pkg.folder)
        if (install.exitCode !== 0) throw new Refusal("DEPS_BUILD_FAILED", `npm install in ${pkg.folder} failed:\n${tail(install.stdout, install.stderr)}`)
    }
    const build = await captureNpm(["run", "build"], pkg.folder)
    if (build.exitCode !== 0) throw new Refusal("DEPS_BUILD_FAILED", `npm run build in ${pkg.folder} failed:\n${tail(build.stdout, build.stderr)}`)
}

const packSchema = z.array(z.object({ files: z.array(z.object({ path: z.string() })) })).min(1)

/** The files npm would publish from a package folder, as it stands (no lifecycle script runs). */
const packFiles = async (folder: string): Promise<string[]> => {
    const run = await captureNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], folder)
    let raw: unknown
    try {
        raw = JSON.parse(run.stdout)
    } catch {
        raw = undefined
    }
    const parsed = packSchema.safeParse(raw)
    if (run.exitCode !== 0 || !parsed.success) throw new Refusal("DEPS_PACK_FAILED", `npm pack --dry-run in ${folder} failed:\n${tail(run.stdout, run.stderr)}`)
    return parsed.data[0]?.files.map((file) => file.path) ?? []
}

/** Whether `dependency` resolves from `dir` the way Node walks up node_modules, without leaving `root`. */
const resolvable = (dependency: string, dir: string, root: string): boolean => {
    let at = dir
    for (;;) {
        if (existsSync(join(at, "node_modules", ...dependency.split("/"), "package.json"))) return true
        if (relative(root, at) === "") return false
        const parent = dirname(at)
        if (parent === at) return false
        at = parent
    }
}

/** What one package's local copy did: where it came from, where it went, how many files, and what to look at. */
export interface Copied {
    readonly name: string
    readonly folder: string
    readonly version: string
    readonly targets: readonly string[]
    readonly files: number
    readonly warnings: readonly string[]
}

/**
 * Copies a package folder's publishable files over every installed copy of it in the app (the root's when none is
 * installed), each with its marker. A copy that is a link (a junction or symlink someone made) is refused
 * DEPS_TARGET_LINKED rather than followed: removing through a link would delete the folder it points at.
 */
export const copyLocal = async (root: string, manifests: readonly string[], pkg: LocalPackage): Promise<Copied> => {
    const files = await packFiles(pkg.folder)
    const installed = installDirs(root, manifests, pkg.name).filter((dir) => existsSync(dir))
    const targets = installed.length > 0 ? installed : [join(root, "node_modules", ...pkg.name.split("/"))]
    for (const target of targets) {
        if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
            throw new Refusal("DEPS_TARGET_LINKED", `${target} is a link; remove it (or run starci deps source --npm) before copying ${pkg.name} over it`)
        }
    }
    for (const target of targets) {
        rmSync(target, { recursive: true, force: true })
        for (const file of files) {
            mkdirSync(dirname(join(target, file)), { recursive: true })
            copyFileSync(join(pkg.folder, file), join(target, file))
        }
        const mark: LocalMark = { schema: "starci/deps-local-copy@1", name: pkg.name, version: pkg.version, folder: slashed(pkg.folder), copiedAt: new Date().toISOString() }
        writeFileSync(join(target, LOCAL_MARKER), `${JSON.stringify(mark, null, 2)}\n`)
    }
    const manifest = readManifest(join(pkg.folder, "package.json"))
    const missing = Object.keys(manifest.dependencies ?? {}).filter((dependency) => !targets.every((target) => resolvable(dependency, target, root)))
    const warnings = missing.map((dependency) => `${pkg.name} ${pkg.version} depends on ${dependency}, which the app has not installed; publish the package and raise the pin, or install ${dependency} in the app`)
    return { name: pkg.name, folder: slashed(pkg.folder), version: pkg.version, targets: targets.map((target) => slashed(relative(root, target))), files: files.length, warnings }
}

const recordSchema = z.object({
    schema: z.literal("starci/deps-local@1"),
    packages: z.array(z.object({ name: z.string(), folder: z.string() })),
})

/** The local package-source record of a repository: the packages its installs copy from a folder. */
export type LocalRecord = z.infer<typeof recordSchema>

/** The repository's local record, or undefined in npm mode (no record, or the host registry does not know the repository). */
export const readRecord = (root: string): LocalRecord | undefined => {
    const file = existingDepsLocalPath(root)
    if (file === undefined || !existsSync(file)) return undefined
    const parsed = recordSchema.safeParse(JSON.parse(readFileSync(file, "utf8")))
    if (!parsed.success) throw new Refusal("DEPS_RECORD_UNREADABLE", `${file} is not a starci/deps-local@1 record; run starci deps source --npm to clear it`)
    return parsed.data
}

/** Writes the repository's local record (merged by the caller). */
export const writeRecord = (root: string, packages: LocalRecord["packages"]): string => {
    const file = depsLocalPath(root)
    const record: LocalRecord = { schema: "starci/deps-local@1", packages: [...packages].sort((left, right) => left.name.localeCompare(right.name)) }
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
    return file
}

/** Removes the repository's local record: the repository is back in npm mode. */
export const clearRecord = (root: string): void => {
    const file = existingDepsLocalPath(root)
    if (file !== undefined) rmSync(file, { force: true })
}

/** What re-applying a repository's local sources to another of its checkouts did; undefined when the repository is in npm mode. */
export interface Reapplied {
    readonly status: "green" | "red"
    readonly detail: string
}

/**
 * Applies the repository's recorded local sources (`source` is any checkout of it) to `checkout`, another checkout that
 * has just run `npm ci`: each recorded folder is copied as it stands, without building, so a clean verify runs against
 * the same unpublished package the work tree does.
 */
export const reapplyLocal = async (source: string, checkout: string): Promise<Reapplied | undefined> => {
    const record = readRecord(source)
    if (record === undefined || record.packages.length === 0) return undefined
    const manifests = await manifestFiles(checkout)
    try {
        const copied = await inOrder(record.packages, (entry) => {
            const pkg = localPackages(dirname(entry.folder)).get(entry.name)
            if (pkg === undefined) throw new Refusal("DEPS_FROM_MISSING", `${entry.folder} no longer holds ${entry.name}`)
            return copyLocal(checkout, manifests, pkg)
        })
        return { status: "green", detail: copied.map((one) => `${one.name} ${one.version} from ${one.folder} into ${one.targets.join(", ")}${one.warnings.map((warning) => `\n  warning: ${warning}`).join("")}`).join("\n") }
    } catch (error: unknown) {
        return { status: "red", detail: `the repository is in local package mode (starci deps source) but its copy failed: ${error instanceof Error ? error.message : String(error)}` }
    }
}
