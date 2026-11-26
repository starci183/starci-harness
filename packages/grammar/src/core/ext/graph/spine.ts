import { ISLAND_GAP, ISLANDS_WIDTH, NODE_WIDTH, estimateLabel, isAncestor, islandsOf, treeOf, usableLinks, type Bar, type Box, type FlowLayout, type LayoutSettings, type LinkEnds, type Route, type SizedNode, type Tree } from "./layout.js"
import type { GraphPosition } from "./types.js"

/**
 * THE SPINE LAYOUT of a `FlowGraph` (owner decision 2026-11-26, the default `layout`). A flow reads down one straight column:
 *
 * 1. **The spine.** The longest path from the start to an end that follows `ok`, `yes` and `parallel` edges is one column, every node on it centred on the
 *    same x. Side roads stand in columns to its right, at `x = spine + lane * (NODE_WIDTH + columnGap)`; the branches of a parallel fork split evenly round
 *    their fork, `lane = i - (n - 1) / 2`; nodes of one layer share one centre y.
 * 2. **Four midpoint ports, the fewest bends.** An edge attaches only at the middle of a side: IN at the top-mid (a forward edge) or the left-mid (a loop), OUT at
 *    the bottom-mid (the main road: `ok`, `yes`, `parallel`), the right-mid (a side road: `no`, `timeout`, `refused`, `declined`) or the left-mid (a loop).
 *    A main road in one column is straight (0 bends); a side road turns once (right-mid, across, down into the top-mid); a road that meets the spine again
 *    drops to the gap above its target and runs across (1 bend); a loop is a U on the left (2 bends); a fork and a join are bars (0 bends per branch).
 * 3. **One segment per port.** Two forward edges into one node meet at a merge point (a dot) in the gap right above it and one arrow goes on into its
 *    top-mid; three or more drop straight down their own columns into a merge bar right above the target (spanning the source columns and the target's), and one neutral arrow leaves it over the target.
 *    Loops into one node gather in its left lane into one stroke.
 *
 * Every horizontal run lies in the gap between two rows (or on its source's own row, out of its right-mid), never across a node; runs that share a gap
 * stand `edgeSpacing` apart. The layout is plain code, not ELK: ELK's layered placement cannot hold a column grid or midpoint-only ports, and its router
 * merges and bends edges past the bend budget, so every coordinate here is computed from the layers, the lanes and the gaps. The same graph always gets
 * the same layout, in whole pixels.
 */
export const SPINE = {
    /** The free room between two columns, and between two rows (before extra tracks). */
    columnGap: 80,
    rowGap: 72,
    /** Two horizontal runs in one gap, and two loop lanes side by side, stand this far apart. */
    edgeSpacing: 14,
    /** How far a loop's lane stands left of the nodes it passes. */
    laneLead: 32,
    /** A side road that cannot run straight across first steps this far out of its source's right side. */
    sideStep: 16,
    /** The words of an edge keep this far from its line. */
    labelGap: 6,
    /** The least half width of a merge bar. */
    barReach: 24,
} as const

/** The id of a fork or merge bar starts with this (it is no node of the app). */
export const BAR_PREFIX = "starci-bar:"

/** The pitch of the columns. */
export const COLUMN_PITCH = NODE_WIDTH + SPINE.columnGap

const MAIN = new Set(["ok", "yes", "parallel"])

type Point = readonly [number, number]

interface Rect {
    readonly l: number
    readonly t: number
    readonly r: number
    readonly b: number
}

/** A link as the layout reads it. */
type Link = LinkEnds & { readonly id: string }

/** One link on the leaves: its ends mapped from a container to the leaf it enters or leaves by. */
interface Leg {
    readonly link: Link
    readonly from: string
    readonly to: string
    readonly main: boolean
    readonly parallel: boolean
    /** A loop's edge, or an edge the layout breaks a cycle at. */
    back: boolean
}

const kindOf = (link: LinkEnds): string => link.kind ?? (link.back === true ? "loop" : "ok")
const isLoop = (link: LinkEnds): boolean => link.back === true || kindOf(link) === "loop"


/** The points without repeats and without a middle point on a straight run. */
const tidy = (points: readonly Point[]): Point[] => {
    const out: Point[] = []
    for (const point of points) {
        const last = out[out.length - 1]
        if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue
        const before = out[out.length - 2]
        if (before !== undefined && last !== undefined && ((before[0] === last[0] && last[0] === point[0]) || (before[1] === last[1] && last[1] === point[1]))) out[out.length - 1] = point
        else out.push(point)
    }
    return out
}

/** The members of every container: the leaves under it, at any depth. */
const membersOf = (tree: Tree): ReadonlyMap<string, readonly string[]> => {
    const out = new Map<string, string[]>()
    const walk = (id: string): string[] => {
        const kids = tree.kids.get(id) ?? []
        if (kids.length === 0) return [id]
        const all = kids.flatMap(walk)
        out.set(id, all)
        return all
    }
    for (const root of tree.roots) walk(root)
    return out
}

const depthOf = (tree: Tree, id: string): number => {
    let n = 0
    for (let at = tree.parent.get(id); at !== undefined; at = tree.parent.get(at)) n += 1
    return n
}

/** The nearest container that holds both nodes, if any. */
const commonParent = (tree: Tree, a: string, b: string): string | undefined => {
    const above = new Set<string>()
    for (let at = tree.parent.get(a); at !== undefined; at = tree.parent.get(at)) above.add(at)
    if (tree.kids.has(a)) above.add(a)
    for (let at: string | undefined = b; at !== undefined; at = tree.parent.get(at)) if (above.has(at) && at !== b) return at
    return undefined
}

/** The middle one of a list (the earlier of two middles): a fork's spine branch, a tie of spine starts. */
const median = <T>(items: readonly T[]): T | undefined => items[Math.floor((items.length - 1) / 2)]

interface IslandOut {
    readonly rects: Map<string, Rect>
    readonly routes: Map<string, { points: Point[]; label?: Rect; end: "arrow" | "join" | "bar" }>
    readonly bars: Bar[]
}

/**
 * Lays out one island (a part of the graph joined by edges): the layers, the spine, the lanes, the rows and gaps, the loops and frames, then every
 * forward route and the words of every edge. Its coordinates are its own; the caller packs the islands.
 */
const layoutIsland = (tree: Tree, members: ReadonlyMap<string, readonly string[]>, island: readonly string[], links: readonly Link[], sizes: ReadonlyMap<string, SizedNode>, measure: (text: string) => Box): IslandOut => {
    const leaves = island.flatMap((id) => members.get(id) ?? [id])
    const order = new Map(leaves.map((id, index) => [id, index] as const))
    const isLeaf = (id: string): boolean => !members.has(id)
    const containers = [...members.keys()].filter((id) => island.some((top) => top === id || isAncestor(tree, top, id))).sort((a, b) => depthOf(tree, b) - depthOf(tree, a))
    const memberSet = new Map(containers.map((id) => [id, new Set(members.get(id) ?? [])] as const))
    const inside = (container: string, leaf: string): boolean => memberSet.get(container)?.has(leaf) === true

    // 1. The legs: each link on the leaves. A container is entered by the first of its members no other member leads into, and left by the last that leads
    //    to no other member (read from the links between leaves).
    const leafLinks = links.filter((link) => isLeaf(link.source) && isLeaf(link.target) && !isLoop(link))
    const entryOf = new Map<string, string>()
    const exitOf = new Map<string, string>()
    for (const container of containers) {
        const set = memberSet.get(container) ?? new Set<string>()
        const all = [...set].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
        const entered = new Set(leafLinks.filter((link) => set.has(link.source) && set.has(link.target)).map((link) => link.target))
        const leaving = new Set(leafLinks.filter((link) => set.has(link.source) && set.has(link.target)).map((link) => link.source))
        entryOf.set(container, all.find((id) => !entered.has(id)) ?? all[0] ?? container)
        exitOf.set(container, [...all].reverse().find((id) => !leaving.has(id)) ?? all[all.length - 1] ?? container)
    }
    const fromLeaf = (id: string): string => (isLeaf(id) ? id : (exitOf.get(id) ?? id))
    const toLeaf = (id: string): string => (isLeaf(id) ? id : (entryOf.get(id) ?? id))
    const legs: Leg[] = links.map((link) => ({ link, from: fromLeaf(link.source), to: toLeaf(link.target), main: MAIN.has(kindOf(link)), parallel: kindOf(link) === "parallel", back: isLoop(link) }))
    const legOf = new Map(legs.map((leg) => [leg.link.id, leg] as const))

    // 2. A cycle that is not marked as a loop is broken at the edge that closes it (depth first, in the order given), which is drawn as a loop.
    {
        const state = new Map<string, 1 | 2>()
        const leaving = (id: string): Leg[] => legs.filter((leg) => !leg.back && leg.from === id)
        const visit = (id: string): void => {
            state.set(id, 1)
            for (const leg of leaving(id)) {
                const seen = state.get(leg.to)
                if (seen === 1) leg.back = true
                else if (seen === undefined) visit(leg.to)
            }
            state.set(id, 2)
        }
        for (const id of leaves) if (!state.has(id)) visit(id)
    }
    const forward = legs.filter((leg) => !leg.back && leg.from !== leg.to)
    const ins = (id: string): Leg[] => forward.filter((leg) => leg.to === id)
    const outs = (id: string): Leg[] => forward.filter((leg) => leg.from === id)

    // 3. The layers: the longest path from a start; whatever leaves a container stands below all of it, whatever enters one above all of it; a second start
    //    stands right above the first step it leads to.
    const layer = new Map<string, number>(leaves.map((id) => [id, 0] as const))
    const at = (id: string): number => layer.get(id) ?? 0
    const lift = (id: string, value: number): boolean => {
        if (at(id) >= value) return false
        layer.set(id, value)
        return true
    }
    for (let round = 0, changed = true; changed && round < leaves.length * 2 + 4; round += 1) {
        changed = false
        for (const leg of forward) changed = lift(leg.to, at(leg.from) + 1) || changed
        for (const container of containers) {
            const set = memberSet.get(container)
            if (set === undefined) continue
            const deepest = Math.max(...[...set].map(at))
            for (const leg of forward) {
                if (set.has(leg.from) && !set.has(leg.to)) changed = lift(leg.to, deepest + 1) || changed
                if (!set.has(leg.from) && set.has(leg.to)) for (const member of set) changed = lift(member, at(leg.from) + 1) || changed
            }
        }
    }
    for (const id of leaves) {
        if (ins(id).length > 0 || tree.parent.has(id)) continue
        const next = outs(id).map((leg) => at(leg.to))
        if (next.length > 0) layer.set(id, Math.max(at(id), Math.min(...next) - 1))
    }
    const lowest = Math.min(...leaves.map(at))
    for (const id of leaves) layer.set(id, at(id) - lowest)

    // 4. The spine: the longest run of main edges from a start; of equal runs the middle one, so a fan of equal branches keeps its middle on the spine.
    const down = new Map<string, number>()
    for (const id of [...leaves].sort((a, b) => at(b) - at(a))) down.set(id, 1 + Math.max(0, ...outs(id).filter((leg) => leg.main && at(leg.to) > at(id)).map((leg) => down.get(leg.to) ?? 0)))
    const starts = leaves.filter((id) => ins(id).length === 0)
    const best = Math.max(0, ...starts.map((id) => down.get(id) ?? 0))
    const spine: string[] = []
    for (let cursor = median(starts.filter((id) => (down.get(id) ?? 0) === best)) ?? leaves[0]; cursor !== undefined && !spine.includes(cursor); ) {
        spine.push(cursor)
        const options = outs(cursor).filter((leg) => leg.main && at(leg.to) > at(cursor as string))
        const top = Math.max(0, ...options.map((leg) => down.get(leg.to) ?? 0))
        const tied = options.filter((leg) => (down.get(leg.to) ?? 0) === top)
        const pick = tied.find((leg) => kindOf(leg.link) === "yes") ?? (tied.every((leg) => leg.parallel) ? median(tied) : tied[0])
        cursor = pick?.to
    }
    const onSpine = new Set(spine)

    // 5. The lanes: the spine is lane 0; a chain (a node and the main steps after it that nothing else leads into) keeps its lane.
    const lane = new Map<string, number>()
    const branchOf = new Map<string, string>()
    const reserved: { readonly lane: number; readonly from: number; readonly to: number }[] = []
    for (const id of spine) lane.set(id, 0)
    const chainFrom = (start: string, takeSpine: boolean): string[] => {
        const chain: string[] = []
        for (let cursor: string | undefined = start; cursor !== undefined && !chain.includes(cursor); ) {
            if (cursor !== start && (ins(cursor).length > 1 || (lane.has(cursor) && !(takeSpine && onSpine.has(cursor))))) break
            chain.push(cursor)
            cursor = outs(cursor).find((leg) => leg.main && at(leg.to) > at(cursor as string))?.to
        }
        return chain
    }
    const columnOverlaps = (a: number, b: number): boolean => Math.abs(a - b) < 1
    const busy = (value: number, from: number, to: number, own: ReadonlySet<string>): boolean =>
        leaves.some((id) => !own.has(id) && lane.has(id) && columnOverlaps(lane.get(id) ?? 0, value) && at(id) >= from && at(id) <= to) ||
        reserved.some((span) => columnOverlaps(span.lane, value) && span.from <= to && span.to >= from)
    /** The span a chain holds in its column: its own rows, and the rows its last step drops through to the node it leads to. */
    const spanOf = (chain: readonly string[]): readonly [number, number] => {
        const first = chain[0]
        const last = chain[chain.length - 1]
        if (first === undefined || last === undefined) return [0, 0]
        const after = outs(last).map((leg) => at(leg.to) - 1)
        return [at(first), Math.max(at(last), ...after)]
    }
    const place = (chain: readonly string[], value: number, fork?: string): void => {
        const [from, to] = spanOf(chain)
        for (const id of chain) {
            lane.set(id, value)
            if (fork !== undefined) branchOf.set(id, fork)
        }
        reserved.push({ lane: value, from, to })
    }
    /** The first free column right of `base` (or `base` itself when `here`) over a chain's span. */
    const freeRight = (base: number, chain: readonly string[], here: boolean): number => {
        const [from, to] = spanOf(chain)
        const own = new Set(chain)
        for (let k = here ? 0 : 1; ; k += 1) if (!busy(base + k, from, to, own)) return base + k
    }
    const fan = (targets: readonly string[], base: number, fork: string): void => {
        // The spine's branch stands in the middle of an odd fan.
        const ordered = [...targets]
        const spineAt = ordered.findIndex((id) => onSpine.has(id))
        if (spineAt >= 0 && ordered.length % 2 === 1) ordered.splice(Math.floor(ordered.length / 2), 0, ...ordered.splice(spineAt, 1))
        ordered.forEach((id, index) => {
            place(chainFrom(id, true), base + index - (ordered.length - 1) / 2, fork)
        })
    }
    // A fan of starts that all lead into one node is a parallel fan round that node.
    const startChains = starts.map((id) => chainFrom(id, true))
    const joins = new Set(startChains.map((chain) => outs(chain[chain.length - 1] ?? "").find((leg) => leg.main)?.to ?? ""))
    if (starts.length > 1 && joins.size === 1 && !joins.has("")) fan(starts, 0, "\u0000starts")
    const sweep = (): void => {
        for (const id of [...leaves].sort((a, b) => at(a) - at(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0))) {
            const base = lane.get(id)
            if (base === undefined) continue
            const going = outs(id).filter((leg) => at(leg.to) > at(id))
            const parallel = going.filter((leg) => leg.parallel && ins(leg.to).length === 1 && (!lane.has(leg.to) || onSpine.has(leg.to)) && branchOf.get(leg.to) === undefined)
            if (parallel.length >= 2) fan(parallel.map((leg) => leg.to), base, id)
            for (const leg of going) {
                if (lane.has(leg.to)) continue
                const chain = chainFrom(leg.to, false)
                place(chain, freeRight(base, chain, leg.main))
            }
        }
    }
    sweep()
    // A start or a step nothing placed yet (a second start that joins later) takes the first free column right of the node it leads to.
    for (let left = leaves.filter((id) => !lane.has(id)); left.length > 0; left = leaves.filter((id) => !lane.has(id))) {
        const next = [...left].sort((a, b) => at(a) - at(b))[0] as string
        const target = outs(next).map((leg) => leg.to).find((id) => lane.has(id))
        const chain = chainFrom(next, false)
        place(chain, target === undefined ? Math.max(0, ...lane.values()) + 1 : freeRight(lane.get(target) ?? 0, chain, false))
        sweep()
    }
    // A node outside a frame never stands inside the frame's columns: it moves past the frame's last column.
    for (const container of [...containers].reverse()) {
        const set = memberSet.get(container)
        if (set === undefined) continue
        const own = [...set]
        const lanes = own.map((id) => lane.get(id) ?? 0)
        const rows = own.map(at)
        const [lo, hi, top, bottom] = [Math.min(...lanes), Math.max(...lanes), Math.min(...rows), Math.max(...rows)]
        for (const id of leaves) {
            if (set.has(id) || at(id) < top || at(id) > bottom) continue
            const value = lane.get(id) ?? 0
            if (value > lo - 1 && value < hi + 1) lane.set(id, value >= (lo + hi) / 2 ? hi + 1 : lo - 1)
        }
    }
    const cx = (id: string): number => (lane.get(id) ?? 0) * COLUMN_PITCH
    const width = (id: string): number => sizes.get(id)?.width ?? NODE_WIDTH
    const height = (id: string): number => sizes.get(id)?.height ?? 64
    const span = (id: string): readonly [number, number] => [cx(id) - width(id) / 2, cx(id) + width(id) / 2]

    // 6. What each forward link is: one into a node alone, one of two into a merge point, one of three or more (or of a join) into a merge bar, a branch of a fork.
    const forwardLinks = links.filter((link) => !(legOf.get(link.id)?.back ?? true))
    const byTarget = new Map<string, Link[]>()
    for (const link of forwardLinks) byTarget.set(link.target, [...(byTarget.get(link.target) ?? []), link])
    type Mode = "single" | "merge" | "bar"
    const modeOf = new Map<string, Mode>()
    for (const [target, list] of byTarget) {
        const forks = new Set(list.map((link) => branchOf.get(legOf.get(link.id)?.from ?? "") ?? ""))
        const join = list.length >= 2 && forks.size === 1 && !forks.has("")
        modeOf.set(target, list.length >= 3 || join ? "bar" : list.length === 2 ? "merge" : "single")
    }
    const rowOfTarget = (target: string): number => at(toLeaf(target))
    const targetX = (target: string): number => cx(toLeaf(target))
    const sourceX = (link: Link): number => cx(legOf.get(link.id)?.from ?? link.source)
    const isMain = (link: Link): boolean => legOf.get(link.id)?.main ?? true
    // A drop down a column must pass no node between its two rows.
    const columnClear = (x: number, fromRow: number, toRow: number, except: ReadonlySet<string>): boolean =>
        !leaves.some((id) => !except.has(id) && at(id) > fromRow && at(id) < toRow && span(id)[0] - 8 < x && span(id)[1] + 8 > x)
    // The direct road of a side edge: across its source's own row to the target's column, then down into it.
    const directClear = (link: Link): boolean => {
        const leg = legOf.get(link.id)
        if (leg === undefined) return false
        const from = leg.from
        const right = span(from)[1]
        const x = targetX(link.target)
        if (x <= right + SPINE.sideStep) return false
        const except = new Set([from, leg.to])
        const rowBlocked = leaves.some((id) => !except.has(id) && at(id) === at(from) && span(id)[1] > right && span(id)[0] < x + 8)
        const frameBlocked = containers.some((container) => {
            if (inside(container, from) || inside(container, leg.to)) return false
            const own = members.get(container) ?? []
            const rows = own.map(at)
            return at(from) >= Math.min(...rows) && at(from) <= Math.max(...rows) && Math.max(...own.map((id) => span(id)[1])) + 24 > right && Math.min(...own.map((id) => span(id)[0])) - 24 < x
        })
        return !rowBlocked && !frameBlocked && columnClear(x, at(from), rowOfTarget(link.target), except)
    }
    // Where each link of a merge point or bar drops. Into a bar every source drops straight down its own column, whatever its kind; a source whose column is
    // blocked below (a spine step with a side road into the bar) steps out of its right-mid to the first clear column. Into a merge point a main road drops
    // down its own column the same way, and a side road runs across its own row to the target's column (one step out when that row is not clear).
    const dropX = new Map<string, number>()
    const sideDrop = new Set<string>()
    for (const [target, list] of byTarget) {
        const mode = modeOf.get(target)
        if (mode === "single") continue
        for (const link of list) {
            const from = legOf.get(link.id)?.from ?? link.source
            const except = new Set([from, toLeaf(target)])
            const own = sourceX(link)
            if (mode === "merge" && !isMain(link)) {
                const x = targetX(target)
                sideDrop.add(link.id)
                dropX.set(link.id, x > span(from)[1] + SPINE.sideStep && directClear(link) ? x : span(from)[1] + SPINE.sideStep)
                continue
            }
            if (columnClear(own, at(from), rowOfTarget(target), except)) {
                dropX.set(link.id, own)
                continue
            }
            sideDrop.add(link.id)
            let x = own
            for (let step = 1; step < 12; step += 1) {
                x = own + (step * COLUMN_PITCH) / 2
                if (columnClear(x, at(from) - 1, rowOfTarget(target), except)) break
            }
            dropX.set(link.id, x)
        }
    }
    // The forks: a step with two or more parallel branches that each have it alone above them.
    const forks = new Map<string, Link[]>()
    for (const link of forwardLinks) {
        const leg = legOf.get(link.id)
        if (leg === undefined || !leg.parallel || modeOf.get(link.target) !== "single") continue
        forks.set(link.source, [...(forks.get(link.source) ?? []), link])
    }
    for (const [source, list] of forks) if (list.length < 2) forks.delete(source)
    const inFork = new Set([...forks.values()].flat().map((link) => link.id))
    const direct = new Map(forwardLinks.map((link) => [link.id, !isMain(link) && modeOf.get(link.target) === "single" && !inFork.has(link.id) && directClear(link)] as const))

    // 7. The tracks: every run across a gap gets a height of its own in the gap, and runs whose spans meet stand `edgeSpacing` apart.
    interface Run {
        readonly key: string
        readonly row: number
        readonly l: number
        readonly r: number
    }
    const runs: Run[] = []
    for (const [target, list] of byTarget) {
        const mode = modeOf.get(target)
        const x = targetX(target)
        if (mode === "single") {
            const link = list[0] as Link
            if (inFork.has(link.id) || direct.get(link.id) === true) continue
            const from = isMain(link) ? sourceX(link) : span(legOf.get(link.id)?.from ?? link.source)[1] + SPINE.sideStep
            if (from !== x) runs.push({ key: `t:${target}`, row: rowOfTarget(target), l: Math.min(from, x), r: Math.max(from, x) })
            continue
        }
        const xs = list.map((link) => dropX.get(link.id) ?? sourceX(link))
        const reach = mode === "bar" ? SPINE.barReach : 0
        runs.push({ key: `t:${target}`, row: rowOfTarget(target), l: Math.min(x - reach, ...xs), r: Math.max(x + reach, ...xs) })
    }
    for (const [source, list] of forks) {
        const xs = list.map((link) => targetX(link.target))
        runs.push({ key: `f:${source}`, row: Math.min(...list.map((link) => rowOfTarget(link.target))), l: Math.min(cx(fromLeaf(source)), ...xs), r: Math.max(cx(fromLeaf(source)), ...xs) })
    }
    const trackOf = new Map<string, number>()
    const tracks = new Map<number, number>()
    for (const row of new Set(runs.map((run) => run.row))) {
        const lines: number[] = []
        for (const run of runs.filter((each) => each.row === row).sort((a, b) => a.l - b.l)) {
            let index = lines.findIndex((end) => end < run.l - 12)
            if (index < 0) {
                index = lines.length
                lines.push(run.r)
            } else lines[index] = run.r
            trackOf.set(run.key, index)
        }
        tracks.set(row, lines.length)
    }

    // 8. The rows: each layer's nodes share one centre y; a frame that opens on a row adds its header above it, one that closes adds its foot below it.
    const rows = Math.max(0, ...leaves.map(at)) + 1
    const rowHeight = Array.from({ length: rows }, (_, row) => Math.max(64, ...leaves.filter((id) => at(id) === row).map(height)))
    const head = Array.from({ length: rows }, () => 0)
    const foot = Array.from({ length: rows }, () => 0)
    for (const container of containers) {
        const own = (members.get(container) ?? []).map(at)
        const insets = sizes.get(container)?.insets
        head[Math.min(...own)] = (head[Math.min(...own)] ?? 0) + (insets?.top ?? 48)
        foot[Math.max(...own)] = (foot[Math.max(...own)] ?? 0) + (insets?.bottom ?? 24)
    }
    const gap = (row: number): number => SPINE.rowGap + Math.max(0, (tracks.get(row) ?? 1) - 1) * SPINE.edgeSpacing
    const centre: number[] = []
    const gapTop: number[] = []
    for (let row = 0; row < rows; row += 1) {
        const before = row === 0 ? 0 : (centre[row - 1] ?? 0) + (rowHeight[row - 1] ?? 0) / 2 + (foot[row - 1] ?? 0)
        gapTop[row] = before
        centre[row] = before + (row === 0 ? 0 : gap(row)) + (head[row] ?? 0) + (rowHeight[row] ?? 0) / 2
    }
    const trackY = (key: string, row: number): number => {
        const count = tracks.get(row) ?? 1
        return Math.round((gapTop[row] ?? 0) + gap(row) / 2 + ((trackOf.get(key) ?? 0) - (count - 1) / 2) * SPINE.edgeSpacing)
    }
    const rects = new Map<string, Rect>()
    for (const id of leaves) {
        const x = Math.round(cx(id) - width(id) / 2)
        const y = Math.round((centre[at(id)] ?? 0) - height(id) / 2)
        rects.set(id, { l: x, t: y, r: x + width(id), b: y + height(id) })
    }

    // 9. The loops and the frames, innermost first: a frame holds its members, the frames inside it, and the lanes and words of the loops inside it.
    const routes = new Map<string, { points: Point[]; label?: Rect; end: "arrow" | "join" | "bar" }>()
    const lanes: { readonly x: number; readonly t: number; readonly b: number }[] = []
    const extras = new Map<string, Rect[]>()
    const backLinks = links.filter((link) => legOf.get(link.id)?.back === true)
    const holderOf = (link: Link): string | undefined => commonParent(tree, link.source, link.target)
    const routeLoops = (holder: string | undefined): void => {
        const mine = backLinks.filter((link) => holderOf(link) === holder)
        const byLoopTarget = new Map<string, Link[]>()
        for (const link of mine) byLoopTarget.set(link.target, [...(byLoopTarget.get(link.target) ?? []), link])
        const groups = [...byLoopTarget.values()].flatMap((group) => {
            const into = rects.get(group[0]?.target ?? "")
            const ends = group.flatMap((link) => {
                const from = rects.get(link.source)
                return from === undefined ? [] : [{ link, from }]
            })
            if (into === undefined || ends.length === 0) return []
            return [{ group: ends, into, reach: Math.max(...ends.map((end) => Math.abs((end.from.t + end.from.b) / 2 - (into.t + into.b) / 2))) }]
        })
        // A short loop takes the lane next to the steps; a longer one goes round it.
        for (const { group, into } of groups.sort((a, b) => a.reach - b.reach)) {
            const ty = Math.round((into.t + into.b) / 2)
            const ys = group.map((end) => Math.round((end.from.t + end.from.b) / 2))
            const lo = Math.min(ty, ...ys)
            const hi = Math.max(ty, ...ys)
            const ends = new Set([group[0]?.link.target ?? "", ...group.map((end) => end.link.source)])
            const obstacles: Rect[] = []
            for (const [id, rect] of rects) {
                if (ends.has(id)) continue
                if (members.has(id) && [...ends].some((end) => end === id || isAncestor(tree, id, end))) continue
                obstacles.push(rect)
            }
            let x = Math.min(into.l, ...group.map((end) => end.from.l)) - SPINE.laneLead
            for (let round = 0; round < 64; round += 1) {
                const crossing = obstacles.find((rect) => {
                    const vertical = rect.t < hi + 4 && rect.b > lo - 4 && rect.l - 12 < x && rect.r + 12 > x
                    const across = [ty, ...ys].some((y) => rect.t < y && rect.b > y && rect.r > x && rect.l < Math.max(into.l, ...group.map((end) => end.from.l)))
                    return vertical || across
                })
                const neighbour = lanes.find((other) => Math.abs(other.x - x) < SPINE.edgeSpacing && other.t < hi && other.b > lo)
                if (crossing !== undefined) x = Math.min(x - 1, crossing.l - SPINE.laneLead)
                else if (neighbour !== undefined) x = neighbour.x - SPINE.edgeSpacing
                else break
            }
            x = Math.round(x)
            lanes.push({ x, t: lo, b: hi })
            const carrier = group.reduce((far, end) => (Math.abs((end.from.t + end.from.b) / 2 - ty) > Math.abs((far.from.t + far.from.b) / 2 - ty) ? end : far))
            const kept = extras.get(holder ?? "") ?? []
            kept.push({ l: x, t: lo, r: x, b: hi })
            for (const end of group) {
                const sy = Math.round((end.from.t + end.from.b) / 2)
                const points: Point[] = end === carrier ? [[end.from.l, sy], [x, sy], [x, ty], [into.l, ty]] : [[end.from.l, sy], [x, sy]]
                const words = end.link.label === undefined || end.link.label === "" ? undefined : measure(end.link.label)
                // The carrier's words stand on the stretch only it draws: between the target and the first loop that joins it.
                const joins = group.filter((other) => other !== carrier).map((other) => Math.round((other.from.t + other.from.b) / 2))
                const nearest = joins.length === 0 ? undefined : joins.reduce((a, b) => (Math.abs(a - ty) < Math.abs(b - ty) ? a : b))
                const middle = end === carrier ? (nearest === undefined ? (lo + hi) / 2 : (ty + nearest) / 2) : sy
                const label = words === undefined ? undefined : { l: Math.round(x - SPINE.labelGap - words.width), t: Math.round(middle - words.height / 2), r: Math.round(x - SPINE.labelGap), b: Math.round(middle + words.height / 2) }
                if (label !== undefined) kept.push(label)
                routes.set(end.link.id, { points: tidy(points), ...(label === undefined ? {} : { label }), end: end === carrier ? "arrow" : "join" })
            }
            extras.set(holder ?? "", kept)
        }
    }
    for (const container of containers) {
        routeLoops(container)
        const parts = [...(tree.kids.get(container) ?? []).map((kid) => rects.get(kid)).filter((rect): rect is Rect => rect !== undefined), ...(extras.get(container) ?? [])]
        if (parts.length === 0) continue
        const insets = sizes.get(container)?.insets
        const pad = { top: insets?.top ?? 48, left: insets?.left ?? 24, right: insets?.right ?? 24, bottom: insets?.bottom ?? 24 }
        let l = Math.min(...parts.map((rect) => rect.l)) - pad.left
        let r = Math.max(...parts.map((rect) => rect.r)) + pad.right
        const least = sizes.get(container)?.width ?? 0
        if (r - l < least) {
            const grow = (least - (r - l)) / 2
            l -= grow
            r += grow
        }
        rects.set(container, { l: Math.round(l), t: Math.round(Math.min(...parts.map((rect) => rect.t)) - pad.top), r: Math.round(r), b: Math.round(Math.max(...parts.map((rect) => rect.b)) + pad.bottom) })
    }
    routeLoops(undefined)

    // 10. The forward routes, each from the midpoint its kind leaves by to the top-mid of its target (a frame's top, over its entry column).
    const sourceRect = (link: Link): Rect => rects.get(link.source) ?? rects.get(fromLeaf(link.source)) ?? { l: 0, t: 0, r: 0, b: 0 }
    const bottomOut = (link: Link): Point => {
        const own = sourceRect(link)
        return [isLeaf(link.source) ? Math.round((own.l + own.r) / 2) : cx(fromLeaf(link.source)), own.b]
    }
    const rightOut = (link: Link): Point => {
        const own = sourceRect(link)
        return [own.r, Math.round(isLeaf(link.source) ? (own.t + own.b) / 2 : ((rects.get(fromLeaf(link.source))?.t ?? own.t) + (rects.get(fromLeaf(link.source))?.b ?? own.b)) / 2)]
    }
    const entry = (target: string): Point => {
        const own = rects.get(target) ?? { l: 0, t: 0, r: 0, b: 0 }
        return [isLeaf(target) ? Math.round((own.l + own.r) / 2) : targetX(target), own.t]
    }
    const bars: Bar[] = []
    for (const [target, list] of byTarget) {
        const mode = modeOf.get(target) ?? "single"
        const into = entry(target)
        const row = rowOfTarget(target)
        if (mode === "single") {
            const link = list[0] as Link
            if (inFork.has(link.id)) continue
            const y = trackY(`t:${target}`, row)
            if (isMain(link)) {
                const out = bottomOut(link)
                routes.set(link.id, { points: tidy(out[0] === into[0] ? [out, into] : [out, [out[0], y], [into[0], y], into]), end: "arrow" })
            } else {
                const out = rightOut(link)
                const step = out[0] + SPINE.sideStep
                routes.set(link.id, { points: tidy(direct.get(link.id) === true ? [out, [into[0], out[1]], into] : [out, [step, out[1]], [step, y], [into[0], y], into]), end: "arrow" })
            }
            continue
        }
        const y = trackY(`t:${target}`, row)
        if (mode === "merge") {
            // The carrier runs on into the target: the edge already in its column, else the first; the other ends at the merge point with a dot.
            const carrier = list.find((link) => isMain(link) && !sideDrop.has(link.id) && bottomOut(link)[0] === into[0]) ?? list[0]
            for (const link of list) {
                const x = dropX.get(link.id) ?? sourceX(link)
                const head: Point[] = sideDrop.has(link.id) ? [rightOut(link), [x, rightOut(link)[1]]] : [bottomOut(link)]
                const points: Point[] = [...head, [x, y], [into[0], y]]
                routes.set(link.id, link === carrier ? { points: tidy([...points, into]), end: "arrow" } : { points: tidy(points), end: "join" })
            }
            continue
        }
        // A merge bar: every source drops straight down its own column into the bar; the bar carries the one arrow.
        const xs: number[] = []
        for (const link of list) {
            const x = dropX.get(link.id) ?? sourceX(link)
            xs.push(x)
            const head: Point[] = sideDrop.has(link.id) ? [rightOut(link), [x, rightOut(link)[1]]] : [bottomOut(link)]
            routes.set(link.id, { points: tidy([...head, [x, y]]), end: "bar" })
        }
        // The bar spans its leftmost to its rightmost source column and the target's own (never a stub out to where no edge drops).
        const l = Math.min(into[0] - SPINE.barReach, ...xs)
        const r = Math.max(into[0] + SPINE.barReach, ...xs)
        bars.push({ id: `${BAR_PREFIX}merge:${target}`, x: l, y, width: r - l, stemX: into[0], stemTo: into[1] })
    }
    for (const [source, list] of forks) {
        const out = bottomOut(list[0] as Link)
        const row = Math.min(...list.map((link) => rowOfTarget(link.target)))
        const y = trackY(`f:${source}`, row)
        const xs = list.map((link) => entry(link.target)[0])
        for (const link of list) {
            const into = entry(link.target)
            routes.set(link.id, { points: tidy([out, [out[0], y], [into[0], y], into]), end: "arrow" })
        }
        const l = Math.min(out[0], ...xs)
        bars.push({ id: `${BAR_PREFIX}fork:${source}`, x: l, y, width: Math.max(out[0], ...xs) - l })
    }

    // 11. The words of a forward edge stand beside its first segment, never on a bend: right of a line that leaves downwards, above one that leaves sideways
    //     (after the drop of a sibling that shares the run). A first segment too short for them (a side step out to a free column) hands them to the next.
    for (const link of forwardLinks) {
        const route = routes.get(link.id)
        if (route === undefined || link.label === undefined || link.label === "") continue
        const words = measure(link.label)
        const fits = (p: Point, q: Point): boolean => (p[0] === q[0] ? Math.abs(q[1] - p[1]) >= words.height + 8 : Math.abs(q[0] - p[0]) >= words.width + 2 * SPINE.labelGap)
        const at = route.points.findIndex((point, index) => index > 0 && fits(route.points[index - 1] as Point, point))
        const a = route.points[Math.max(0, at - 1)]
        const b = route.points[Math.max(1, at)]
        if (a === undefined || b === undefined) continue
        if (a[0] === b[0]) {
            const top = Math.min(a[1], b[1]) + 4
            route.label = { l: a[0] + SPINE.labelGap, t: top, r: a[0] + SPINE.labelGap + words.width, b: top + words.height }
            continue
        }
        const siblings = forwardLinks
            .filter((other) => other !== link && other.source === link.source && !isMain(other))
            .map((other) => routes.get(other.id)?.points[1]?.[0] ?? Infinity)
            .filter((x) => x > a[0] && x < b[0])
        const start = Math.max(Math.min(a[0], b[0]), ...siblings) + SPINE.labelGap
        route.label = { l: start, t: a[1] - 4 - words.height, r: start + words.width, b: a[1] - 4 }
    }
    return { rects, routes, bars }
}

/**
 * Lays a flow out on its spine (see `SPINE`): the same result shape as `layoutFlow`, so the canvas draws either. A position is the top-left corner of a node
 * inside its container (inside the canvas for the others); every route is in the canvas frame and says how it ends; `bars` are the fork and merge bars.
 */
export const layoutSpine = (nodes: readonly SizedNode[], links: readonly LinkEnds[], settings: LayoutSettings = {}): FlowLayout => {
    const { islands: arrangement = "wrap", width: wrapAt = ISLANDS_WIDTH, measure = estimateLabel } = settings
    const tree = treeOf(nodes)
    const members = membersOf(tree)
    const sizes = new Map(nodes.map((node) => [node.id, node] as const))
    const placed = usableLinks(nodes, links)
        .filter((link) => !isAncestor(tree, link.source, link.target) && !isAncestor(tree, link.target, link.source))
        .map((link, index) => ({ ...link, id: link.id ?? `e${String(index)}` }))
    const absolute = new Map<string, Rect>()
    const routes: Record<string, Route> = {}
    const bars: Bar[] = []
    let cursorX = 0
    let cursorY = 0
    let rowHeight = 0
    for (const island of islandsOf(tree, placed)) {
        const ids = new Set(island.flatMap((id) => [id, ...(members.get(id) ?? []), ...[...members.keys()].filter((container) => isAncestor(tree, id, container))]))
        const own = placed.filter((link) => ids.has(link.source) && ids.has(link.target))
        const laid = layoutIsland(tree, members, island, own, sizes, measure)
        // The island's box: its nodes, frames, lines, words and bars; it is moved so that box starts at the cursor.
        const parts: Rect[] = [...laid.rects.values()]
        for (const route of laid.routes.values()) {
            for (const [x, y] of route.points) parts.push({ l: x, t: y, r: x, b: y })
            if (route.label !== undefined) parts.push(route.label)
        }
        for (const bar of laid.bars) parts.push({ l: bar.x, t: bar.y, r: bar.x + bar.width, b: bar.y })
        const l = Math.min(...parts.map((rect) => rect.l))
        const t = Math.min(...parts.map((rect) => rect.t))
        const w = Math.max(...parts.map((rect) => rect.r)) - l
        const h = Math.max(...parts.map((rect) => rect.b)) - t
        if (arrangement === "wrap" && cursorX > 0 && cursorX + w > wrapAt) {
            cursorX = 0
            cursorY += rowHeight + ISLAND_GAP
            rowHeight = 0
        }
        const dx = cursorX - l
        const dy = cursorY - t
        for (const [id, rect] of laid.rects) absolute.set(id, { l: rect.l + dx, t: rect.t + dy, r: rect.r + dx, b: rect.b + dy })
        for (const [id, route] of laid.routes)
            routes[id] = {
                points: route.points.map(([x, y]) => [x + dx, y + dy] as const),
                end: route.end,
                ...(route.label === undefined ? {} : { label: { x: route.label.l + dx, y: route.label.t + dy, width: route.label.r - route.label.l, height: route.label.b - route.label.t } }),
            }
        for (const bar of laid.bars) bars.push({ ...bar, x: bar.x + dx, y: bar.y + dy, ...(bar.stemX === undefined ? {} : { stemX: bar.stemX + dx }), ...(bar.stemTo === undefined ? {} : { stemTo: bar.stemTo + dy }) })
        rowHeight = Math.max(rowHeight, h)
        if (arrangement === "wrap") cursorX += w + ISLAND_GAP
        else cursorY += h + ISLAND_GAP
    }
    const positions: Record<string, GraphPosition> = {}
    const boxes: Record<string, Box> = {}
    for (const [id, rect] of absolute) {
        const parent = tree.parent.get(id)
        const frame = parent === undefined ? undefined : absolute.get(parent)
        positions[id] = { x: rect.l - (frame?.l ?? 0), y: rect.t - (frame?.t ?? 0) }
        boxes[id] = { width: rect.r - rect.l, height: rect.b - rect.t }
    }
    return { positions, boxes, routes, ports: {}, bars }
}
