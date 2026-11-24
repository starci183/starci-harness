/**
 * Every stretch of line is drawn once (owner: "Chốt", the routing law, rule 6). Two edges that share a stretch (a corridor into one target, a run out of one
 * source) would draw two strokes in it, a few pixels apart and, when dashed, out of phase: one reads as a doubled line. So the edge that ranks higher (the
 * stronger state: running over waiting over taken over plain over pending and skipped) keeps the shared stretch with its one arrowhead, and the other stops
 * (or starts) at the point where it meets that line, where a small junction dot is drawn. A middle run that would lie in another edge's corridor is moved
 * `PARALLEL_GAP` aside. Pure: the canvas runs it once the routes and the states are known.
 */

export type Pt = readonly [number, number]

/** Two runs closer than this across, overlapping along, are one corridor. */
export const OVERLAP_TOLERANCE = 6
/** How far apart two edges that must run side by side stand. */
export const PARALLEL_GAP = 12

export interface RankedRoute {
    readonly id: string
    readonly points: readonly Pt[]
    /** Higher keeps a shared stretch. */
    readonly rank: number
}

export interface DedupedRoute {
    readonly points: readonly Pt[]
    /** The route begins on another edge's line: a junction dot there, no dot of its own. */
    readonly joinStart: boolean
    /** The route ends on another edge's line: a junction dot there and no arrowhead (the other edge carries it). */
    readonly joinEnd: boolean
}

interface Segment {
    readonly a: Pt
    readonly b: Pt
}

const horizontal = (s: Segment): boolean => Math.abs(s.a[1] - s.b[1]) < 0.5
const vertical = (s: Segment): boolean => Math.abs(s.a[0] - s.b[0]) < 0.5

/** The stretch two collinear runs share, along their axis, when they lie within the tolerance across; undefined when they do not share one longer than it. */
const shared = (s: Segment, t: Segment): { readonly axis: 0 | 1; readonly from: number; readonly to: number; readonly across: number } | undefined => {
    for (const axis of [0, 1] as const) {
        const cross = axis === 0 ? 1 : 0
        const straight = axis === 0 ? horizontal : vertical
        if (!straight(s) || !straight(t)) continue
        if (Math.abs(s.a[cross] - t.a[cross]) > OVERLAP_TOLERANCE) continue
        const from = Math.max(Math.min(s.a[axis], s.b[axis]), Math.min(t.a[axis], t.b[axis]))
        const to = Math.min(Math.max(s.a[axis], s.b[axis]), Math.max(t.a[axis], t.b[axis]))
        if (to - from > OVERLAP_TOLERANCE) return { axis, from, to, across: t.a[cross] }
    }
    return undefined
}

const segmentsOf = (points: readonly Pt[]): Segment[] => points.slice(1).map((b, index) => ({ a: points[index] ?? b, b }))

/** Whether two drawn polylines share a stretch (collinear runs within the tolerance, overlapping by more than it): the check of the spec. */
export const overlaps = (p: readonly Pt[], q: readonly Pt[]): boolean => segmentsOf(p).some((s) => segmentsOf(q).some((t) => shared(s, t) !== undefined))

const at = (axis: 0 | 1, along: number, across: number): [number, number] => (axis === 0 ? [along, across] : [across, along])

/** Trims the end of `points` while its last run lies on a drawn run; returns whether it now ends on one. */
const trimEnd = (points: [number, number][], drawn: readonly Segment[]): boolean => {
    let joined = false
    for (let guard = 0; guard < 8 && points.length >= 2; guard += 1) {
        const end = points[points.length - 1]
        const before = points[points.length - 2]
        if (end === undefined || before === undefined) break
        const run: Segment = { a: before, b: end }
        const hit = drawn.map((segment) => shared(run, segment)).find((found) => found !== undefined && end[found.axis] >= found.from - OVERLAP_TOLERANCE && end[found.axis] <= found.to + OVERLAP_TOLERANCE)
        if (hit === undefined) break
        // The covered part reaches the end: cut the run back to where the drawn line begins, on that line.
        const cut = before[hit.axis] < end[hit.axis] ? hit.from : hit.to
        joined = true
        if (Math.abs(cut - before[hit.axis]) <= OVERLAP_TOLERANCE) {
            points.pop()
            const last = points[points.length - 1]
            if (last !== undefined) last[hit.axis === 0 ? 1 : 0] = hit.across
            continue
        }
        points[points.length - 1] = at(hit.axis, cut, hit.across)
        before[hit.axis === 0 ? 1 : 0] = hit.across
        break
    }
    return joined
}

/**
 * The routes with every shared stretch drawn once: the higher rank keeps it, the other ends (or starts) where it meets it; a middle run in a corridor moves
 * aside. With `join: false` no route is cut back to another's line (a drawing whose every edge is its own line, MermaidDiagram's): only the middle runs
 * move aside, and no route reports a junction.
 */
export const dedupeRuns = (routes: readonly RankedRoute[], { join = true }: { readonly join?: boolean } = {}): ReadonlyMap<string, DedupedRoute> => {
    const order = [...routes].sort((p, q) => q.rank - p.rank || q.points.length - p.points.length || p.id.localeCompare(q.id))
    const drawn: Segment[] = []
    const out = new Map<string, DedupedRoute>()
    for (const route of order) {
        const points = route.points.map((point) => [point[0], point[1]] as [number, number])
        const joinEnd = join && trimEnd(points, drawn)
        points.reverse()
        const joinStart = join && trimEnd(points, drawn)
        points.reverse()
        // A middle run in another edge's corridor moves aside, its neighbours following (they stay orthogonal).
        for (let pass = 0; pass < 3; pass += 1) {
            let moved = false
            for (let index = 1; index < points.length - 2; index += 1) {
                const a = points[index]
                const b = points[index + 1]
                if (a === undefined || b === undefined) continue
                const hit = drawn.map((segment) => shared({ a, b }, segment)).find((found) => found !== undefined)
                if (hit === undefined) continue
                const cross = hit.axis === 0 ? 1 : 0
                const side = a[cross] >= hit.across ? 1 : -1
                const value = hit.across + side * PARALLEL_GAP
                a[cross] = value
                b[cross] = value
                moved = true
            }
            if (!moved) break
        }
        out.set(route.id, { points, joinStart, joinEnd })
        if (points.length >= 2) drawn.push(...segmentsOf(points))
    }
    return out
}

/** The rank of an edge's style for a shared stretch: the stronger state keeps it. */
export const STYLE_RANK: Readonly<Record<string, number>> = { running: 7, wait: 6, danger: 5, taken: 4, plain: 3, fallback: 2, back: 2, pending: 1, placeholder: 1, skipped: 0 }
