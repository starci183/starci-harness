/**
 * The version a package is published under in the local registry. It never touches the version committed in git: a version
 * is immutable in a registry, so each publish takes the next number of its own series, which sorts above the committed
 * version and below the next real one. A stable `1.2.3` publishes as `1.2.4-local.<n>`; a prerelease `1.1.0-alpha.85`, whose next
 * release is `1.1.0-alpha.86`, as `1.1.0-alpha.85.local.<n>`.
 */
const LOCAL_VERSION = /^(?<base>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+?)?)[-.]local\.(?<n>\d+)$/
const STABLE = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/

/** A local version split into the committed version it follows and its number in that series. */
export interface LocalVersion {
    readonly series: string
    readonly n: number
}

/** The local-version series of a committed version: the part every `-local.<n>` of it shares. */
export const seriesOf = (committed: string): string => {
    const stable = STABLE.exec(committed)
    if (stable?.groups === undefined) return committed
    const { major = "0", minor = "0", patch = "0" } = stable.groups
    return `${major}.${minor}.${String(Number(patch) + 1)}`
}

/** The version of the `n`th publish of a committed version. */
export const localVersionOf = (committed: string, n: number): string => (STABLE.test(committed) ? `${seriesOf(committed)}-local.${String(n)}` : `${committed}.local.${String(n)}`)

/** Whether a version is a local-registry version. */
export const isLocalVersion = (version: string): boolean => LOCAL_VERSION.test(version)

const parseLocal = (version: string): LocalVersion | undefined => {
    const groups = LOCAL_VERSION.exec(version)?.groups
    return groups === undefined ? undefined : { series: groups.base ?? "", n: Number(groups.n) }
}

/** The number the next publish of `committed` takes, given the versions the registry holds: one above the highest of its series, 1 for the first. */
export const nextLocalNumber = (committed: string, held: readonly string[]): number => {
    const own = STABLE.test(committed) ? seriesOf(committed) : committed
    const numbers = held.flatMap((version) => {
        const parsed = parseLocal(version)
        return parsed?.series === own ? [parsed.n] : []
    })
    return numbers.length === 0 ? 1 : Math.max(...numbers) + 1
}

/** The local version published last, by the registry's publish times (`npm view <name> time`); undefined when it holds none. */
export const latestLocal = (times: Readonly<Record<string, string>>): string | undefined =>
    Object.entries(times)
        .filter(([version]) => isLocalVersion(version))
        .toSorted((left, right) => Date.parse(right[1]) - Date.parse(left[1]) || right[0].localeCompare(left[0], undefined, { numeric: true }))
        .at(0)?.[0]
