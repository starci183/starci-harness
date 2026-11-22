import { Refusal } from "../../shared/errors.js"
import { EXACT_VERSION } from "./dev-local.js"

/**
 * The sibling pins of a publish copy: one implementation for `deps publish-local` (real versions) and `deps publish-dev` (dev builds). A package
 * published together with siblings it pins gets those pins rewritten in the copy it publishes (the tarball's manifest, never a committed file) to
 * the versions of that same batch, as publish.yml's cli-follow does on npm. Without it a local publish of one batch shipped starci-harness requiring
 * @starci/hfs 6.17.7 while the batch published hfs 6.17.8, and every app run warned HFS_CLI_HFS_SKEW. A sibling outside the batch whose exact pin the
 * tree has already moved past, at a version the registry serves, is pinned at the tree's version too, so a publish of the CLI alone never ships behind
 * the hfs the same tree published before.
 */

/** The manifest fields whose sibling requirements a publish copy pins: what an installed package requires. devDependencies never install. */
export const PIN_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const

/** A spec that names no registry version (a folder, a link, a workspace member): never rewritten, it never ships as such. */
const LOCAL_SPEC = /^(?:file|link|workspace):|^\.{1,2}\//

/** A manifest's sibling requirements in PIN_FIELDS, name to spec, local specs left out. Pure. */
export const siblingSpecs = (manifest: Readonly<Record<string, unknown>>): Map<string, string> => {
    const specs = new Map<string, string>()
    for (const field of PIN_FIELDS) {
        const value = manifest[field]
        if (typeof value !== "object" || value === null) continue
        for (const [name, spec] of Object.entries(value)) if (typeof spec === "string" && !LOCAL_SPEC.test(spec)) specs.set(name, spec)
    }
    return specs
}

/** -1, 0 or 1 as the version `a` sorts below, equal to or above `b` (semver precedence: a prerelease below its release). Pure. */
export const compareVersions = (a: string, b: string): number => {
    const split = (version: string): { readonly core: number[]; readonly pre: string[] } => {
        const [core = "", ...rest] = version.split("-")
        const pre = rest.join("-")
        return { core: core.split(".").map(Number), pre: pre === "" ? [] : pre.split(".") }
    }
    const [x, y] = [split(a), split(b)]
    for (let i = 0; i < 3; i += 1) {
        const d = (x.core[i] ?? 0) - (y.core[i] ?? 0)
        if (d !== 0) return Math.sign(d)
    }
    if (x.pre.length === 0 || y.pre.length === 0) return Math.sign(y.pre.length - x.pre.length)
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
        const [l, r] = [x.pre[i], y.pre[i]]
        if (l === undefined || r === undefined) return l === undefined ? -1 : 1
        if (l === r) continue
        const [ln, rn] = [/^\d+$/.test(l), /^\d+$/.test(r)]
        if (ln && rn) return Math.sign(Number(l) - Number(r))
        if (ln !== rn) return ln ? -1 : 1
        return l < r ? -1 : 1
    }
    return 0
}

/**
 * The pins of one package's publish copy. `batch` are the versions published together (each sibling the manifest names is pinned at its batch
 * version); `tree` the versions committed in the same tree, and `served` whether the registry the copy installs from serves one: a sibling outside
 * the batch that the manifest pins exactly, below the tree's version, is pinned at the tree's version when it is served. Pure.
 */
export const copyPins = (manifest: Readonly<Record<string, unknown>>, batch: ReadonlyMap<string, string>, tree: ReadonlyMap<string, string>, served: (name: string, version: string) => boolean): Map<string, string> => {
    const pins = new Map<string, string>()
    for (const [name, spec] of siblingSpecs(manifest)) {
        const together = batch.get(name)
        if (together !== undefined) {
            pins.set(name, together)
            continue
        }
        const committed = tree.get(name)
        if (committed !== undefined && EXACT_VERSION.test(spec) && compareVersions(committed, spec) > 0 && served(name, committed)) pins.set(name, committed)
    }
    return pins
}

/**
 * A package manifest's text as its copy publishes it: `version` set (when given), and the requirements in PIN_FIELDS of each package `pins` names set
 * to that exact version, in the file's own indent and line ending. `rangesToo` rewrites a range as well (a dev build: no range admits a prerelease);
 * otherwise only an exact pin moves, and a range a release already satisfies stays. devDependencies and local specs are never touched. Pure.
 */
export const pinnedManifest = (text: string, version: string | undefined, pins: ReadonlyMap<string, string>, rangesToo: boolean): string => {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Refusal("DEPS_MANIFEST_UNREADABLE", "a package.json holds a JSON object")
    const manifest: Record<string, unknown> = { ...(parsed as Record<string, unknown>), ...(version === undefined ? {} : { version }) }
    for (const field of PIN_FIELDS) {
        const value = manifest[field]
        if (typeof value !== "object" || value === null) continue
        manifest[field] = Object.fromEntries(
            Object.entries(value).map(([name, spec]) => {
                const pin = pins.get(name)
                const moves = typeof spec === "string" && pin !== undefined && !LOCAL_SPEC.test(spec) && (rangesToo || EXACT_VERSION.test(spec))
                return [name, moves ? pin : spec]
            }),
        )
    }
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  "
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    return `${JSON.stringify(manifest, null, indent).replaceAll("\n", eol)}${/\r?\n$/.test(text) ? eol : ""}`
}

/** The pins a copy moved, `name a -> b`, for the report. Pure. */
export const movedPins = (manifest: Readonly<Record<string, unknown>>, pins: ReadonlyMap<string, string>, rangesToo: boolean): string[] =>
    [...siblingSpecs(manifest)].filter(([name, spec]) => pins.has(name) && pins.get(name) !== spec && (rangesToo || EXACT_VERSION.test(spec))).map(([name, spec]) => `${name} ${spec} -> ${pins.get(name) ?? ""}`)
