import { existsSync, lstatSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"
import { z } from "zod"
import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import type { RunOptions } from "../../shared/exec.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { git, nulPaths } from "../../shared/git.js"
import { cliPackageName } from "../version.js"

/**
 * How an app takes its `@starci` packages. The committed `package.json` files and `package-lock.json` always name npm
 * versions, which is what CI and production install. An unreleased package edit reaches an app one way, through the npm
 * registry on this machine (`./local-registry.ts`): `starci deps publish-local` builds the package and publishes it there under
 * a version of its own, and `starci deps install-local` installs that version into the app like npm and records the pins it
 * replaced, which `starci deps install-local --restore` puts back before a commit. Nothing is linked or copied into an
 * app's `node_modules`.
 */
export const SCOPE = "@starci/"

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

/** A package.json file read as a manifest. */
export const readManifest = (file: string): Manifest => parseManifest(readFileSync(file, "utf8"), file)

/** Whether a package name is a package of the harness: one of the `@starci` scope, or the CLI (`starci-harness`, named by its own manifest). */
export const isHarnessPackage = (name: string): boolean => name.startsWith(SCOPE) || name === cliPackageName()

/** One harness requirement (a `@starci` package or the CLI) a package.json makes: the package, its spec, the file and the field. */
export interface Pin {
    readonly name: string
    readonly spec: string
    readonly file: string
    readonly field: string
}

/** The harness requirements of one manifest, in its dependency fields. */
export const pinsOf = (manifest: Manifest, file: string): Pin[] =>
    DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {})
            .filter((entry): entry is [string, string] => isHarnessPackage(entry[0]) && typeof entry[1] === "string")
            .map(([name, spec]) => ({ name, spec, file, field })),
    )

/**
 * A package.json that is a manifest of the repository: not a vendored dependency (`node_modules`) and not a template or fixture file
 * (`templates/`, such as the harness's handlebars `package-scripts/package.json`, which is not JSON until it is rendered).
 */
export const isManifest = (file: string): boolean => {
    const segments = file.split("/")
    return posix.basename(file) === "package.json" && !segments.includes("node_modules") && !segments.includes("templates")
}

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

/** A package folder of the harness: its npm name, folder, version and whether it builds. */
export interface LocalPackage {
    readonly name: string
    readonly folder: string
    readonly version: string
    readonly builds: boolean
}

/** The name a package argument means: `grammar` and `@starci/grammar` are the same package; a name that is already a harness package's real name (`starci-harness`) stays as it is. */
export const packageName = (value: string): string => (isHarnessPackage(value) ? value : `${SCOPE}${value}`)

/** Refuses an app whose package manager is not npm: the local registry flow is written for npm's lockfile and `node_modules`. */
export const assertNpm = (root: string): void => {
    if (existsSync(join(root, "package-lock.json"))) return
    const other = ["pnpm-lock.yaml", "yarn.lock", "bun.lockb"].find((file) => existsSync(join(root, file)))
    if (other !== undefined) throw new Refusal("DEPS_MANAGER_UNSUPPORTED", `${other} found: the local registry flow is built for npm apps (package-lock.json); StarCi apps use npm workspaces`)
    throw new Refusal("DEPS_NO_LOCKFILE", `${root} has no package-lock.json; run it at the app root`)
}

/** The last lines of an npm run's output, for a refusal. */
export const tail = (stdout: string, stderr: string): string => [stdout, stderr].join("\n").trim().split("\n").slice(-15).join("\n")

// A package folder's install is stale when npm's record of it is missing or older than the lockfile it was made from.
const installStale = (folder: string): boolean => {
    const installed = join(folder, "node_modules", ".package-lock.json")
    const lock = join(folder, "package-lock.json")
    if (!existsSync(installed)) return true
    return existsSync(lock) && statSync(lock).mtimeMs > statSync(installed).mtimeMs
}

/** Installs receive process options only after proving node_modules is private, including after the governor's wait. */
const unlinkedInstallOptions = (folder: string, options: RunOptions = {}): RunOptions => {
    const modules = join(folder, "node_modules")
    if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink() !== true) return options
    throw new Refusal(
        "DEPS_INSTALL_LINKED",
        `${modules} is a junction or symlink; npm will not install dependencies through it because that would mutate the shared target. Materialize a private node_modules for this checkout, or unlink only the link itself and install this checkout's lockfile before retrying; keep the shared target intact`,
    )
}

/** Builds a package, installing missing or stale private dependencies; refuses DEPS_INSTALL_LINKED before reinstalling a linked install. */
export const buildPackage = async (pkg: LocalPackage): Promise<void> => {
    if (!pkg.builds) return
    if (installStale(pkg.folder)) {
        unlinkedInstallOptions(pkg.folder)
        const args = existsSync(join(pkg.folder, "package-lock.json")) ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"]
        const install = await withHeavySlot("install", `npm ${args[0] ?? "install"} ${pkg.name}`, pkg.folder, {}, (held) => captureNpm(args, pkg.folder, unlinkedInstallOptions(pkg.folder, held.options)))
        if (install.exitCode !== 0) throw new Refusal("DEPS_BUILD_FAILED", `npm install in ${pkg.folder} failed:\n${tail(install.stdout, install.stderr)}`)
    }
    const build = await withHeavySlot("build", `npm run build ${pkg.name}`, pkg.folder, {}, (held) => captureNpm(["run", "build"], pkg.folder, held.options))
    if (build.exitCode !== 0) throw new Refusal("DEPS_BUILD_FAILED", `npm run build in ${pkg.folder} failed:\n${tail(build.stdout, build.stderr)}`)
}

/** An npm run in the app root under the heavy governor, refusing DEPS_INSTALL_FAILED with its output when npm fails;. */
export const appNpm = async (root: string, args: readonly string[], label: string): Promise<void> => {
    unlinkedInstallOptions(root)
    const run = await withHeavySlot("install", label, root, {}, (held) => captureNpm(args, root, unlinkedInstallOptions(root, held.options)))
    if (run.exitCode !== 0) throw new Refusal("DEPS_INSTALL_FAILED", `${label} in ${root} failed:\n${tail(run.stdout, run.stderr)}`)
}
