import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import type { WorkspacePackage } from "../../shared/workspace.js"

/** The hfs.json key an app declares the workspace packages it publishes to the local registry under (`"publishes": ["packages/nivoos-sdk"]`). */
export const PUBLISHES_KEY = "publishes"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** What a declared folder looks like: repository-relative, forward slashes, no `..`, no leading slash. */
const FOLDER = /^(?!\/)(?!.*\.\.)(?!.*\\)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u

/** The folders hfs.json `publishes` declares, or undefined when the repository has no hfs.json or no such key; PUBLISH_LOCAL_DECLARATION_BAD when it is not a unique list of folders. */
export const declaredPublishes = (root: string): readonly string[] | undefined => {
    const file = join(root, "hfs.json")
    if (!existsSync(file)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (!isRecord(parsed) || !Object.hasOwn(parsed, PUBLISHES_KEY)) return undefined
    const list = parsed[PUBLISHES_KEY]
    if (!Array.isArray(list) || list.length === 0 || !list.every((entry): entry is string => typeof entry === "string" && FOLDER.test(entry)) || new Set(list).size !== list.length) {
        throw new Refusal("PUBLISH_LOCAL_DECLARATION_BAD", `hfs.json ${PUBLISHES_KEY} must be a non-empty unique list of package folders relative to the app root (for example "packages/nivoos-sdk")`)
    }
    return list
}

/**
 * The packages an app publishes: every declared folder, or the declared ones `--package` names (a folder or name). A package the app has but does not declare is refused
 * PUBLISH_LOCAL_UNDECLARED by name, a declared folder that is no package, or a private one, PUBLISH_LOCAL_DECLARATION_BAD, and a name the app has not at all RELEASE_PACKAGE_UNKNOWN.
 */
export const appPackages = (all: readonly WorkspacePackage[], declared: readonly string[], named: readonly string[]): WorkspacePackage[] => {
    const declaredPackages = declared.map((folder) => {
        const pkg = all.find((one) => one.relativeDir === folder)
        if (pkg === undefined) throw new Refusal("PUBLISH_LOCAL_DECLARATION_BAD", `hfs.json ${PUBLISHES_KEY} names ${folder}, which holds no package.json with a name and version`)
        if (pkg.private) throw new Refusal("PUBLISH_LOCAL_DECLARATION_BAD", `hfs.json ${PUBLISHES_KEY} names ${folder} (${pkg.name}), which is private: npm refuses to publish it`)
        return pkg
    })
    if (named.length === 0) return declaredPackages
    return named.flatMap((one) => {
        const match = declaredPackages.find((pkg) => pkg.relativeDir === one || pkg.name === one)
        if (match !== undefined) return [match]
        const known = all.find((pkg) => pkg.relativeDir === one || pkg.name === one)
        if (known === undefined) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no package of this app matches ${one}`)
        throw new Refusal("PUBLISH_LOCAL_UNDECLARED", `${known.name} (${known.relativeDir}) is not declared: add "${known.relativeDir}" to ${PUBLISHES_KEY} in hfs.json to publish it to the local registry`)
    })
}

/** The folders of the packages in build order: a package after every declared package it depends on (a cycle keeps its declared order). */
export const appBuildOrder = (chosen: readonly WorkspacePackage[]): string[] => {
    const names = new Set(chosen.map((pkg) => pkg.name))
    const placed: string[] = []
    const visiting = new Set<string>()
    const visit = (pkg: WorkspacePackage): void => {
        if (placed.includes(pkg.relativeDir) || visiting.has(pkg.name)) return
        visiting.add(pkg.name)
        for (const dependency of pkg.dependsOn.filter((name) => names.has(name))) {
            const next = chosen.find((one) => one.name === dependency)
            if (next !== undefined) visit(next)
        }
        placed.push(pkg.relativeDir)
    }
    chosen.forEach(visit)
    return placed
}
