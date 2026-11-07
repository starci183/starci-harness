import { meetsPin } from "./pin-range.js"

/** One plan row, as far as the peer judgement reads it. */
interface PeerRow {
    readonly package: string
    readonly version: string
    readonly action: string
}

/** One workspace package, as far as the peer judgement reads it. */
interface PeerPackage {
    readonly name: string
    readonly peers: Readonly<Record<string, string>>
}

const FLOOR = /^(\d+)\.(\d+)\.(\d+)$/u

const triple = (text: string): readonly [number, number, number] | undefined => {
    const match = FLOOR.exec(text.trim())
    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

const atLeast = (found: readonly [number, number, number], floor: readonly [number, number, number]): boolean =>
    found[0] !== floor[0] ? found[0] > floor[0] : found[1] !== floor[1] ? found[1] > floor[1] : found[2] >= floor[2]

/**
 * Whether a peer range admits a version: exact, a same-minor `~x.y.z`, a same-major `^x.y.z`, `>=x.y.z` and `*`; undefined for any
 * other spelling, which the judgement leaves alone. A range names no pre-release, so a pre-release version is admitted only by `*`.
 */
export const peerAdmits = (range: string, version: string): boolean | undefined => {
    const spec = range.trim()
    if (spec === "*") return true
    if (spec.startsWith("~")) return meetsPin(spec, version)
    const found = triple(version)
    if (spec.startsWith("^") || spec.startsWith(">=")) {
        const floor = triple(spec.slice(spec.startsWith("^") ? 1 : 2))
        if (floor === undefined) return undefined
        if (found === undefined) return false
        return spec.startsWith("^") ? found[0] === floor[0] && atLeast(found, floor) : atLeast(found, floor)
    }
    return triple(spec) === undefined ? undefined : spec === version.trim()
}

/**
 * The peers that exclude the version their sibling is installed at. A package judged is one the plan publishes, or one a stack pin
 * names at the version its folder holds (an app installs it from npm); each peer that is itself a workspace package is judged against
 * the version its stack pin names and the version the plan publishes for it. A canon peering `@starci/hfs` `~6.0.0` while the pins name hfs
 * 6.1.0 fails every install of the pinned set with ERESOLVE.
 */
export const peerSkews = (rows: readonly PeerRow[], packages: readonly PeerPackage[], pins: Readonly<Record<string, string>>): string[] => {
    const lines: string[] = []
    for (const row of rows) {
        const pinned = pins[row.package] === row.version
        if (row.action === "private" || !(row.action === "publish" || pinned)) continue
        for (const [name, range] of Object.entries(packages.find((pkg) => pkg.name === row.package)?.peers ?? {})) {
            const sibling = rows.find((candidate) => candidate.package === name)
            if (sibling === undefined) continue
            const versions = [pins[name], sibling.action === "publish" ? sibling.version : undefined].filter((version): version is string => version !== undefined)
            for (const version of new Set(versions)) {
                if (peerAdmits(range, version) === false) lines.push(`${row.package}@${row.version} peers ${name} ${range}, which excludes ${version}`)
            }
        }
    }
    return lines
}
