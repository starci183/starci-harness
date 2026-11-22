import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureGitSync, nulPaths } from "../../shared/git.js"
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
 * The version one sibling requirement is pinned at in a publish copy, or undefined to leave it: its batch version when it is published together;
 * else, for an exact pin below the version the tree holds, the tree's version when the registry serves it. The one rule of every copy pin (the
 * manifest's requirements and the pin data a package ships alike), for real versions and dev builds. Pure.
 */
export const pinOf = (name: string, spec: string, batch: ReadonlyMap<string, string>, tree: ReadonlyMap<string, string>, served: (name: string, version: string) => boolean): string | undefined => {
    const together = batch.get(name)
    if (together !== undefined) return together
    const committed = tree.get(name)
    return committed !== undefined && EXACT_VERSION.test(spec) && compareVersions(committed, spec) > 0 && served(name, committed) ? committed : undefined
}

/**
 * The pins of one package's publish copy. `batch` are the versions published together (each sibling the manifest names is pinned at its batch
 * version); `tree` the versions committed in the same tree, and `served` whether the registry the copy installs from serves one: a sibling outside
 * the batch that the manifest pins exactly, below the tree's version, is pinned at the tree's version when it is served (`pinOf`). Pure.
 */
export const copyPins = (manifest: Readonly<Record<string, unknown>>, batch: ReadonlyMap<string, string>, tree: ReadonlyMap<string, string>, served: (name: string, version: string) => boolean): Map<string, string> => {
    const pins = new Map<string, string>()
    for (const [name, spec] of siblingSpecs(manifest)) {
        const pin = pinOf(name, spec, batch, tree, served)
        if (pin !== undefined) pins.set(name, pin)
    }
    return pins
}

/**
 * The basename of the pin data a package ships for what it renders: hfs's `runtime/knowledge/hfs/canon-pins.yaml` (schema starci/canon-pins@1),
 * whose `version` of each row is what `app sync` and the scaffold write into an app's package.json files (gallery/package.json's @starci/gallery,
 * the Grammar, the canons, the jest preset). A publish copy carries the batch's versions in it as in its manifest, so a dev build of hfs renders
 * the dev builds published beside it.
 */
export const PIN_DATA_FILE = "canon-pins.yaml"

/** Whether a file of a package (its path inside the package) is pin data a copy rewrites. Pure. */
export const isPinData = (path: string): boolean => path.split("/").at(-1) === PIN_DATA_FILE

const ROW = /^ {2}(['"]?)([^'"\s#][^'"]*?)\1:\s*$/u
const ROW_FIELD = /^( {4}(version|range):[ \t]*)(['"]?)([^'"\s#]+)\3([ \t]*(?:#.*)?)$/u
const TOP_LEVEL = /^\S/u
const PINS_KEY = /^pins:\s*$/u

/** One row of pin data: its package and the version and range it holds. */
export interface DataRow {
    readonly name: string
    readonly version?: string
    readonly range?: string
}

/** The rows of a pin data text (`pins:` then `  '<name>':` rows with `    version:` and `    range:`), read line by line. Pure. */
export const pinDataRows = (text: string): DataRow[] => {
    const rows: { name: string; version?: string; range?: string }[] = []
    let inPins = false
    for (const line of text.split(/\r?\n/u)) {
        if (TOP_LEVEL.test(line)) inPins = PINS_KEY.test(line)
        if (!inPins) continue
        const row = ROW.exec(line)
        if (row !== null) {
            rows.push({ name: row[2] ?? "" })
            continue
        }
        const field = ROW_FIELD.exec(line)
        const current = rows.at(-1)
        if (field === null || current === undefined) continue
        if (field[2] === "version") current.version = field[4] ?? ""
        else current.range = field[4] ?? ""
    }
    return rows
}

/** The pins of a copy's pin data: each row whose package is in the batch, or behind the tree's served version, by `pinOf` on its `version`. Pure. */
export const dataPins = (text: string, batch: ReadonlyMap<string, string>, tree: ReadonlyMap<string, string>, served: (name: string, version: string) => boolean): Map<string, string> => {
    const pins = new Map<string, string>()
    for (const row of pinDataRows(text)) {
        if (row.version === undefined) continue
        const pin = pinOf(row.name, row.version, batch, tree, served)
        if (pin !== undefined && pin !== row.version) pins.set(row.name, pin)
    }
    return pins
}

/**
 * A pin data text as its copy publishes it: the `version` of each row `pins` names set to its pin, and with `rangesToo` (a dev build: no range admits
 * a prerelease) its `range` set to that exact version too; quoting, comments, line endings and every other line kept. Pure.
 */
export const pinnedData = (text: string, pins: ReadonlyMap<string, string>, rangesToo: boolean): string => {
    if (pins.size === 0) return text
    let inPins = false
    let name: string | undefined
    return text
        .split(/(?<=\n)/u)
        .map((full) => {
            const eol = /\r?\n$/u.exec(full)?.[0] ?? ""
            const line = full.slice(0, full.length - eol.length)
            if (TOP_LEVEL.test(line)) {
                inPins = PINS_KEY.test(line)
                name = undefined
            }
            if (!inPins) return full
            const row = ROW.exec(line)
            if (row !== null) {
                name = row[2]
                return full
            }
            const pin = name === undefined ? undefined : pins.get(name)
            const field = ROW_FIELD.exec(line)
            if (pin === undefined || field === null || (field[2] === "range" && !rangesToo)) return full
            const quote = field[3] ?? ""
            return `${field[1] ?? ""}${quote}${pin}${quote}${field[5] ?? ""}${eol}`
        })
        .join("")
}

/**
 * The edit of a copy's other files (pack-stamped.ts EntryEdit): every pin data file gets the pins `pinsFor` gives its text; any other file, and pin
 * data nothing moves, is kept. Pure.
 */
export const pinDataEdit = (pinsFor: (text: string) => ReadonlyMap<string, string>, rangesToo: boolean): ((path: string, text: string) => string | undefined) => (path, text) => {
    if (!isPinData(path)) return undefined
    const pins = pinsFor(text)
    return pins.size === 0 ? undefined : pinnedData(text, pins, rangesToo)
}

/** The pin data texts a package folder tracks (its copy ships them): every tracked file named PIN_DATA_FILE, outside node_modules. */
export const pinDataTexts = (dir: string): string[] => {
    const listed = captureGitSync(["ls-files", "-z", "--", "."], dir)
    if (listed.exitCode !== 0) return []
    return nulPaths(listed.stdout).filter((file) => isPinData(file) && !file.split("/").includes("node_modules")).map((file) => readFileSync(join(dir, file), "utf8"))
}

/** The pin data rows a copy moved, `name a -> b`, for the report. Pure. */
export const movedDataPins = (text: string, pins: ReadonlyMap<string, string>): string[] =>
    pinDataRows(text).filter((row) => row.version !== undefined && pins.has(row.name)).map((row) => `${row.name} ${row.version ?? ""} -> ${pins.get(row.name) ?? ""} (${PIN_DATA_FILE})`)

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
