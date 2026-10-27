import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { CANON_TOOLS } from "../../harness/policy.js"
import type { CanonTool } from "../../harness/policy.js"
import { packageOf, walkExtends } from "./config-extends.js"
import type { ExtendsChain } from "./config-extends.js"
import type { Scope, ScopeTarget, StepResult } from "./scope.js"

/** The canon packages of a profile per tool, as harness/policy.ts canonOf returns them. */
export type CanonByTool = Readonly<Partial<Record<CanonTool, readonly string[]>>>

/** The files that mark a tool's use in a package; package.json counts when it carries the tool's key. */
export const CONFIG_FILES: Readonly<Record<CanonTool, readonly string[]>> = {
    eslint: ["eslint.config.ts", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"],
    stylelint: ["stylelint.config.js", "stylelint.config.mjs", "stylelint.config.cjs", "stylelint.config.ts", ".stylelintrc", ".stylelintrc.json", ".stylelintrc.js", ".stylelintrc.cjs", ".stylelintrc.yaml", ".stylelintrc.yml"],
    tsconfig: ["tsconfig.json"],
    prettier: [".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs", ".prettierrc.yaml", ".prettierrc.yml", "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs", "prettier.config.ts"],
    jest: ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs", "jest.config.json"],
}

const PACKAGE_KEYS: Readonly<Partial<Record<CanonTool, string>>> = { prettier: "prettier", jest: "jest", stylelint: "stylelint" }

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const readManifest = (dir: string): Record<string, unknown> => {
    const file = join(dir, "package.json")
    if (!existsSync(file)) return {}
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    return isRecord(parsed) ? parsed : {}
}

const dependsOn = (manifest: Record<string, unknown>, name: string): boolean => DEPENDENCY_FIELDS.some((field) => isRecord(manifest[field]) && name in manifest[field])

/** Where a package declares a tool and what the config holds: the text of every file of its `extends` chain, the specifiers it names, the ones that resolve to nothing. */
interface ToolConfig {
    readonly where: string
    readonly chain: ExtendsChain
}

/** Where a package declares a tool: the config file followed through its `extends` chain, or the package.json key's value. */
const toolConfig = (root: string, dir: string, manifest: Record<string, unknown>, tool: CanonTool, names: readonly string[]): ToolConfig | undefined => {
    const file = CONFIG_FILES[tool].find((candidate) => existsSync(join(dir, candidate)))
    if (file !== undefined) return { where: file, chain: walkExtends(join(dir, file), root, names) }
    const key = PACKAGE_KEYS[tool]
    if (key !== undefined && key in manifest) return { where: `package.json "${key}"`, chain: { texts: [JSON.stringify(manifest[key])], specifiers: [], missing: [] } }
    return undefined
}

/** Whether a config chain names a canon package: a file of the chain spells it, or an `extends` specifier lies in it. */
const namesCanon = (chain: ExtendsChain, name: string): boolean => chain.texts.some((text) => text.includes(name)) || chain.specifiers.some((specifier) => packageOf(specifier) === name)

/**
 * The canon step of one package: for every tool whose config the package carries and the profile pins, the package (or the
 * repository root) depends on one of the tool's canon packages and the config names it. A canon package itself is exempt.
 */
export const canonPackage = (scope: Scope, target: ScopeTarget, canon: CanonByTool): StepResult => {
    const { pkg } = target
    const base = { package: pkg.name, step: "canon" as const, command: "starci canon" }
    const pinned = Object.values(canon).flat()
    if (pinned.length === 0) return { ...base, status: "skipped", reason: "the profile pins no canon", output: "" }
    if (pinned.includes(pkg.name)) return { ...base, status: "skipped", reason: "a canon package itself", output: "" }
    const manifest = readManifest(pkg.dir)
    const rootManifest = pkg.dir === scope.root ? manifest : readManifest(scope.root)
    const problems: string[] = []
    const judged: CanonTool[] = []
    for (const tool of CANON_TOOLS) {
        const names = canon[tool]
        if (names === undefined || names.length === 0) continue
        const config = toolConfig(scope.root, pkg.dir, manifest, tool, names)
        if (config === undefined) continue
        judged.push(tool)
        const expected = names.join(" or ")
        if (!names.some((name) => dependsOn(manifest, name) || dependsOn(rootManifest, name))) problems.push(`${tool}: ${pkg.name} does not depend on ${expected}`)
        problems.push(...config.chain.missing.map((missing) => `${tool}: ${missing}`))
        if (!names.some((name) => namesCanon(config.chain, name))) problems.push(`${tool}: ${config.where} does not extend ${expected}, directly or through its extends chain`)
    }
    if (judged.length === 0) return { ...base, status: "skipped", reason: "no config of a pinned tool", output: "" }
    return { ...base, status: problems.length === 0 ? "green" : "red", reason: `${judged.join(", ")} pinned to ${judged.map((tool) => (canon[tool] ?? []).join("|")).join(", ")}`, output: problems.join("\n") }
}
