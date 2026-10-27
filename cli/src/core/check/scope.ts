import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { parse } from "yaml"
import { runtimeRoot } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import type { RunOptions, ToolRun } from "../../shared/exec.js"
import { changedFiles, git, nulPaths, refExists, repositoryRoot } from "../../shared/git.js"
import { ESLINT_CONFIGS, listPackages, ownerOf } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { CONFIG_FILES } from "./canon.js"
import { braceVariants } from "./sonar-scope.js"

/** One package the check touches and the changed files it owns. */
export interface ScopeTarget {
    readonly pkg: WorkspacePackage
    readonly files: readonly string[]
}

/**
 * The scope decision written before any check runs (owner ruling scope-before-check): `files` are what the checks judge, the
 * `changed` files of the diff, or, when the diff changes nothing, the tracked files under the `paths` a verify-only task proves.
 */
export interface Scope {
    readonly root: string
    readonly base: string
    readonly all: boolean
    readonly changed: readonly string[]
    readonly paths: readonly string[]
    readonly files: readonly string[]
    readonly targets: readonly ScopeTarget[]
    readonly skipped: readonly string[]
}

/** The result of one check step on one package. */
export interface StepResult {
    readonly package: string
    readonly step: "typecheck" | "lint" | "canon" | "secrets" | "loosening" | "unit"
    readonly command: string
    readonly status: "green" | "red" | "skipped"
    readonly reason: string
    readonly output: string
}

/**
 * The app-root slots of contexts/hfs/slots.yaml every side's check reads: the declaration (the lint factories read its
 * grammar and sides), the package manifest and lockfile, and the line-ending, tool, format and task-graph configuration.
 */
const APP_WIDE_SLOTS: readonly string[] = ["app.declaration", "app.package-manifest", "app.lockfile", "app.gitattributes", "app.tool-config", "app.tool-config-optional", "app.tool-config-local", "app.format-config", "app.task-graph"]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A root file name pattern (`*` stays in the name) as regular expression source. */
const nameSource = (name: string): string => name.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join("[^/]*")

/**
 * The repository-root files whose change reaches every package that reads them, so every package: the root paths of the
 * app-wide slots and every config file name of a canon tool (canon.ts CONFIG_FILES). A listed slot the manifest lacks is
 * refused, so a renamed slot never narrows the widening silently.
 */
const appWideFiles = (): RegExp => {
    const file = join(runtimeRoot(), "contexts", "hfs", "slots.yaml")
    if (!existsSync(file)) throw new Refusal("CONTEXTS_NOT_FOUND", `no contexts/hfs/slots.yaml under ${runtimeRoot()}`)
    const parsed: unknown = parse(readFileSync(file, "utf8"))
    const slots = isRecord(parsed) && Array.isArray(parsed.slots) ? parsed.slots.filter(isRecord) : []
    const paths = APP_WIDE_SLOTS.flatMap((id) => {
        const path = slots.find((slot) => slot.id === id)?.path
        if (typeof path !== "string") throw new Refusal("SLOTS_INVALID", `contexts/hfs/slots.yaml has no slot ${id} with a path`)
        return braceVariants(path).filter((variant) => !variant.includes("/"))
    })
    const names = [...new Set([...paths, ...Object.values(CONFIG_FILES).flat()])]
    return new RegExp(`^(?:${names.map(nameSource).join("|")})$`)
}

const LINTABLE = /\.(?:[cm]?[jt]sx?)$/

const OUTPUT_LINES = 60

const toSlash = (path: string): string => path.split(sep).join("/")

/** The tracked files under the given repository paths, NUL-separated so no path is quoted or cut. */
const trackedUnder = async (root: string, paths: readonly string[]): Promise<string[]> =>
    paths.length === 0 ? [] : nulPaths(await git(root, ["ls-files", "-z", "--", ...paths.map((path) => `:(top,literal)${path}`)]))

/**
 * Decides what to check: every package with --all, else the packages that own a judged file, the changed ones or, when the
 * diff changes nothing, the tracked files under `paths`; an app-wide configuration file widens to all. A diff and paths both empty leave
 * no package, so nothing runs.
 */
export const resolveScope = async (cwd: string, baseFlag: string | undefined, all: boolean, paths: readonly string[] = []): Promise<Scope> => {
    const root = await repositoryRoot(cwd)
    const base = baseFlag ?? ((await refExists(root, "origin/main")) ? "origin/main" : "HEAD")
    if (!(await refExists(root, base))) throw new Refusal("CHECK_BASE_UNKNOWN", `the base ${base} does not exist here`)
    const packages = listPackages(root)
    if (packages.length === 0) throw new Refusal("CHECK_NO_PACKAGE", `no package.json with a name and version under ${root}`)
    const changed = await changedFiles(root, base)
    const files = changed.length === 0 ? await trackedUnder(root, paths) : changed
    const appWide = appWideFiles()
    const widen = all || files.some((file) => appWide.test(file))
    const owned = new Map<WorkspacePackage, string[]>()
    const skipped: string[] = []
    for (const file of files) {
        const owner = ownerOf(packages, file)
        if (owner === undefined) skipped.push(file)
        else owned.set(owner, [...(owned.get(owner) ?? []), file])
    }
    const targets = widen ? packages.map((pkg) => ({ pkg, files: owned.get(pkg) ?? [] })) : [...owned.entries()].map(([pkg, files]) => ({ pkg, files }))
    return { root, base, all: widen, changed, paths, files, targets, skipped }
}

/** The package's own copy of a tool script, else the repository root's. */
const localBin = (scope: Scope, pkg: WorkspacePackage, relativeScript: string): string | undefined =>
    [join(pkg.dir, "node_modules", relativeScript), join(scope.root, "node_modules", relativeScript)].find((candidate) => existsSync(candidate))

const tail = (run: ToolRun): string => [run.stdout, run.stderr].filter((text) => text !== "").join("\n").split("\n").slice(-OUTPUT_LINES).join("\n")

const skipped = (pkg: WorkspacePackage, step: StepResult["step"], reason: string): StepResult => ({ package: pkg.name, step, command: "-", status: "skipped", reason, output: "" })

/** `tsc --noEmit` over the package's own tsconfig, within the runtime tier's deadline when one is given. */
export const typecheckPackage = async (scope: Scope, target: ScopeTarget, options: RunOptions = {}): Promise<StepResult> => {
    const { pkg } = target
    if (!pkg.hasTsconfig) return skipped(pkg, "typecheck", "no tsconfig.json")
    if (pkg.workspaceRoot) return skipped(pkg, "typecheck", "workspace root: its members are typechecked")
    const tsc = localBin(scope, pkg, join("typescript", "bin", "tsc"))
    if (tsc === undefined) return skipped(pkg, "typecheck", "typescript is not installed (run npm ci)")
    const run = await captureTool(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit"], pkg.dir, options)
    return { package: pkg.name, step: "typecheck", command: "tsc -p tsconfig.json --noEmit", status: run.exitCode === 0 ? "green" : "red", reason: "", output: tail(run) }
}



/**
 * The flat config ESLint itself resolves for a package folder: the nearest `eslint.config.*` from the folder upward, stopping at
 * the repository root. Undefined when no folder on the way holds one.
 */
export const resolveEslintConfig = (root: string, dir: string): { readonly dir: string; readonly file: string } | undefined => {
    for (let current = dir; ; current = dirname(current)) {
        const file = ESLINT_CONFIGS.find((name) => existsSync(join(current, name)))
        if (file !== undefined) return { dir: current, file }
        if (resolve(current) === resolve(root) || dirname(current) === current) return undefined
    }
}

/** Whether the package has any source ESLint would judge: a judged file of the target, or with --all a tracked source file under its folder. */
const hasSource = async (scope: Scope, target: ScopeTarget): Promise<boolean> => {
    if (target.files.some((file) => LINTABLE.test(file))) return true
    if (!scope.all) return false
    const under = target.pkg.relativeDir === "." ? [] : [target.pkg.relativeDir]
    return (await trackedUnder(scope.root, under)).some((file) => LINTABLE.test(file))
}

/** ESLint over the judged source files of the package with the nearest config up to the repository root (every file with --all), warnings counted as errors. */
export const lintPackage = async (scope: Scope, target: ScopeTarget, options: RunOptions = {}): Promise<StepResult> => {
    const { pkg } = target
    const config = resolveEslintConfig(scope.root, pkg.dir)
    if (config === undefined) {
        if (!(await hasSource(scope, target))) return skipped(pkg, "lint", "no source file and no eslint.config.*")
        return { package: pkg.name, step: "lint", command: "-", status: "red", reason: "LINT_CONFIG_MISSING: source files and no eslint.config.* in the package or any folder up to the repository root", output: "" }
    }
    const eslint = [pkg.dir, config.dir, scope.root].map((dir) => join(dir, "node_modules", "eslint", "bin", "eslint.js")).find((candidate) => existsSync(candidate))
    if (eslint === undefined) return skipped(pkg, "lint", "eslint is not installed (run npm ci)")
    const prefix = pkg.relativeDir === "." ? "" : `${pkg.relativeDir}/`
    const files = target.files.filter((file) => LINTABLE.test(file) && existsSync(join(scope.root, file))).map((file) => file.slice(prefix.length))
    if (!scope.all && files.length === 0) return skipped(pkg, "lint", "no judged source file")
    // ESLint runs in the folder of the config it resolved, so the config's file globs and ignores match the package's files.
    const fromConfig = toSlash(relative(config.dir, pkg.dir))
    const rooted = (path: string): string => (fromConfig === "" ? path : path === "." ? fromConfig : `${fromConfig}/${path}`)
    const paths = (scope.all ? ["."] : files).map(rooted)
    const run = await captureTool(process.execPath, [eslint, "--max-warnings=0", ...paths], config.dir, options)
    const counted = scope.all ? "whole package" : `${String(files.length)} file(s)`
    return { package: pkg.name, step: "lint", command: `eslint --max-warnings=0 ${paths.join(" ")}`, status: run.exitCode === 0 ? "green" : "red", reason: `config ${relative(scope.root, join(config.dir, config.file)).split(sep).join("/")}, ${counted} linted`, output: tail(run) }
}

/** The parenthesised reason of a step, empty when it has none. */
const reasonSuffix = (reason: string): string => (reason === "" ? "" : " (" + reason + ")")

/** One line per step for human output. */
export const describeStep = (step: StepResult): string => `${step.status.padEnd(7)} ${step.step.padEnd(9)} ${step.package}${reasonSuffix(step.reason)}`

/** One line naming the scope decision for human output. */
export const describeScope = (scope: Scope): string => {
    const packages = scope.all ? "all packages" : String(scope.targets.length) + " package(s)"
    const outside = scope.skipped.length === 0 ? "" : ", " + String(scope.skipped.length) + " outside any package"
    const proved = scope.changed.length === 0 && scope.paths.length > 0 ? `, so ${String(scope.files.length)} tracked file(s) under ${scope.paths.join(", ")}` : ""
    return `scope: ${packages} vs ${scope.base}; ${String(scope.changed.length)} changed file(s)${proved}${outside}`
}
