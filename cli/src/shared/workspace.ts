import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

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
    readonly hasTsconfig: boolean
    readonly hasEslintConfig: boolean
    /** An npm workspace root: its members carry the code, so the root is not typechecked as one project. */
    readonly workspaceRoot: boolean
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".next", "coverage", ".turbo"])

export const ESLINT_CONFIGS = ["eslint.config.ts", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const stringRecord = (value: unknown): Record<string, string> =>
    isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {}

const toSlash = (path: string): string => path.split(sep).join("/")

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
        hasTsconfig: existsSync(join(dir, "tsconfig.json")),
        hasEslintConfig: ESLINT_CONFIGS.some((file) => existsSync(join(dir, file))),
        workspaceRoot: Array.isArray(parsed.workspaces) || isRecord(parsed.workspaces),
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
