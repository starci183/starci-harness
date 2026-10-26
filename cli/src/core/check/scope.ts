import { existsSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureTool } from "../../shared/exec.js"
import type { RunOptions, ToolRun } from "../../shared/exec.js"
import { changedFiles, refExists, repositoryRoot } from "../../shared/git.js"
import { listPackages, ownerOf } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"

/** One package the check touches and the changed files it owns. */
export interface ScopeTarget {
    readonly pkg: WorkspacePackage
    readonly files: readonly string[]
}

/** The scope decision written before any check runs (owner ruling scope-before-check). */
export interface Scope {
    readonly root: string
    readonly base: string
    readonly all: boolean
    readonly changed: readonly string[]
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

/** Repository files whose change reaches every package. */
const ROOT_WIDE = /^(package-lock\.json|package\.json|tsconfig(\.[a-z]+)?\.json|\.gitattributes)$/

const LINTABLE = /\.(?:[cm]?[jt]sx?)$/

const OUTPUT_LINES = 60

/** Decides what to check: every package with --all, else the packages that own a changed file; a root-wide file widens to all. */
export const resolveScope = async (cwd: string, baseFlag: string | undefined, all: boolean): Promise<Scope> => {
    const root = await repositoryRoot(cwd)
    const base = baseFlag ?? ((await refExists(root, "origin/main")) ? "origin/main" : "HEAD")
    if (!(await refExists(root, base))) throw new Refusal("CHECK_BASE_UNKNOWN", `the base ${base} does not exist here`)
    const packages = listPackages(root)
    if (packages.length === 0) throw new Refusal("CHECK_NO_PACKAGE", `no package.json with a name and version under ${root}`)
    const changed = await changedFiles(root, base)
    const widen = all || changed.some((file) => ROOT_WIDE.test(file))
    const owned = new Map<WorkspacePackage, string[]>()
    const skipped: string[] = []
    for (const file of changed) {
        const owner = ownerOf(packages, file)
        if (owner === undefined) skipped.push(file)
        else owned.set(owner, [...(owned.get(owner) ?? []), file])
    }
    const targets = widen ? packages.map((pkg) => ({ pkg, files: owned.get(pkg) ?? [] })) : [...owned.entries()].map(([pkg, files]) => ({ pkg, files }))
    return { root, base, all: widen, changed, targets, skipped }
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
    const tsc = localBin(scope, pkg, join("typescript", "bin", "tsc"))
    if (tsc === undefined) return skipped(pkg, "typecheck", "typescript is not installed (run npm ci)")
    const run = await captureTool(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit"], pkg.dir, options)
    return { package: pkg.name, step: "typecheck", command: "tsc -p tsconfig.json --noEmit", status: run.exitCode === 0 ? "green" : "red", reason: "", output: tail(run) }
}

/** ESLint over the changed source files of the package (every file with --all), warnings counted as errors. */
export const lintPackage = async (scope: Scope, target: ScopeTarget, options: RunOptions = {}): Promise<StepResult> => {
    const { pkg } = target
    if (!pkg.hasEslintConfig) return skipped(pkg, "lint", "no eslint.config.*")
    const eslint = localBin(scope, pkg, join("eslint", "bin", "eslint.js"))
    if (eslint === undefined) return skipped(pkg, "lint", "eslint is not installed (run npm ci)")
    const prefix = pkg.relativeDir === "." ? "" : `${pkg.relativeDir}/`
    const files = target.files.filter((file) => LINTABLE.test(file) && existsSync(join(scope.root, file))).map((file) => file.slice(prefix.length))
    if (!scope.all && files.length === 0) return skipped(pkg, "lint", "no changed source file")
    const paths = scope.all ? ["."] : files
    const run = await captureTool(process.execPath, [eslint, "--max-warnings=0", ...paths], pkg.dir, options)
    return { package: pkg.name, step: "lint", command: `eslint --max-warnings=0 ${paths.join(" ")}`, status: run.exitCode === 0 ? "green" : "red", reason: "", output: tail(run) }
}

/** One line per step for human output. */
export const describeStep = (step: StepResult): string => `${step.status.padEnd(7)} ${step.step.padEnd(9)} ${step.package}${step.reason === "" ? "" : ` (${step.reason})`}`

/** One line naming the scope decision for human output. */
export const describeScope = (scope: Scope): string =>
    `scope: ${scope.all ? "all packages" : `${String(scope.targets.length)} package(s)`} vs ${scope.base}; ${String(scope.changed.length)} changed file(s)${scope.skipped.length === 0 ? "" : `, ${String(scope.skipped.length)} outside any package`}`
