import { peerAdmits } from "../release/peer-range.js"

/** A package this publish puts on the local registry, with the peer ranges its folder declares. */
export interface PeerLineRow {
    readonly package: string
    readonly version: string
    readonly peers: Readonly<Record<string, string>>
}

/** What the local registry lists of one package: each version with the peer ranges it was published with; undefined when it lists none. */
export type ListedLine = Readonly<Record<string, Readonly<Record<string, string>>>> | undefined

/** The verdict on one publish: lines refused (a published version no sibling release can install beside) and lines warned. */
export interface PeerLineVerdict {
    readonly refused: readonly string[]
    readonly warned: readonly string[]
}

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/u

const order = (version: string): readonly number[] => (RELEASE.exec(version)?.slice(1) ?? []).map(Number)

const newer = (left: string, right: string): number => {
    const [a, b] = [order(left), order(right)]
    for (let index = 0; index < 3; index += 1) {
        const step = (a[index] ?? 0) - (b[index] ?? 0)
        if (step !== 0) return step
    }
    return 0
}

/** The newest plain release a listing holds (a pre-release such as `-rootpkgs.1` names no line an app installs). */
export const newestRelease = (line: ListedLine): string | undefined =>
    Object.keys(line ?? {})
        .filter((version) => RELEASE.test(version))
        .toSorted(newer)
        .at(-1)

/**
 * Judges the peer line of a publish to the local registry, so an app can install what it publishes together (CONTRIB-20; contexts/authority/packages.md "The local registry"):
 * - refused: a published version V of a package that a sibling peers (the canons and the Grammar lint peer `@starci/hfs`), when no
 *   release of that sibling, neither one the registry lists nor the one this publish carries, admits V. Every app that takes V
 *   then fails `npm ci` with ERESOLVE beside the sibling (hfs 6.8.3 beside `@starci/eslint-grammar-core` 0.37.38 peering `~6.7.0`);
 *   a sibling the registry does not list at all is skipped (nothing installs beside it yet). Also refused: a published sibling whose
 *   own range excludes the version this same publish carries of the package it peers.
 * - warned: a published sibling whose range excludes the newest release the registry lists of the package it peers (a Grammar patch
 *   cut on an older hfs minor): an app already on that newer line cannot install it.
 * `peerers` maps each workspace package name to the peer ranges its folder declares; `listed` answers the registry's listing.
 */
export const judgePeerLine = (due: readonly PeerLineRow[], peerers: Readonly<Record<string, Readonly<Record<string, string>>>>, listed: (name: string) => ListedLine): PeerLineVerdict => {
    const refused: string[] = []
    const warned: string[] = []
    for (const row of due) {
        for (const [sibling, peers] of Object.entries(peerers)) {
            if (sibling === row.package || peers[row.package] === undefined) continue
            const own = due.find((one) => one.package === sibling)
            const local = listed(sibling)
            const fix = `raise ${sibling}'s peer range to the new line in the commit that raises ${row.package}, and publish both`
            if (own !== undefined) {
                const range = own.peers[row.package]
                if (range !== undefined && peerAdmits(range, row.version) === false) refused.push(`${row.package}@${row.version}: ${sibling}@${own.version}, published with it, peers ${row.package} ${range}, which excludes it; ${fix}`)
                continue
            }
            if (local === undefined) continue
            const ranges = Object.values(local).map((one) => one[row.package]).filter((range): range is string => range !== undefined)
            if (ranges.length === 0 || ranges.some((range) => peerAdmits(range, row.version) !== false)) continue
            const newest = newestRelease(local)
            const theirs = newest === undefined ? "" : ` (the newest, ${sibling}@${newest}, peers ${row.package} ${local[newest]?.[row.package] ?? "nothing"})`
            refused.push(`${row.package}@${row.version}: no release of ${sibling} the local registry lists installs beside it${theirs}; ${fix}`)
        }
    }
    for (const row of due) {
        for (const [anchor, range] of Object.entries(row.peers)) {
            if (due.some((one) => one.package === anchor)) continue
            const newest = newestRelease(listed(anchor))
            if (newest === undefined || peerAdmits(range, newest) !== false) continue
            warned.push(`${row.package}@${row.version} peers ${anchor} ${range}, which excludes ${anchor}@${newest}, the newest the local registry lists: an app on that line cannot install it; cut it on the newest line too`)
        }
    }
    return { refused, warned }
}
