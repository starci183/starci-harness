/** The length of the foot or the bars, and of the whole marker with its ring. */
export const MARK_REACH = 12
export const MARK_RING = 22
const SPREAD = 6
const RING_RADIUS = 4

export type Segment = readonly [x1: number, y1: number, x2: number, y2: number]

export interface Marker {
    readonly segments: readonly Segment[]
    /** The ring of a end that may be empty: its centre on the line and its radius. */
    readonly ring: { readonly x: number; readonly y: number; readonly r: number } | undefined
    /** How far the marker reaches from the box along the line. */
    readonly length: number
}

/**
 * The marker of one end of a relation, in a frame whose origin is the port on the box and whose x axis runs along the line away from the box:
 * a crow's foot for many (three prongs from one point on the line to the box), two bars across the line for one, and a ring beyond either when the end may be empty.
 */
export const endMarker = (many: boolean, optional: boolean): Marker => ({
    segments: many
        ? [[MARK_REACH, 0, 0, -SPREAD], [MARK_REACH, 0, 0, 0], [MARK_REACH, 0, 0, SPREAD]]
        : [[6, -SPREAD, 6, SPREAD], [MARK_REACH - 1, -SPREAD, MARK_REACH - 1, SPREAD]],
    ring: optional ? { x: MARK_REACH + 2 + RING_RADIUS, y: 0, r: RING_RADIUS } : undefined,
    length: optional ? MARK_RING : MARK_REACH,
})

/** The turn of a marker, in degrees, for a line that leaves its port along `(dx, dy)`. */
export const markerAngle = (dx: number, dy: number): number => (Math.atan2(dy, dx) * 180) / Math.PI

/** The unit direction from one point to the next, or undefined when they are the same point. */
export const unitFrom = (from: readonly [number, number], to: readonly [number, number]): readonly [number, number] | undefined => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    return length === 0 ? undefined : [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
}
