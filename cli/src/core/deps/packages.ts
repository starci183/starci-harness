import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, posix, resolve } from "node:path"
import { z } from "zod"
import { installSatisfies } from "../../harness/install-cache.js"
import { inOrder } from "../../harness/sequential.js"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import type { RunOptions, ToolRun } from "../../shared/exec.js"
import { redactSecrets } from "../../shared/secrets.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { installHazard } from "../../harness/install-guard.js"
import { git, nulPaths } from "../../shared/git.js"
import { cliPackageName } from "../version.js"

/**
 * How an app takes its `@starci` packages. The committed `package.json` files and `package-lock.json` always name npm
 * versions, which is what CI and production install. An unreleased package edit reaches an app one way, through the npm
 * registry on this machine (`./local-registry.ts`): `starci deps publish-local` builds the package and publishes it there under
 * the version committed in git, and `starci deps install-local` installs that version into the app like npm and records the pins it
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

/** A line of output that says nothing about why a run failed: a blank line, or a stack frame inside node's own runtime (`node:internal/...`). */
const NO_CAUSE = /^\s*$|^\s*at (?:async )?(?:.* \()?node:/

/** A line that names why a run failed: a failed test (`node --test`'s cross, TAP's `not ok`), a TypeScript error or a thrown error's first line. */
const CAUSE = /✖|^\s*not ok\b|error TS\d+|^\s*(?:\w*Error|Error \[ERR_\w+\])[:\s]/u

/** npm's own closing lines (`npm error code 1`, the log path), which repeat that a script failed and never why. */
const NPM_NOISE = /^npm (?:error|ERR!)/u

/**
 * The lines of an npm run's output that can say why it failed, for a refusal or a gate finding: its last 15, led by up to 10 lines above them that name a cause.
 * A lifecycle script that failed (a prepack's typecheck, build or tests) prints its cause far above npm's closing lines, which alone name no cause. Pure.
 */
export const tail = (stdout: string, stderr: string): string => {
    const lines = [stdout, stderr].join("\n").split("\n").filter((line) => !NO_CAUSE.test(line))
    const causes = lines.slice(0, -15).filter((line) => CAUSE.test(line) && !NPM_NOISE.test(line)).slice(0, 10)
    return [...causes, ...(causes.length > 0 ? ["..."] : []), ...lines.slice(-15)].join("\n")
}

/**
 * A package folder's install is stale when it does not hold the lockfile's packages. npm's record of the install (read through the folder's
 * `node_modules`, a junction or link to a cached install included) is compared with the lockfile, package by package (`installSatisfies`): a
 * checkout whose lockfile was written after the install it links (a fresh worktree) is not stale while the packages match, so a linked install
 * is built against, never reinstalled through. Only when the comparison cannot be made (no record or no lockfile) does the record's age against
 * the lockfile decide.
 */
export const installStale = (folder: string): boolean => {
    const satisfied = installSatisfies(folder)
    if (satisfied !== undefined) return !satisfied
    const installed = join(folder, "node_modules", ".package-lock.json")
    const lock = join(folder, "package-lock.json")
    if (!existsSync(installed)) return true
    return existsSync(lock) && statSync(lock).mtimeMs > statSync(installed).mtimeMs
}

/**
 * Installs receive process options only after proving node_modules is private, including after the governor's wait: neither a link
 * (DEPS_INSTALL_LINKED) nor a real folder another worktree links to (DEPS_INSTALL_SHARED), the install guard's two hazards (harness/install-guard.ts).
 */
const unlinkedInstallOptions = (folder: string, options: RunOptions = {}): RunOptions => {
    const modules = join(folder, "node_modules")
    if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        throw new Refusal(
            "DEPS_INSTALL_LINKED",
            `${modules} is a junction or symlink; npm will not install dependencies through it because that would mutate the shared target. Materialize a private node_modules for this checkout, or unlink only the link itself and install this checkout's lockfile before retrying; keep the shared target intact`,
        )
    }
    const hazard = installHazard(folder)
    if (hazard !== undefined) throw new Refusal("DEPS_INSTALL_SHARED", hazard.message)
    return options
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex")

/** The tracked files of a package folder, each with the line its digest holds (see sourceDigest), in digest order. */
const sourceLines = async (root: string, relativeDir: string): Promise<{ readonly file: string; readonly line: string }[]> => {
    const staged = nulPaths(await git(root, ["ls-files", "-s", "-z", "--", relativeDir]))
    const modified = new Set(nulPaths(await git(root, ["ls-files", "-m", "-z", "--", relativeDir])))
    return staged
        .map((entry) => {
            const tab = entry.indexOf("\t")
            const blob = entry.slice(0, tab).split(" ")[1] ?? ""
            const file = entry.slice(tab + 1)
            if (!modified.has(file)) return { file, line: `${file}\0${blob}` }
            try {
                return { file, line: `${file}\0work:${sha256(readFileSync(join(root, file)))}` }
            } catch {
                return { file, line: `${file}\0removed` }
            }
        })
        .toSorted((left, right) => left.line.localeCompare(right.line))
}

/**
 * The digest of a package's source: every tracked file of its folder by path and content. A file the work tree holds as git does is named by its blob, so a clean
 * tree digests to the same value on every host for one commit; a file the work tree changed (or removed) is named by its bytes, so a dirty build never claims
 * the digest of the commit it started from.
 */
export const sourceDigest = async (root: string, relativeDir: string): Promise<string> => sha256((await sourceLines(root, relativeDir)).map((entry) => entry.line).join("\n"))

/** A pure-data file of a package that the check cache keys as a part of its own: the part's name and the file's path inside the package. */
export interface SourceSplit {
    readonly name: string
    readonly file: string
}

/**
 * The digest of a package's source split into the parts a data file makes: `core` is every tracked file but the named ones (the same lines as sourceDigest), and
 * each named file has its own digest under its part name (`absent` when the package does not track it). The check cache keys a data file that only a few hfs rules
 * read as a part of its own, so a change of it never makes the rest of the package look changed (`@starci/hfs` `cache/fingerprint.mts` SPLIT_PARTS).
 * `sourceDigest` stays the digest of the whole, the one the publish judgement compares, so a change of the data file still republishes the package.
 */
export const sourceDigestParts = async (root: string, relativeDir: string, split: readonly SourceSplit[]): Promise<Readonly<Record<string, string>>> => {
    const lines = await sourceLines(root, relativeDir)
    const folder = relativeDir.replaceAll("\\", "/").replace(/\/+$/u, "").replace(/^\.$/u, "")
    const named = new Map(split.map(({ name, file }) => [folder === "" ? file : `${folder}/${file}`, name]))
    const parts: Record<string, string> = { core: sha256(lines.filter((entry) => !named.has(entry.file)).map((entry) => entry.line).join("\n")) }
    for (const { name } of split) parts[name] = "absent"
    for (const entry of lines) {
        const name = named.get(entry.file)
        if (name !== undefined) parts[name] = sha256(entry.line)
    }
    return parts
}

/** Where an install records the digest of the `file:` siblings it copied (fileCopiesDigest). */
const FILE_COPIES_RECORD = ".starci-file-copies"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The `file:` siblings a folder's lockfile installs as copies (npm's `install-links=true`, which the harness packages' `.npmrc` sets): the package name to the
 * sibling's folder. A sibling installed as a junction or symlink is live and never listed. Reads the lockfile and node_modules only.
 */
export const fileCopies = (folder: string): ReadonlyMap<string, string> => {
    const copies = new Map<string, string>()
    let lock: unknown
    try {
        lock = JSON.parse(readFileSync(join(folder, "package-lock.json"), "utf8"))
    } catch {
        return copies
    }
    const packages = isRecord(lock) && isRecord(lock.packages) ? lock.packages : {}
    for (const [key, entry] of Object.entries(packages)) {
        const name = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/u.exec(key)?.[1]
        const resolved = isRecord(entry) && typeof entry.resolved === "string" ? entry.resolved : ""
        if (name === undefined || !resolved.startsWith("file:")) continue
        const installed = lstatSync(join(folder, "node_modules", name), { throwIfNoEntry: false })
        if (installed === undefined || installed.isSymbolicLink()) continue
        copies.set(name, resolve(folder, resolved.slice("file:".length)))
    }
    return copies
}

/**
 * The digest of the sources of a folder's `file:` copies (sourceDigest of each sibling), or undefined when it installs none. A copy is a snapshot of its sibling
 * taken at install time, and the lockfile names it the same however far the sibling moved since, so the lockfile comparison of installStale never sees it age:
 * `@starci/eslint-canon-fe`'s copy of `@starci/hfs` stayed at the build it was installed with, and its prepack tests failed on a module hfs gained later.
 */
export const fileCopiesDigest = async (folder: string): Promise<string | undefined> => {
    const copies = [...fileCopies(folder)].toSorted(([left], [right]) => left.localeCompare(right))
    if (copies.length === 0) return undefined
    const parts = await inOrder(copies, async ([name, sibling]) => `${name}\0${existsSync(sibling) ? await sourceDigest(sibling, ".") : "missing"}`)
    return sha256(parts.join("\n"))
}

/** The digest the folder's last install recorded for its `file:` copies; undefined when none was recorded. */
const recordedCopies = (folder: string): string | undefined => {
    try {
        return readFileSync(join(folder, "node_modules", FILE_COPIES_RECORD), "utf8").trim()
    } catch {
        return undefined
    }
}

/** Whether a private install's `file:` copies are older than their siblings' sources; never for a linked or shared install, which this CLI does not reinstall. */
export const copiesStale = async (folder: string): Promise<{ readonly stale: boolean; readonly digest: string | undefined }> => {
    if (lstatSync(join(folder, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink() === true || installHazard(folder) !== undefined) return { stale: false, digest: undefined }
    const digest = await fileCopiesDigest(folder)
    return { stale: digest !== undefined && digest !== recordedCopies(folder), digest }
}

/**
 * Installs a package folder's private dependencies when they are missing or stale, its `file:` copies included (`npm ci`, else `npm install`), and records the
 * digest of the copies it installed; refuses DEPS_INSTALL_LINKED before reinstalling a linked install.
 */
export const installPackage = async (pkg: Pick<LocalPackage, "name" | "folder">): Promise<void> => {
    const copies = await copiesStale(pkg.folder)
    if (!installStale(pkg.folder) && !copies.stale) return
    unlinkedInstallOptions(pkg.folder)
    const args = existsSync(join(pkg.folder, "package-lock.json")) ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"]
    const install = await withHeavySlot("install", `npm ${args[0] ?? "install"} ${pkg.name}`, pkg.folder, {}, (held) => captureNpm(args, pkg.folder, unlinkedInstallOptions(pkg.folder, held.options)))
    if (install.exitCode !== 0) throw new Refusal("DEPS_BUILD_FAILED", `npm install in ${pkg.folder} failed:\n${tail(install.stdout, install.stderr)}`)
    if (copies.digest !== undefined) writeFileSync(join(pkg.folder, "node_modules", FILE_COPIES_RECORD), `${copies.digest}\n`)
}

/** Builds a package, installing missing or stale private dependencies; refuses DEPS_INSTALL_LINKED before reinstalling a linked install. */
export const buildPackage = async (pkg: LocalPackage): Promise<void> => {
    if (!pkg.builds) return
    await installPackage(pkg)
    const build = await withHeavySlot("build", `npm run build ${pkg.name}`, pkg.folder, {}, (held) => captureNpm(["run", "build"], pkg.folder, held.options))
    if (build.exitCode !== 0) throw new Refusal("DEPS_BUILD_FAILED", `npm run build in ${pkg.folder} failed:\n${tail(build.stdout, build.stderr)}`)
}

/** An npm run in the app root under the heavy governor, refusing DEPS_INSTALL_FAILED with how it ended and why (`npmFailure`) when npm fails. */
export const appNpm = async (root: string, args: readonly string[], label: string): Promise<void> => {
    unlinkedInstallOptions(root)
    const run = await withHeavySlot("install", label, root, {}, (held) => captureNpm(args, root, unlinkedInstallOptions(root, held.options)))
    if (run.exitCode !== 0) throw new Refusal("DEPS_INSTALL_FAILED", npmFailure(label, root, run))
}

/** The line npm prints with the path of its debug log. */
const NPM_LOG = /complete log of this run can be found in:?\s*(\S.*?)\s*$/mu

/** A line that says why an npm run failed: npm's own error lines (`npm error code ENOSPC`, `npm ERR! errno -4048`) or a thrown error's first line. */
const NPM_CAUSE = /^npm (?:error|ERR!) (?!A complete log)\S|^\s*(?:\w*Error|Error \[ERR_\w+\])[:\s]|\b(?:ENOSPC|ENOMEM|EPERM|EBUSY|ENOTEMPTY|EACCES|ETIMEDOUT|ECONNREFUSED|ECONNRESET|E404|E401|E403)\b/u

/** The last lines of npm's debug log named in its output that say an error, else its last lines; empty when none is named or it cannot be read. */
const npmLogTail = (output: string, read: (file: string) => string | undefined): { readonly file: string; readonly lines: readonly string[] } | undefined => {
    const file = NPM_LOG.exec(output)?.[1]
    if (file === undefined) return undefined
    const text = read(file)
    if (text === undefined) return undefined
    const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== "")
    const errors = lines.filter((line) => /\b(?:error|ERR!)\b/u.test(line))
    return { file, lines: (errors.length > 0 ? errors : lines).slice(-12) }
}

const readIfThere = (file: string): string | undefined => {
    try {
        return readFileSync(file, "utf8")
    } catch {
        return undefined
    }
}

/**
 * The refusal text of a failed npm run. Its first line says how it ended and why, since a status or a runner log keeps only that line: the exit code, a kill
 * past its time budget (heavy.timeoutMinutes of ops/liveness.yaml), the first line of its output that names a cause, or that it printed nothing (killed from
 * outside, out of memory). Then the tail of its output and of npm's debug log when its output names one. Every value a secret rule recognises is redacted.
 */
export const npmFailure = (label: string, root: string, run: Pick<ToolRun, "exitCode" | "stdout" | "stderr" | "timedOut">, read: (file: string) => string | undefined = readIfThere): string => {
    const output = `${run.stdout}\n${run.stderr}`
    const shown = tail(run.stdout, run.stderr).trim()
    const cause = output.split(/\r?\n/u).map((line) => line.trim()).find((line) => NPM_CAUSE.test(line))
    const why = run.timedOut
        ? "killed past its time budget (heavy.timeoutMinutes of ops/liveness.yaml), its process tree ended"
        : (cause ?? (shown === "" ? "npm printed nothing (ended from outside, or out of memory)" : (shown.split("\n").at(-1) ?? "")))
    const log = npmLogTail(output, read)
    const lines = [`${label} in ${root} exited ${String(run.exitCode)}: ${why.slice(0, 300)}`, ...(shown === "" ? [] : [shown]), ...(log === undefined ? [] : [`npm's log ${log.file}:`, ...log.lines])]
    return redactSecrets(lines.join("\n"))
}
