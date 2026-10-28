import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, posix, relative, resolve, sep } from "node:path"
import { workspaceBuildCachePath } from "../../harness/ledger.js"
import { withHeavySlot } from "../../harness/heavy.js"
import { captureNpm } from "../../shared/exec.js"
import type { RunOptions } from "../../shared/exec.js"
import { git, nulPaths } from "../../shared/git.js"
import { evidenceTail } from "../../shared/output.js"
import { listPackages, workspacePatterns } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import type { Scope, StepResult } from "./scope.js"

/** The code of a workspace dependency that did not build, on its own step and on every step it held back. */
export const DEP_BUILD_FAILED = "CHECK_WORKSPACE_DEP_BUILD_FAILED"

/** What preparing the scope's workspace dependencies did: one step per dependency it built or restored, and what each target lacks. */
export interface DependencyBuilds {
    readonly steps: readonly StepResult[]
    /** The workspace dependencies of a package, direct and transitive, that did not build; empty when it lacks none. */
    readonly unbuilt: (pkg: WorkspacePackage) => readonly string[]
}

const CACHE_SCHEMA = "starci/workspace-build@1"

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]

/** Folders a build never writes its output to and the snapshot never walks. */
const UNWALKED = new Set(["node_modules", ".git"])

const toSlash = (path: string): string => path.split(sep).join("/")

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex")

const globOf = (pattern: string): string => pattern.replace(/^\.\//, "").replace(/\/+$/, "")

/** Whether a workspace-relative folder is a member under the workspace's globs: one include matches it and no `!` glob excludes it. */
const isMember = (patterns: readonly string[], path: string): boolean => {
    if (path === "" || path.startsWith("..")) return false
    const included = patterns.some((pattern) => !pattern.startsWith("!") && posix.matchesGlob(path, globOf(pattern)))
    return included && !patterns.some((pattern) => pattern.startsWith("!") && posix.matchesGlob(path, globOf(pattern.slice(1))))
}

/**
 * The members of the workspace a package belongs to, the same for npm, yarn and pnpm: the nearest folder from the package up to
 * the repository root that declares workspaces (workspacePatterns) and either is the package or lists it, and every package under
 * that folder its globs match. Empty when the package is in no workspace.
 */
const workspaceOf = (root: string, packages: readonly WorkspacePackage[], pkg: WorkspacePackage): readonly WorkspacePackage[] => {
    for (let dir = pkg.dir; ; dir = dirname(dir)) {
        const patterns = workspacePatterns(dir)
        if (patterns !== undefined) {
            const members = packages.filter((each) => isMember(patterns, toSlash(relative(dir, each.dir))))
            if (resolve(dir) === resolve(pkg.dir) || members.some((member) => resolve(member.dir) === resolve(pkg.dir))) return members
        }
        if (resolve(dir) === resolve(root) || dirname(dir) === dir) return []
    }
}

/** The entries a package's manifest names that are not on disk: a consumer's resolver would not find them until it is built. */
const missingEntries = (pkg: WorkspacePackage): string[] => pkg.entries.filter((entry) => !existsSync(join(pkg.dir, entry)))

/** The content of the first lockfile from a folder up to the repository root, so a change of installed versions changes every key. */
const lockfileHash = (root: string, dir: string): string => {
    for (let current = dir; ; current = dirname(current)) {
        const file = LOCKFILES.map((name) => join(current, name)).find((candidate) => existsSync(candidate))
        if (file !== undefined) return sha256(readFileSync(file))
        if (resolve(current) === resolve(root) || dirname(current) === current) return "none"
    }
}

/** The source files of a package, package-relative: tracked or untracked but not ignored, so a build's ignored output is never source. */
const sourceFiles = async (root: string, pkg: WorkspacePackage): Promise<string[]> => {
    const listed = nulPaths(await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", `:(top,literal)${pkg.relativeDir}`]))
    return listed.filter((file) => existsSync(join(root, file))).map((file) => toSlash(relative(pkg.dir, join(root, file)))).sort((left, right) => left.localeCompare(right))
}

/** Every file under a package folder (dependency and git folders aside) with its size and time, package-relative. */
const snapshot = (dir: string): Map<string, string> => {
    const found = new Map<string, string>()
    const visit = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name)
            if (entry.isDirectory()) {
                if (!UNWALKED.has(entry.name)) visit(path)
            } else if (entry.isFile()) {
                const stats = statSync(path)
                found.set(toSlash(relative(dir, path)), `${String(stats.size)}:${String(stats.mtimeMs)}`)
            }
        }
    }
    visit(dir)
    return found
}

/** One dependency's build step: what it is, why it ran, and how it ended. */
const step = (pkg: WorkspacePackage, status: StepResult["status"], reason: string, output = ""): StepResult => ({ package: pkg.name, step: "dep-build", command: `npm run build in ${pkg.relativeDir}`, status, reason, output })

/** Restores a cached build into the package folder; false when the key has no complete entry. */
const restore = (key: string, pkg: WorkspacePackage): boolean => {
    const dir = workspaceBuildCachePath(key)
    if (!existsSync(join(dir, "manifest.json"))) return false
    cpSync(join(dir, "files"), pkg.dir, { recursive: true })
    return missingEntries(pkg).length === 0
}

/** Keeps a build's output under its key, written aside and renamed into place so a reader never meets half an entry. Returns why it could not, or undefined. */
const store = (key: string, pkg: WorkspacePackage, outputs: readonly string[]): string | undefined => {
    const dir = workspaceBuildCachePath(key)
    const aside = `${dir}.tmp-${String(process.pid)}`
    try {
        rmSync(aside, { recursive: true, force: true })
        for (const file of outputs) {
            const target = join(aside, "files", file)
            mkdirSync(dirname(target), { recursive: true })
            cpSync(join(pkg.dir, file), target)
        }
        writeFileSync(join(aside, "manifest.json"), `${JSON.stringify({ schema: CACHE_SCHEMA, package: pkg.name, files: outputs }, null, 2)}\n`)
        if (existsSync(dir)) rmSync(aside, { recursive: true, force: true })
        else renameSync(aside, dir)
        return undefined
    } catch (error: unknown) {
        rmSync(aside, { recursive: true, force: true })
        return error instanceof Error ? error.message : String(error)
    }
}

/**
 * Prepares the in-repository workspace dependencies of the scope's packages before their typecheck and lint, so a package that
 * imports a sibling exporting only its build output (`exports` or `main` pointing at `dist/`, which git does not track) is
 * judged against that sibling as a consumer would see it, not against a missing module. The dependencies are found the same
 * way for npm, yarn and pnpm (workspaceOf: the dependency names of a member that name another member of its workspace,
 * whatever the version spec), transitively, and handled in topological order. A dependency whose entries are all on disk
 * is left alone. One that misses an entry is restored from the build cache under its content key (its source files, build
 * script, lockfile, Node version and the keys of its own workspace dependencies) when the cache holds it, else built with
 * `npm run build` in its folder (npm ships with Node and runs a member's script whichever manager installed it) and its
 * ignored output kept under that key. A build that fails, has no `build` script, or leaves an entry missing is red with
 * CHECK_WORKSPACE_DEP_BUILD_FAILED naming the package; a dependency of it is skipped, and the targets that need it are held.
 */
export const buildWorkspaceDependencies = async (scope: Scope, options: RunOptions): Promise<DependencyBuilds> => {
    const packages = listPackages(scope.root)
    // One object per package folder, so a target of the scope and the same package met as a dependency are one node.
    const byDir = new Map(packages.map((pkg) => [resolve(pkg.dir), pkg]))
    const node = (pkg: WorkspacePackage): WorkspacePackage => byDir.get(resolve(pkg.dir)) ?? pkg
    const workspaces = new Map<WorkspacePackage, readonly WorkspacePackage[]>()
    const dependenciesOf = (pkg: WorkspacePackage): WorkspacePackage[] => {
        const members = workspaces.get(pkg) ?? workspaceOf(scope.root, packages, pkg)
        workspaces.set(pkg, members)
        return pkg.dependsOn.map((name) => members.find((member) => member.name === name && member !== pkg)).filter((member): member is WorkspacePackage => member !== undefined)
    }
    const order: WorkspacePackage[] = []
    const seen = new Set<WorkspacePackage>()
    const visit = (pkg: WorkspacePackage): void => {
        if (seen.has(pkg)) return
        seen.add(pkg)
        for (const dependency of dependenciesOf(pkg)) visit(dependency)
        order.push(pkg)
    }
    const targets = new Set(scope.targets.map((target) => node(target.pkg)))
    for (const target of targets) for (const dependency of dependenciesOf(target)) visit(dependency)
    const keys = new Map<WorkspacePackage, string>()
    const failed = new Set<WorkspacePackage>()
    const steps: StepResult[] = []
    for (const pkg of order) {
        const sources = await sourceFiles(scope.root, pkg)
        const key = sha256([
            CACHE_SCHEMA,
            process.version,
            pkg.name,
            pkg.scripts.build ?? "",
            lockfileHash(scope.root, pkg.dir),
            ...sources.map((file) => `${file}\0${sha256(readFileSync(join(pkg.dir, file)))}`),
            ...dependenciesOf(pkg).map((dependency) => `${dependency.name}\0${keys.get(dependency) ?? ""}`).sort((left, right) => left.localeCompare(right)),
        ].join("\n"))
        keys.set(pkg, key)
        const missing = missingEntries(pkg)
        if (missing.length === 0) continue
        const held = dependenciesOf(pkg).filter((dependency) => failed.has(dependency))
        if (held.length > 0) {
            failed.add(pkg)
            steps.push(step(pkg, "skipped", `not built: its workspace dependency ${held.map((each) => each.name).join(", ")} did not build`))
            continue
        }
        const shortKey = key.slice(0, 12)
        const lacking = `${missing.join(", ")} missing`
        if (restore(key, pkg)) {
            steps.push(step(pkg, "green", `${lacking}; restored from the build cache (${shortKey})`))
            continue
        }
        if (pkg.scripts.build === undefined) {
            failed.add(pkg)
            steps.push(step(pkg, "red", `${DEP_BUILD_FAILED}: ${pkg.name} (${pkg.relativeDir}) has ${lacking} and no build script to make them`))
            continue
        }
        const before = snapshot(pkg.dir)
        const run = await withHeavySlot("build", `npm run build ${pkg.name}`, pkg.dir, options, (held) => captureNpm(["run", "build"], pkg.dir, held.options))
        const still = missingEntries(pkg)
        if (run.exitCode !== 0 || still.length > 0) {
            failed.add(pkg)
            const why = run.exitCode !== 0 ? `exited ${String(run.exitCode)}${run.timedOut ? " at the deadline" : ""}` : `exited 0 but left ${still.join(", ")} missing`
            steps.push(step(pkg, "red", `${DEP_BUILD_FAILED}: npm run build of ${pkg.name} in ${pkg.relativeDir} ${why}`, evidenceTail(run.stdout, run.stderr)))
            continue
        }
        const source = new Set(sources)
        const outputs = [...snapshot(pkg.dir)].filter(([file, stamp]) => !source.has(file) && before.get(file) !== stamp).map(([file]) => file).sort((left, right) => left.localeCompare(right))
        const unstored = store(key, pkg, outputs)
        steps.push(step(pkg, "green", `${lacking}; built${unstored === undefined ? ` and cached (${shortKey})` : `, not cached: ${unstored}`}`))
    }
    const closure = (pkg: WorkspacePackage, met: Set<WorkspacePackage>): WorkspacePackage[] =>
        dependenciesOf(pkg).flatMap((dependency) => {
            if (met.has(dependency)) return []
            met.add(dependency)
            return [dependency, ...closure(dependency, met)]
        })
    return { steps, unbuilt: (pkg) => closure(node(pkg), new Set()).filter((dependency) => failed.has(dependency)).map((dependency) => dependency.name) }
}
