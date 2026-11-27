"use client"

import { createElement as h, type ReactElement } from "react"
import { STEP_CARD_DASH, STEP_CARD_EDGE, type StepCardRowTone } from "../StepCard.js"
import { roundedPath } from "./StepEdge.js"

/**
 * THE WIRE of a workflow step graph (owner, "Bổ sung 3: đường nối" and the approved canvas, 2026-11-27). One look for every app, drawn once here:
 *
 * - **Ends.** A wire leaves and enters a card only at the middle of one of its four sides (a control step's row: the middle of that row on the right edge).
 *   It starts with a hollow dot (`WIRE.dot` radius, on the surface, ringed in the wire's colour) whose centre is ON the source's border, and ends with an
 *   open V (`WIRE.arrow` long, stroke only, the wire's colour and width) whose point touches the target's border: never inside it, never short of it.
 * - **No words.** A wire carries no label: a branch's meaning is its control step's row and the wire's colour.
 * - **Colour.** `tone` is the row's (`STEP_CARD_EDGE`): main green, warning amber, else grey dashes, a loop's return red dashes; a plain wire is the line
 *   colour, a run's taken wire success green.
 */
export const WIRE = { dot: 4, arrow: 10, corner: 10, width: 1.5 } as const

type Point = { readonly x: number; readonly y: number }

export interface StepWireProps {
    /** The route from the source's border to the target's border, in the canvas frame (orthogonal: each run across or down). */
    readonly points: readonly Point[]
    /** The row's tone of a wire out of a control step's row; left out, a plain wire. */
    readonly tone?: StepCardRowTone
    /** A wire the run went along (green), or one it did not reach (faded). Left out, the plain line. */
    readonly run?: "taken" | "untaken"
    /** An extra class on the wire's group (the app's own hooks). */
    readonly className?: string
}

/**
 * One wire, as SVG inside an xyflow edge (or any SVG): the rounded orthogonal line, the hollow start dot centred on the source's border and the open V
 * whose point touches the target's border. The line stops where the V's stroke starts, so the two never overlap into a blob.
 */
export const StepWire = ({ points, tone, run, className }: StepWireProps): ReactElement | null => {
    const first = points[0]
    const end = points[points.length - 1]
    const before = [...points].reverse().find((point) => end !== undefined && (point.x !== end.x || point.y !== end.y))
    if (first === undefined || end === undefined || before === undefined) return null
    const dir = { x: Math.sign(end.x - before.x), y: Math.sign(end.y - before.y) }
    // The V's point sits half its stroke short of the border, so the drawn point (a round join) touches it; the line ends there too.
    const inset = WIRE.width / 2
    const tip = { x: end.x - dir.x * inset, y: end.y - dir.y * inset }
    const line = [...points.slice(0, -1), tip].map((point) => [point.x, point.y] as const)
    const look = tone === undefined ? undefined : STEP_CARD_EDGE[tone]
    const style = look === undefined ? undefined : { stroke: look.stroke, ...(look.dashed ? { strokeDasharray: STEP_CARD_DASH } : {}) }
    const ends = look === undefined ? undefined : { stroke: look.stroke }
    const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
    return h(
        "g",
        { className: className === undefined ? "starci-graph-wire" : `starci-graph-wire ${className}`, "data-tone": tone, "data-run": run },
        h("path", { className: "starci-graph-wire-line", d: roundedPath(line, WIRE.corner), ...(style === undefined ? {} : { style }) }),
        h("circle", { className: "starci-graph-wire-dot", cx: first.x, cy: first.y, r: WIRE.dot, ...(ends === undefined ? {} : { style: ends }) }),
        h(
            "g",
            { transform: `translate(${String(tip.x)} ${String(tip.y)}) rotate(${String(angle)})` },
            h("path", { className: "starci-graph-wire-arrow", d: `M${String(-WIRE.arrow)} ${String(-WIRE.arrow / 2)}L0 0L${String(-WIRE.arrow)} ${String(WIRE.arrow / 2)}`, ...(ends === undefined ? {} : { style: ends }) }),
        ),
    )
}

/** One entry of the wire legend: a row tone and the app's words for it ("đủ", "thiếu", "quá hạn"). */
export interface WireLegendItem {
    readonly tone: StepCardRowTone
    readonly label: string
}

export interface WireLegendProps {
    readonly items: readonly WireLegendItem[]
    /** The legend's name for assistive technology ("Màu đường nối"). */
    readonly label: string
}

/**
 * The small legend of the wire colours, at the bottom right inside the graph's frame (the approved canvas): a 16px stroke in each tone's look (solid or
 * dashed) and its words. A graph shows it only when it has a control step, whose rows are what the colours mean.
 */
export const WireLegend = ({ items, label }: WireLegendProps): ReactElement | null =>
    items.length === 0
        ? null
        : h(
              "ul",
              { className: "starci-graph-wire-legend starci-type-caption", "aria-label": label },
              items.map((item) =>
                  h(
                      "li",
                      { key: `${item.tone}:${item.label}`, className: "starci-graph-wire-legend-item", "data-tone": item.tone },
                      h("span", { className: "starci-graph-wire-legend-swatch", "data-dashed": STEP_CARD_EDGE[item.tone].dashed ? "true" : undefined, "aria-hidden": true }),
                      item.label,
                  ),
              ),
          )
