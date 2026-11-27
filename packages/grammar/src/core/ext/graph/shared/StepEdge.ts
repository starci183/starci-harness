"use client"

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, type Edge, type EdgeProps } from "@xyflow/react"
import { createElement as h, type ReactElement } from "react"
import { Badge, type BadgeTone } from "../../../index.js"
import type { StepEdgeData } from "../build.js"

const CORNER = 12
/** The Badge tone of an edge's words, by the way the run went. */
const PILL_TONE: Readonly<Record<string, BadgeTone>> = { taken: "success", running: "success", wait: "warning", danger: "danger", fallback: "warning", skipped: "muted", pending: "neutral", default: "neutral" }
/** The hollow circle at the source port (8px) and the open triangle at the target port (10px long, 10px across). */
const DOT = 4
const ARROW = 10
/**
 * The arrowhead is an open V (owner 2026-11-27: "M1 1 L11 6 L1 11", no fill, the line's colour and width, round corners), its point at the route's end on the
 * target's border; the stylesheet moves it back by half its stroke (`--starci-graph-edge-width`) so the drawn point touches the border. The line runs on
 * into the V and stops that far short of the border too.
 */
const ARROW_INSET = 0.75
/** The junction dot where an edge meets another edge's line. */
const JOIN = 3
/** How far a back edge runs below the line of its ends before it turns back, and how far it leaves its source first. */
const BACK_DROP = 56
const BACK_LEAVE = 16

type Point = readonly [number, number]

/** A path through the points with every corner rounded by `radius` (less when a run is short). */
export const roundedPath = (given: readonly Point[], radius: number): string => {
    // A repeated point has no direction: it is dropped.
    const points = given.filter((point, index) => index === 0 || point[0] !== given[index - 1]?.[0] || point[1] !== given[index - 1]?.[1])
    const first = points[0]
    const last = points[points.length - 1]
    if (first === undefined || last === undefined) return ""
    let path = `M${String(first[0])} ${String(first[1])}`
    for (let index = 1; index < points.length - 1; index += 1) {
        const before = points[index - 1]
        const corner = points[index]
        const after = points[index + 1]
        if (before === undefined || corner === undefined || after === undefined) continue
        const into = Math.hypot(corner[0] - before[0], corner[1] - before[1])
        const out = Math.hypot(after[0] - corner[0], after[1] - corner[1])
        const r = Math.min(radius, into / 2, out / 2)
        const from: Point = [corner[0] - ((corner[0] - before[0]) / into) * r, corner[1] - ((corner[1] - before[1]) / into) * r]
        const to: Point = [corner[0] + ((after[0] - corner[0]) / out) * r, corner[1] + ((after[1] - corner[1]) / out) * r]
        path += `L${String(from[0])} ${String(from[1])}Q${String(corner[0])} ${String(corner[1])} ${String(to[0])} ${String(to[1])}`
    }
    return `${path}L${String(last[0])} ${String(last[1])}`
}

/** The route of a back edge: out of its source, round the outside of both ends, into its target, and the middle of its far run for the pill. */
export const backRoute = (sx: number, sy: number, tx: number, ty: number, vertical: boolean): { readonly points: readonly Point[]; readonly middle: Point } => {
    if (vertical) {
        const far = Math.max(sx, tx) + 140
        return {
            points: [[sx, sy], [sx, sy + BACK_LEAVE], [far, sy + BACK_LEAVE], [far, ty - BACK_LEAVE], [tx, ty - BACK_LEAVE], [tx, ty]],
            middle: [far, (sy + ty) / 2],
        }
    }
    const low = Math.max(sy, ty) + BACK_DROP
    return {
        points: [[sx, sy], [sx + BACK_LEAVE, sy], [sx + BACK_LEAVE, low], [tx - BACK_LEAVE, low], [tx - BACK_LEAVE, ty], [tx, ty]],
        middle: [(sx + tx) / 2, low],
    }
}

/**
 * The one edge of the graphs: an orthogonal line with rounded corners (a `back` edge runs round the outside of both its ends), a dot where it leaves
 * its source, the arrowhead at its target and, when it has words, a pill on the line. It has no wider invisible hit area: an edge is not pressed.
 */
export const StepEdge = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<StepEdgeData>>): ReactElement => {
    const given = data?.route
    const back = data?.style === "back" ? backRoute(sourceX, sourceY, targetX, targetY, sourcePosition === Position.Bottom) : undefined
    // The route ends 10px short of its target, where the open triangle starts; a drawn-between-handles edge ends at its handle.
    const end = given === undefined ? ([targetX, targetY] as const) : (given.points[given.points.length - 1] ?? ([targetX, targetY] as const))
    const before = given === undefined ? undefined : [...given.points].reverse().find((point) => point[0] !== end[0] || point[1] !== end[1])
    const dir: readonly [number, number] =
        before === undefined
            ? targetPosition === Position.Left
                ? [1, 0]
                : targetPosition === Position.Right
                  ? [-1, 0]
                  : targetPosition === Position.Top
                    ? [0, 1]
                    : [0, -1]
            : [Math.sign(end[0] - before[0]), Math.sign(end[1] - before[1])]
    const start = given?.points[0] ?? [sourceX, sourceY]
    const joinEnd = given !== undefined && data?.joinEnd === true
    // An edge that ends on a merge bar draws nothing at its end: the bar carries the one arrow into the target.
    const bareEnd = given !== undefined && data?.bareEnd === true
    const shortened = given === undefined ? undefined : joinEnd || bareEnd ? given.points : [...given.points.slice(0, -1), [end[0] - dir[0] * ARROW_INSET, end[1] - dir[1] * ARROW_INSET] as const]
    const [path, labelX, labelY] =
        given !== undefined && shortened !== undefined
            ? [roundedPath(shortened, CORNER), 0, 0]
            : back === undefined
              ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: CORNER })
              : [roundedPath(back.points, CORNER), back.middle[0], back.middle[1]]
    const box = given?.label
    const pill = data?.pill
    const place = box === undefined ? { transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)` } : { transform: `translate(${String(box.x)}px, ${String(box.y)}px)`, inlineSize: box.width, blockSize: box.height }
    return h(
        "g",
        { "data-edge-source": source, "data-edge-target": target },
        h(BaseEdge, { path, interactionWidth: 0 }),
        h("circle", { className: "starci-graph-edge-dot", cx: start[0], cy: start[1], r: DOT }),
        // One arrowhead per target (the routing law, rule 6): an edge that ends on another edge's line draws a junction dot there instead.
        bareEnd
            ? null
            : joinEnd
            ? h("circle", { className: "starci-graph-edge-join", cx: end[0], cy: end[1], r: JOIN })
            : h("path", { className: "starci-graph-edge-arrow", d: `M${String(-ARROW)} ${String(-ARROW / 2)}L0 0L${String(-ARROW)} ${String(ARROW / 2)}`, transform: `translate(${String(end[0])} ${String(end[1])}) rotate(${String((Math.atan2(dir[1], dir[0]) * 180) / Math.PI)})` }),
        given !== undefined && data?.joinStart === true ? h("circle", { className: "starci-graph-edge-join", cx: start[0], cy: start[1], r: JOIN }) : null,
        pill === undefined
            ? null
            : h(
                  EdgeLabelRenderer,
                  null,
                  // The words of an edge are the core's Badge, in the tone of the way the run went, on the surface so no line runs through them.
                  h("span", { className: "starci-graph-edge-pill", "data-style": data?.style, "data-edge": id, "data-dimmed": data?.dimmed === true ? "true" : undefined, style: place }, h(Badge, { tone: data?.pillTone ?? PILL_TONE[data?.style ?? "default"] ?? "neutral" }, pill)),
              ),
    )
}
