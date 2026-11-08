"use client"

import { Skeleton } from "../../leaf/Skeleton/index.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

export type SparklineProps = NoChildren & {
    /** Names the line for assistive technology, e.g. "Revenue, last 12 weeks". Required: the line is an image, not text. */
    readonly label: string
    /** The measured amounts, oldest first, drawn left to right on one scale from their lowest to their highest. Fewer than two draw a flat baseline. */
    readonly values: readonly number[]
    /** The first read has no data yet: the box draws as shimmering geometry of the same size. */
    readonly isLoading?: boolean
}

/** The canvas the line is drawn in; the box on the page is the ramp `--grammar-sparkline-width` x `--grammar-sparkline-height` (96 x 32). */
const CANVAS_WIDTH = 96
const CANVAS_HEIGHT = 32
/** Room kept around the line so its stroke is never clipped at the box edge. */
const CANVAS_INSET = 2

const round = (value: number) => Math.round(value * 100) / 100

/** The points of the line in canvas units: x by position, y by the value's place between the lowest and the highest. */
const pointsOf = (values: readonly number[]): ReadonlyArray<readonly [number, number]> => {
    const finite = values.filter(Number.isFinite)
    if (finite.length < 2) return [[CANVAS_INSET, CANVAS_HEIGHT / 2], [CANVAS_WIDTH - CANVAS_INSET, CANVAS_HEIGHT / 2]]
    const low = Math.min(...finite)
    const span = Math.max(...finite) - low
    const usable = CANVAS_HEIGHT - 2 * CANVAS_INSET
    const usableWidth = CANVAS_WIDTH - 2 * CANVAS_INSET
    return finite.map((value, index) => [
        round(CANVAS_INSET + (index / (finite.length - 1)) * usableWidth),
        round(span === 0 ? CANVAS_HEIGHT / 2 : CANVAS_INSET + (1 - (value - low) / span) * usable),
    ] as const)
}

/**
 * A tiny inline line chart: one accent line on one scale, no axis, grid or value, with a soft fill under it. It is an image
 * with a name (`label`), never a list; the figures it draws are the page's to say in text. It stands inline in a row, a
 * `figures` cell (`Figure.trendLine`) or beside a heading.
 */
export const Sparkline = ({ label, values, isLoading: ownLoading }: SparklineProps) => {
    const isLoading = useIsLoading(ownLoading)
    const ownsBusy = useRegionOwnsBusy()
    if (isLoading) {
        return (
            <span
                data-tier="composite"
                data-component="Sparkline"
                data-contract="STATE-8"
                className="starci-core-sparkline"
                data-loading="true"
                {...(ownsBusy ? {} : { "aria-busy": true })}
            >
                <Skeleton shape="rect" />
            </span>
        )
    }
    const points = pointsOf(values)
    const flat = values.filter(Number.isFinite).length < 2
    const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ")
    const first = points[0]
    const last = points[points.length - 1]
    const area = first === undefined || last === undefined ? "" : `${line} L${last[0]} ${CANVAS_HEIGHT} L${first[0]} ${CANVAS_HEIGHT} Z`
    return (
        <span data-tier="composite" data-component="Sparkline" data-contract="A11Y-2" className="starci-core-sparkline" role="img" aria-label={label} {...(flat ? { "data-grammar-sparkline-flat": "true" } : {})}>
            <svg className="starci-core-sparkline-svg" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} preserveAspectRatio="none" focusable="false" aria-hidden="true">
                {flat ? null : <path className="starci-core-sparkline-area" d={area} />}
                <path className="starci-core-sparkline-line" d={line} />
            </svg>
        </span>
    )
}
