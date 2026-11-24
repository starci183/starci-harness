import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { dirname, join, parse } from "node:path"

/**
 * The smoke check of a swapped install: a package that does not resolve after the swap fails here, not in the web's first request.
 * It resolves packages the way Node does, by file: from the root and from each workspace folder, the packages that folder declares (a few, sorted) and the
 * probes `next`, `postcss` and `picocolors` when the lockfile holds them, then, from where each of those really lives (junctions followed), the packages
 * IT declares, so a nested package whose own dependency is not hoisted where Node looks fails here, not in the web's first request. Reads files only.
 */

/** The names probed from every folder when the lockfile holds them: the ones the failure above went through. */
export const PROBES: readonly string[] = ["next", "postcss", "picocolors"]

/** How many declared packages of a folder, and of a probed package, are resolved. */
const PER_FOLDER = 6
const PER_PACKAGE = 8

/** One package that does not resolve. */
export interface SmokeFailure {
    /** The folder it was resolved from, relative to the checkout (`.` for the root). */
    readonly from: string
    readonly name: string
    /** Why: not found on the node_modules chain, or a package.json that cannot be read. */
    readonly reason: string
}

interface Manifest {
    readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] }
    readonly dependencies?: Readonly<Record<string, string>>
    readonly devDependencies?: Readonly<Record<string, string>>
    readonly optionalDependencies?: Readonly<Record<string, string>>
}

const read = (file: string): Manifest | undefined => {
    try {
        return JSON.parse(readFileSync(file, "utf8")) as Manifest
    } catch {
        return undefined
    }
}

/** The folder of `name` as Node finds it from `from`: the first `node_modules/<name>/package.json` up the chain; undefined when none. */
export const resolveFrom = (from: string, name: string): string | undefined => {
    for (let dir = from; ; dir = dirname(dir)) {
        const file = join(dir, "node_modules", name, "package.json")
        if (existsSync(file)) return dirname(file)
        if (dirname(dir) === dir || parse(dir).root === dir) return undefined
    }
}

/** The workspace folders of the root manifest: exact folders and `parent/*` patterns, those holding a package.json. */
export const workspaceFolders = (root: string): string[] => {
    const manifest = read(join(root, "package.json"))
    const given = manifest?.workspaces
    const patterns: readonly string[] = (Array.isArray(given) ? given : (given as { readonly packages?: readonly string[] } | undefined)?.packages) ?? []
    const found: string[] = []
    for (const pattern of patterns) {
        const clean = pattern.replace(/\/+$/u, "")
        if (clean.endsWith("/*")) {
            const parent = join(root, clean.slice(0, -2))
            let names: string[] = []
            try {
                names = readdirSync(parent)
            } catch {
                // a pattern with no folder yet
            }
            for (const name of names.sort((left, right) => left.localeCompare(right))) if (existsSync(join(parent, name, "package.json"))) found.push(join(parent, name))
        } else if (existsSync(join(root, clean, "package.json"))) found.push(join(root, clean))
    }
    return found
}

/** The names the lockfile holds under some `node_modules/<name>`, among `names`. */
const lockedNames = (root: string, names: readonly string[]): string[] => {
    try {
        const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as { readonly packages?: Readonly<Record<string, unknown>> }
        const keys = Object.keys(lock.packages ?? {})
        return names.filter((name) => keys.some((key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)))
    } catch {
        return []
    }
}

/** What a manifest declares that must be installed: dependencies and devDependencies, not optional ones, not a file: or link: spec. Sorted. */
const declared = (manifest: Manifest | undefined, dev: boolean): string[] =>
    Object.entries({ ...manifest?.dependencies, ...(dev ? manifest?.devDependencies : undefined) })
        .filter(([name, spec]) => !spec.startsWith("file:") && !spec.startsWith("link:") && !spec.startsWith("workspace:") && manifest?.optionalDependencies?.[name] === undefined)
        .map(([name]) => name)
        .sort((left, right) => left.localeCompare(right))

const relativeTo = (root: string, folder: string): string => {
    const text = folder.replaceAll("\\", "/")
    const base = root.replaceAll("\\", "/").replace(/\/+$/u, "")
    return text === base ? "." : text.startsWith(`${base}/`) ? text.slice(base.length + 1) : text
}

/** How deep the dependencies of a resolved package are followed. */
const DEPTH = 3

/**
 * Resolves, from the root and from each workspace of `root`, a few of the packages the folder declares plus the probes the lockfile holds, then, from where
 * each resolved package really lives, the packages it declares, down to `DEPTH` levels (each package folder once). Returns what does not resolve; empty when
 * the install loads.
 */
export const smokeInstall = (root: string): SmokeFailure[] => {
    const failures: SmokeFailure[] = []
    const seen = new Set<string>()
    const probes = lockedNames(root, PROBES)
    const visit = (folder: string, name: string, via: string | undefined, depth: number): void => {
        const found = resolveFrom(folder, name)
        const from = relativeTo(root, folder)
        if (found === undefined) {
            failures.push({ from, name, reason: via === undefined ? "not found in any node_modules up the chain" : `a dependency of ${via} that is not found in any node_modules up the chain` })
            return
        }
        let real: string
        try {
            real = realpathSync(found)
        } catch {
            failures.push({ from, name, reason: `${relativeTo(root, found)} is a link to nothing` })
            return
        }
        if (seen.has(real) || depth >= DEPTH) return
        seen.add(real)
        const manifest = read(join(real, "package.json"))
        if (manifest === undefined) {
            failures.push({ from, name, reason: `${relativeTo(root, join(real, "package.json"))} cannot be read` })
            return
        }
        for (const inner of declared(manifest, false).slice(0, PER_PACKAGE)) visit(real, inner, name, depth + 1)
    }
    for (const folder of [root, ...workspaceFolders(root)]) {
        const own = declared(read(join(folder, "package.json")), true)
        // A probe the workspace does not declare may be absent from its chain legitimately; a declared package, and every probe from the root, may not.
        const names = [...new Set([...own.slice(0, PER_FOLDER), ...probes.filter((name) => folder === root || own.includes(name) || resolveFrom(folder, name) !== undefined)])]
        for (const name of names) visit(folder, name, undefined, 0)
    }
    return failures
}

/** The one line that names the failures, at most five. Pure. */
export const smokeLine = (failures: readonly SmokeFailure[]): string =>
    `${failures.slice(0, 5).map((failure) => `${failure.name} from ${failure.from}`).join(", ")}${failures.length > 5 ? `, and ${String(failures.length - 5)} more` : ""}`
