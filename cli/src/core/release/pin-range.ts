/**
 * Whether a version meets a pin, the CLI's copy of @starci/hfs `runtime/scripts/lib/pin-range.mjs` (decision grammar-patch-range): an exact pin
 * meets only itself; a same-minor range `~x.y.z` meets an exact version of that major and minor at or above the floor, and a pre-release only
 * when the range names a pre-release of that same version. The CLI keeps its own copy because it judges its siblings before @starci/hfs ships.
 */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u

interface Parsed { readonly major: number; readonly minor: number; readonly patch: number; readonly pre: readonly string[] }

const parse = (text: string): Parsed | undefined => {
    const match = VERSION.exec(text.trim())
    if (match === null) return undefined
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] === undefined ? [] : match[4].split(".") }
}

const comparePre = (a: readonly string[], b: readonly string[]): number => {
    if (a.length === 0 || b.length === 0) return (a.length === 0 ? 1 : 0) - (b.length === 0 ? 1 : 0)
    for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
        const x = a[at]
        const y = b[at]
        if (x === undefined) return -1
        if (y === undefined) return 1
        const nx = /^\d+$/u.test(x)
        const ny = /^\d+$/u.test(y)
        if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y)
        if (nx !== ny) return nx ? -1 : 1
        if (x !== y) return x < y ? -1 : 1
    }
    return 0
}

/** True when `version` meets `pin`, exact or a same-minor range. */
export const meetsPin = (pin: string, version: string): boolean => {
    const trimmed = pin.trim()
    if (!trimmed.startsWith("~")) return trimmed === version.trim()
    const floor = parse(trimmed.slice(1))
    const found = parse(version)
    if (floor === undefined || found?.major !== floor.major || found.minor !== floor.minor) return false
    if (found.pre.length > 0) return floor.pre.length > 0 && found.patch === floor.patch && comparePre(found.pre, floor.pre) >= 0
    return found.patch >= floor.patch
}
