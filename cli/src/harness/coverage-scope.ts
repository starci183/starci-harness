import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path"
import { captureTool } from "../shared/exec.js"
import { changedFiles } from "../shared/git.js"
import { underPaths } from "./contract.js"

/** The config file names jest resolves in a folder, in its own order of preference. */
const JEST_CONFIGS = ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs", "jest.config.json"]

const SOURCE = /\.(?:[cm]?[jt]sx?)$/

/** The package managers whose script runner forwards arguments only after a `--`. */
const NEEDS_SEPARATOR: ReadonlySet<string> = new Set(["npm"])

/** The coverage arguments a jest command gets, and the line the check's detail opens with. */
export interface CoverageScope {
    readonly args: readonly string[]
    readonly detail: string
}

/** Where the scope is read: the checkout, the base its change is diffed against, and the deadline of the config probe. */
export interface CoveragePlace {
    readonly root: string
    readonly diffBase?: string
    readonly timeoutMs?: number
}

const toSlash = (path: string): string => path.split(sep).join("/")

/** The nearest folder holding a jest config, from `dir` upward and stopping at the repository root. */
const nearestJestRoot = (root: string, dir: string): string | undefined => {
    for (let current = dir; ; current = dirname(current)) {
        if (JEST_CONFIGS.some((name) => existsSync(join(current, name)))) return current
        if (resolve(current) === resolve(root) || dirname(current) === current) return undefined
    }
}

/** The jest entry installed for a folder: its own node_modules, else the nearest one above it up to the repository root. */
const jestEntry = (root: string, dir: string): string | undefined => {
    for (let current = dir; ; current = dirname(current)) {
        const entry = join(current, "node_modules", "jest", "bin", "jest.js")
        if (existsSync(entry)) return entry
        if (resolve(current) === resolve(root) || dirname(current) === current) return undefined
    }
}

/** Whether a rootDir-relative file is measured by jest's `collectCoverageFrom`: it matches a glob and no `!` negation (jest's globsToMatcher). */
const measuredBy = (globs: readonly string[], file: string): boolean => {
    const negated = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1))
    const positive = globs.filter((glob) => !glob.startsWith("!"))
    return positive.some((glob) => posix.matchesGlob(file, glob)) && !negated.some((glob) => posix.matchesGlob(file, glob))
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The resolved `collectCoverageFrom` and rootDir of the jest config in `dir` (`jest --showConfig`), or why it cannot be read. */
const resolvedCoverage = async (entry: string, dir: string, place: CoveragePlace): Promise<{ readonly rootDir: string; readonly globs: readonly string[] } | { readonly problem: string }> => {
    const run = await captureTool(process.execPath, [entry, "--showConfig"], dir, place.timeoutMs === undefined ? {} : { timeoutMs: place.timeoutMs })
    try {
        const shown: unknown = JSON.parse(run.stdout)
        const global = isRecord(shown) && isRecord(shown.globalConfig) ? shown.globalConfig : {}
        const globs = Array.isArray(global.collectCoverageFrom) ? global.collectCoverageFrom.filter((glob): glob is string => typeof glob === "string") : []
        return { rootDir: typeof global.rootDir === "string" ? global.rootDir : dir, globs }
    } catch {
        return { problem: `jest --showConfig in ${dir} printed no config (exit ${String(run.exitCode)}): ${run.stderr.split("\n").slice(0, 3).join(" ")}` }
    }
}

/**
 * The coverage a scoped jest run judges: the changed source files under allowPaths that the app's own `collectCoverageFrom` measures
 * (each read from the nearest jest config, as `jest --showConfig` resolves it), passed back as `--collectCoverageFrom` so jest's own
 * thresholds hold each of them and nothing else; `--coverage=false` when the change holds no measured file. A change with no jest
 * config above it leaves the command as named. The whole measured scope stays the app's CI's.
 */
export const changedCoverageScope = async (place: CoveragePlace, allowPaths: readonly string[]): Promise<CoverageScope> => {
    const changed = (await changedFiles(place.root, place.diffBase ?? "HEAD")).filter((file) => underPaths(file, allowPaths) && SOURCE.test(file) && existsSync(join(place.root, file)))
    const groups = new Map<string, string[]>()
    for (const file of changed) {
        const jestRoot = nearestJestRoot(place.root, dirname(join(place.root, file)))
        if (jestRoot !== undefined) groups.set(jestRoot, [...(groups.get(jestRoot) ?? []), file])
    }
    // No changed logic at all: this attempt holds nothing coverage measures, so no baseline threshold of others' code judges it.
    if (changed.length === 0) return { args: ["--coverage=false"], detail: `coverage: no source file under allowPaths changed since ${place.diffBase ?? "HEAD"}; the measured scope is CI's` }
    if (groups.size === 0) return { args: [], detail: "coverage: no changed source file under allowPaths has a jest config above it; the command runs as named" }
    const measured: string[] = []
    const problems: string[] = []
    for (const [dir, files] of groups) {
        const entry = jestEntry(place.root, dir)
        if (entry === undefined) {
            problems.push(`jest is not installed for ${toSlash(relative(place.root, dir)) || "."}`)
            continue
        }
        const config = await resolvedCoverage(entry, dir, place)
        if ("problem" in config) {
            problems.push(config.problem)
            continue
        }
        measured.push(...files.map((file) => toSlash(relative(config.rootDir, join(place.root, file)))).filter((file) => measuredBy(config.globs, file)))
    }
    if (problems.length > 0) return { args: [], detail: `coverage: the scope could not be read (${problems.join("; ")}); the command runs as named` }
    if (measured.length === 0) return { args: ["--coverage=false"], detail: `coverage: none of the ${String(changed.length)} changed source file(s) is measured logic; the measured scope is CI's` }
    return { args: measured.map((file) => `--collectCoverageFrom=${file}`), detail: `coverage judged on the ${String(measured.length)} changed logic file(s): ${measured.join(", ")}` }
}

const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn"])

/** The script a package manager command runs (`npm test`, `npm run test`, `yarn test`), read from the package.json in `cwd`. */
const scriptOf = (argv: readonly string[], cwd: string): string | undefined => scriptAt(argv, cwd)?.script

/** The argv index of the script name a package manager command runs (`npm test`: 1, `npm run test:e2e`: 2). */
const scriptIndex = (argv: readonly string[]): number => (argv[1] === "run" || argv[1] === "run-script" ? 2 : 1)

/** The script a package manager command runs and the folder of the package.json holding it. */
const scriptAt = (argv: readonly string[], cwd: string): { readonly script: string; readonly dir: string } | undefined => {
    const name = argv[scriptIndex(argv)]
    if (name === undefined || name.startsWith("-")) return undefined
    for (let current = cwd; ; current = dirname(current)) {
        const file = join(current, "package.json")
        if (existsSync(file)) {
            try {
                const scripts: unknown = (JSON.parse(readFileSync(file, "utf8")) as { scripts?: unknown }).scripts
                const script = typeof scripts === "object" && scripts !== null ? (scripts as Record<string, unknown>)[name] : undefined
                return typeof script === "string" ? { script, dir: current } : undefined
            } catch {
                return undefined
            }
        }
        if (dirname(current) === current) return undefined
    }
}

/**
 * True when a command runs jest: `jest`, `npx jest`, or a package manager script (`npm test`, `npm run test`) whose script
 * calls jest. Coverage arguments are appended to nothing else (a `git diff --no-index` check refuses an unknown option).
 */
export const runsJest = (argv: readonly string[], cwd: string): boolean => {
    const runner = basename(argv[0] ?? "", extname(argv[0] ?? "")).toLowerCase()
    if (runner === "jest") return true
    if (runner === "npx") return argv.slice(1).find((arg) => !arg.startsWith("-")) === "jest"
    if (!PACKAGE_MANAGERS.has(runner)) return false
    // jest as a word of the script: `jest`, `npx jest`, or its entry `node_modules/jest/bin/jest.js`; never `ts-jest`.
    return /(?:^|[^\w-])jest(?:[^\w-]|$)/.test(scriptOf(argv, cwd) ?? "")
}

/** A test file of any jest project kind: `<name>.spec.ts`, `<name>.e2e-spec.ts`, `<name>.integration-spec.ts`, `<name>.test.ts`. */
const SPEC = /\.(?:[\w-]+-)?(?:spec|test)\.[cm]?[jt]sx?$/

/** The jest projects that boot the test world; a run of them only is a world run (`@starci/jest-preset`: integration, e2e, contract). */
const WORLD_PROJECTS: ReadonlySet<string> = new Set(["integration", "e2e", "contract"])

/** A spec that boots a live provider sandbox (`useSandbox`, `@starci/test-world`): it needs keys the world does not declare, so it runs only when named. */
const LIVE = /\buseSandbox\s*\(/

/** The folders a spec walk never enters. */
const SKIPPED = new Set(["node_modules", "dist", "coverage", ".git"])

/** What `scopedTests` makes of a jest command: the argv to run and the line the check's detail opens with, or why it cannot run. */
export type TestScope = { readonly argv: readonly string[]; readonly detail: string } | { readonly problem: string }

/** Where a test scope is read: the checkout, the folder the command runs in and the base the task's change is diffed against. */
export interface TestPlace {
    readonly root: string
    readonly cwd: string
    readonly diffBase?: string
}

/** The folder jest runs in for a script: the package.json's folder, moved by each `cd <dir> &&` before the jest segment. */
const jestFolder = (script: string, dir: string): string => {
    let folder = dir
    for (const segment of script.split("&&").map((part) => part.trim())) {
        if (/(?:^|[^\w-])jest(?:[^\w-]|$)/.test(segment)) return folder
        const cd = /^cd\s+("?)([^"\s]+)\1$/.exec(segment)
        if (cd?.[2] !== undefined) folder = resolve(folder, cd[2])
    }
    return folder
}

/** The projects a script's jest selects (`--selectProjects a b`); empty when it selects none. */
const selectedProjects = (script: string): string[] => {
    const words = script.split(/\s+/)
    const at = words.indexOf("--selectProjects")
    if (at < 0) return []
    const names: string[] = []
    for (const word of words.slice(at + 1)) {
        if (word.startsWith("-") || word === "&&" || word === "") break
        names.push(word)
    }
    return names
}

/** Every spec file under `dir` (a file is itself when it is a spec), skipping installs and builds. */
const specsUnder = (dir: string): string[] => {
    if (!existsSync(dir)) return []
    if (statSync(dir).isFile()) return SPEC.test(dir) ? [dir] : []
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() && SKIPPED.has(entry.name) ? [] : specsUnder(join(dir, entry.name))))
}

const isLive = (file: string): boolean => {
    try {
        return LIVE.test(readFileSync(file, "utf8"))
    } catch {
        return false
    }
}

/**
 * Scopes a package manager script that runs jest to the task's own spec files, passed as `--runTestsByPath <files>` (exact paths,
 * which no array option of the script, such as `--selectProjects e2e`, can swallow as a positional pattern does). A command that
 * names test paths after its `--` runs the spec files under them; a world run (every project it selects boots the test world:
 * integration, e2e, contract) that names none runs the spec files the task changed under allowPaths, else every spec of its
 * kinds under the folder jest runs in. A live-provider spec (`useSandbox`) runs only when its file or its own folder is named.
 * Undefined for any other command, which runs as named (a unit run keeps jest's related-tests choice).
 */
export const scopedTests = async (argv: readonly string[], place: TestPlace, allowPaths: readonly string[]): Promise<TestScope | undefined> => {
    const runner = basename(argv[0] ?? "", extname(argv[0] ?? "")).toLowerCase()
    if (!PACKAGE_MANAGERS.has(runner)) return undefined
    const found = scriptAt(argv, place.cwd)
    if (found === undefined || !/(?:^|[^\w-])jest(?:[^\w-]|$)/.test(found.script)) return undefined
    const separator = argv.indexOf("--")
    const extra = argv.slice(separator >= 0 ? separator + 1 : scriptIndex(argv) + 1)
    const named = extra.filter((arg) => !arg.startsWith("-"))
    const projects = selectedProjects(found.script)
    const world = projects.length > 0 && projects.every((project) => WORLD_PROJECTS.has(project))
    if (named.length === 0 && !world) return undefined
    const folder = jestFolder(found.script, found.dir)
    let files: string[]
    let why: string
    if (named.length > 0) {
        const dropped: string[] = []
        files = named.flatMap((path) => {
            const at = [resolve(folder, path), resolve(place.cwd, path)].find((candidate) => existsSync(candidate))
            if (at === undefined) return []
            return specsUnder(at).filter((file) => {
                const kept = file === at || resolve(dirname(file)) === resolve(at) || !isLive(file)
                if (!kept) dropped.push(toSlash(relative(folder, file)))
                return kept
            })
        })
        why = `the spec files under ${named.join(", ")}${dropped.length === 0 ? "" : `; live-provider specs not named, left out: ${dropped.join(", ")}`}`
    } else {
        const kinds = projects.map((project) => `.${project}-spec.`)
        const changed = (await changedFiles(place.root, place.diffBase ?? "HEAD")).filter((file) => underPaths(file, allowPaths) && SPEC.test(file)).map((file) => join(place.root, file))
        const own = changed.filter((file) => existsSync(file) && kinds.some((kind) => file.includes(kind)))
        files = own.length > 0 ? own : specsUnder(folder).filter((file) => kinds.some((kind) => file.includes(kind)) && !isLive(file))
        why = own.length > 0 ? "the task's own changed spec files" : `every ${projects.join(", ")} spec under ${toSlash(relative(place.root, folder)) || "."}, live-provider specs left out`
    }
    const paths = [...new Set(files.map((file) => toSlash(relative(folder, file))))].sort((left, right) => left.localeCompare(right))
    if (paths.length === 0) return { problem: `tests: ${named.length > 0 ? `${named.join(", ")} hold no spec file jest can run` : "no spec file to run"} (from ${toSlash(relative(place.root, folder)) || "."}); nothing was run` }
    const base = separator >= 0 ? argv.slice(0, separator + 1) : argv.slice(0, scriptIndex(argv) + 1)
    const kept = extra.filter((arg) => arg.startsWith("-"))
    const lead = NEEDS_SEPARATOR.has(runner) && separator < 0 ? ["--"] : []
    return { argv: [...base, ...lead, ...kept, "--runTestsByPath", ...paths], detail: `tests: ${String(paths.length)} spec file(s) run by path, ${why}: ${paths.join(", ")}` }
}

/** The command's argv with the coverage arguments appended where its runner forwards them to jest (after a `--` for npm). */
export const withCoverageArgs = (argv: readonly string[], scope: CoverageScope): readonly string[] => {
    if (scope.args.length === 0) return argv
    const runner = basename(argv[0] ?? "", extname(argv[0] ?? "")).toLowerCase()
    const separator = NEEDS_SEPARATOR.has(runner) && !argv.includes("--") ? ["--"] : []
    return [...argv, ...separator, ...scope.args]
}
