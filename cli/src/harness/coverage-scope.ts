import { existsSync } from "node:fs"
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

/** The command's argv with the coverage arguments appended where its runner forwards them to jest (after a `--` for npm). */
export const withCoverageArgs = (argv: readonly string[], scope: CoverageScope): readonly string[] => {
    if (scope.args.length === 0) return argv
    const runner = basename(argv[0] ?? "", extname(argv[0] ?? "")).toLowerCase()
    const separator = NEEDS_SEPARATOR.has(runner) && !argv.includes("--") ? ["--"] : []
    return [...argv, ...separator, ...scope.args]
}
