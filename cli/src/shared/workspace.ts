import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { parse } from "yaml"

/** One npm package of the repository the CLI can check or publish. */
export interface WorkspacePackage {
    readonly dir: string
    readonly relativeDir: string
    readonly name: string
    readonly version: string
    readonly private: boolean
    readonly scripts: Readonly<Record<string, string>>
    /** The packages it requires once installed, name to spec: its `dependencies` and `peerDependencies`. */
    readonly requires: Readonly<Record<string, string>>
    /** The folders its `file:` dependencies (of any kind) name, repository-relative: siblings built before it is installed. */
    readonly fileDependencies: readonly string[]
    /** The name of every package it depends on, of any kind (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`). */
    readonly dependsOn: readonly string[]
    /** The files its manifest names as what a consumer resolves (`exports` targets without a `*`, `main`, `module`, `types`, `typings`), package-relative. */
    readonly entries: readonly string[]
    readonly hasTsconfig: boolean
    readonly hasEslintConfig: boolean
    /** A workspace root (npm, yarn or pnpm, workspacePatterns): its members carry the code, so the root is not typechecked as one project. */
    readonly workspaceRoot: boolean
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const

const ENTRY_FIELDS = ["main", "module", "types", "typings"] as const

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".next", "coverage", ".turbo"])

export const ESLINT_CONFIGS = ["eslint.config.ts", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const stringRecord = (value: unknown): Record<string, string> =>
    isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {}

const toSlash = (path: string): string => path.split(sep).join("/")

/** Every target string of an `exports` value (a path, a conditions object, a subpath map or a fallback array), patterns aside. */
const exportTargets = (value: unknown): string[] => {
    if (typeof value === "string") return value.includes("*") ? [] : [value]
    if (Array.isArray(value)) return value.flatMap(exportTargets)
    return isRecord(value) ? Object.values(value).flatMap(exportTargets) : []
}

/** The package-relative files a manifest names as its entries: what a consumer's resolver (node, tsc, a bundler) reads. */
const entriesOf = (manifest: Record<string, unknown>): string[] => {
    const named = [...exportTargets(manifest.exports), ...ENTRY_FIELDS.map((field) => manifest[field]).filter((value): value is string => typeof value === "string")]
    const inside = named.filter((path) => !path.startsWith("../")).map((path) => (path.startsWith("./") ? path.slice(2) : path))
    return [...new Set(inside)].sort((left, right) => left.localeCompare(right))
}

/**
 * The member globs of a workspace root, relative to its folder, whichever package manager declares them: npm's and yarn's
 * `workspaces` (a list, or yarn's `{ packages }`) in package.json, pnpm's `packages` in pnpm-workspace.yaml. A `!` glob
 * excludes. Undefined when the folder declares no workspace.
 */
export const workspacePatterns = (dir: string): readonly string[] | undefined => {
    const manifest = join(dir, "package.json")
    if (existsSync(manifest)) {
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"))
        const declared = isRecord(parsed) ? parsed.workspaces : undefined
        const list: unknown = isRecord(declared) && !Array.isArray(declared) ? declared.packages : declared
        if (Array.isArray(list)) return list.filter((each): each is string => typeof each === "string")
    }
    const pnpm = join(dir, "pnpm-workspace.yaml")
    if (!existsSync(pnpm)) return undefined
    const parsed: unknown = parse(readFileSync(pnpm, "utf8"))
    const list: unknown = isRecord(parsed) ? parsed.packages : undefined
    return Array.isArray(list) ? list.filter((each): each is string => typeof each === "string") : []
}

const readPackage = (root: string, dir: string): WorkspacePackage | undefined => {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    if (!isRecord(parsed) || typeof parsed.name !== "string" || typeof parsed.version !== "string") return undefined
    return {
        dir,
        relativeDir: toSlash(relative(root, dir)) || ".",
        name: parsed.name,
        version: parsed.version,
        private: parsed.private === true,
        scripts: stringRecord(parsed.scripts),
        requires: { ...stringRecord(parsed.peerDependencies), ...stringRecord(parsed.dependencies) },
        fileDependencies: [...new Set(
            DEPENDENCY_FIELDS
                .flatMap((field) => Object.values(stringRecord(parsed[field])))
                .filter((spec) => spec.startsWith("file:"))
                .map((spec) => toSlash(relative(root, resolve(dir, spec.slice("file:".length))))),
        )],
        dependsOn: [...new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(stringRecord(parsed[field]))))].sort((left, right) => left.localeCompare(right)),
        entries: entriesOf(parsed),
        hasTsconfig: existsSync(join(dir, "tsconfig.json")),
        hasEslintConfig: ESLINT_CONFIGS.some((file) => existsSync(join(dir, file))),
        workspaceRoot: workspacePatterns(dir) !== undefined,
    }
}

/** Every package.json with a name and version under `root`, skipping dependency and build folders, three levels deep at most. */
export const listPackages = (root: string): WorkspacePackage[] => {
    const found: WorkspacePackage[] = []
    const visit = (dir: string, depth: number): void => {
        if (existsSync(join(dir, "package.json"))) {
            const declared = readPackage(root, dir)
            if (declared !== undefined) found.push(declared)
        }
        if (depth === 3) return
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) visit(join(dir, entry.name), depth + 1)
        }
    }
    visit(root, 0)
    return found.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir))
}

/** The package that owns a repository-relative file: the deepest package whose folder contains it. */
export const ownerOf = (packages: readonly WorkspacePackage[], file: string): WorkspacePackage | undefined =>
    packages
        .filter((candidate) => candidate.relativeDir === "." || file === candidate.relativeDir || file.startsWith(`${candidate.relativeDir}/`))
        .sort((left, right) => right.relativeDir.length - left.relativeDir.length)[0]
