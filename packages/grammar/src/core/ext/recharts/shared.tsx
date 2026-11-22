"use client"

import type { CSSProperties, ReactNode } from "react"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { Text } from "../../leaf/Text/index.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import { CHART_TEXT_STYLE } from "./tokens.js"

/** One row of chart data: a record the chart reads two keys from. */
export type ChartRow = object

export type ChartFormatters = {
    /** How an x value (a label, a date) reads on a tick and in the tooltip. Defaults to the value as text. */
    readonly formatX?: (value: string | number) => string
    /** How a y number reads on a tick and in the tooltip. Defaults to the number as text. */
    readonly formatY?: (value: number) => string
}

/** The pieces every chart shares: the data, the two keys, the words and the states. */
export type ChartBaseProps<Row extends ChartRow> = ChartFormatters & {
    readonly data: readonly Row[]
    /** The key of each row read as the x value. */
    readonly xKey: keyof Row & string
    /** The key of each row read as the y number. */
    readonly yKey: keyof Row & string
    /** Names the chart for assistive technology, e.g. "Orders per week". Required: a chart is an image, not text. */
    readonly ariaLabel: string
    /** What shows in place of the chart when `data` is empty. Required: a chart answers for its empty state. */
    readonly emptyLabel: string
    /** The first read has no data yet: a Skeleton of the chart's box. Inside a loading region it follows the region. */
    readonly isLoading?: boolean
}

export const asText = (value: string | number): string => String(value)
export const asNumberText = (value: number): string => String(value)

/** The x value of a row as it reads on an axis. */
export const readX = <Row extends ChartRow>(row: Row, key: keyof Row & string): string | number => {
    const value: unknown = Reflect.get(row, key)
    return typeof value === "number" ? value : String(value ?? "")
}

/** The y number of a row (0 when the cell is not a finite number, so a gap never breaks the scale). */
export const readY = <Row extends ChartRow>(row: Row, key: keyof Row & string): number => {
    const value: unknown = Reflect.get(row, key)
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

type ChartFrameProps = {
    readonly component: string
    readonly ariaLabel: string
    readonly emptyLabel: string
    readonly isLoading: boolean | undefined
    readonly isEmpty: boolean
    readonly height: number
    /** A legend under the drawing (a chart of several series): real text outside the image, a Skeleton line while loading. */
    readonly legend?: ReactNode
    readonly children: ReactNode
}

const frameStyle = (height: number): CSSProperties => ({ inlineSize: "100%", minInlineSize: 0, blockSize: height })
const stackStyle: CSSProperties = { inlineSize: "100%", minInlineSize: 0, display: "flex", flexDirection: "column", gap: "var(--grammar-row-gap)" }

/**
 * The box a chart draws in. It keeps its height in every state (loading skeleton, empty line, drawing), so the page below does not
 * move; the drawing is one image named by `ariaLabel`, and a legend, when there is one, is text under it. Loading comes first, then empty.
 */
export const ChartFrame = ({ component, ariaLabel, emptyLabel, isLoading: ownLoading, isEmpty, height, legend, children }: ChartFrameProps) => {
    const isLoading = useIsLoading(ownLoading)
    const regionOwnsBusy = useRegionOwnsBusy()
    const hasLegend = legend !== undefined
    const marks = { "data-tier": "ext", "data-component": component, "data-grammar-chart": "true" } as const
    const common = { ...marks, style: frameStyle(height) } as const
    if (isLoading) {
        const box = <Skeleton shape="box" width="100%" height={`${height}px`} />
        return (
            <div {...marks} style={hasLegend ? stackStyle : frameStyle(height)} data-state="loading" {...(regionOwnsBusy ? {} : { "aria-busy": true })}>
                {box}
                {hasLegend ? <Skeleton shape="text" /> : null}
            </div>
        )
    }
    if (isEmpty) {
        return (
            <div {...common} data-state="empty" style={{ ...frameStyle(height), display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Text role="caption">{emptyLabel}</Text>
            </div>
        )
    }
    if (hasLegend) {
        return (
            <div {...marks} data-state="ready" style={stackStyle}>
                <div role="img" aria-label={ariaLabel} style={frameStyle(height)}>
                    {children}
                </div>
                {legend}
            </div>
        )
    }
    return (
        <div {...common} data-state="ready" role="img" aria-label={ariaLabel}>
            {children}
        </div>
    )
}

type TooltipPayload = { readonly value?: unknown }

export type ChartTooltipProps = {
    readonly active?: boolean
    readonly label?: unknown
    readonly payload?: readonly TooltipPayload[]
    readonly formatX: (value: string | number) => string
    readonly formatY: (value: number) => string
    /** The series name shown beside its value, from props. */
    readonly seriesLabel: string
    /** With several series (an `AreaChart` with `series`), the name of each payload row in order; the first falls back to `seriesLabel`. */
    readonly seriesLabels?: readonly string[]
}

/** The tooltip's box: a Grammar surface (surface fill, separator hairline, control radius) with no shadow, its words in the caption role. */
export const CHART_TOOLTIP_STYLE: CSSProperties = {
    background: "var(--surface)",
    color: "var(--foreground)",
    border: "var(--grammar-hairline) solid var(--separator)",
    borderRadius: "var(--grammar-radius-md)",
    padding: "var(--grammar-inline-gap) var(--grammar-inset)",
    boxShadow: "none",
    ...CHART_TEXT_STYLE,
}

const STRONG_STYLE = { fontWeight: "var(--grammar-weight-semibold)" } as const

/** The tooltip: the x value muted, then one line per series, `name: value`. */
export const ChartTooltip = ({ active, label, payload, formatX, formatY, seriesLabel, seriesLabels }: ChartTooltipProps) => {
    if (active !== true || payload === undefined || payload.length === 0) return null
    const x = typeof label === "number" || typeof label === "string" ? formatX(label) : ""
    return (
        <div data-component="ChartTooltip" style={CHART_TOOLTIP_STYLE}>
            <div style={{ color: "var(--muted)" }}>{x}</div>
            {payload.map((entry, index) => {
                const raw = entry.value
                const y = typeof raw === "number" ? formatY(raw) : String(raw ?? "")
                const name = seriesLabels?.[index] ?? (index === 0 ? seriesLabel : "")
                return (
                    <div key={`${index}-${name}`}>
                        {name}: <strong style={STRONG_STYLE}>{y}</strong>
                    </div>
                )
            })}
        </div>
    )
}

/** One row of a chart legend: the mark's colour, its name and, for a part of a whole, its value and share. */
export type ChartLegendItem = {
    readonly label: string
    readonly color: string
    readonly value?: string
    readonly share?: string
}

const SWATCH_STYLE: CSSProperties = {
    flex: "none",
    inlineSize: "var(--grammar-inline-gap)",
    blockSize: "var(--grammar-inline-gap)",
    borderRadius: "var(--grammar-radius-round)",
}

/**
 * The legend: real text outside the chart's image, so a screen reader reads every name (and value and share) the image draws. Names are
 * `body`, values `body` strong and tabular, shares `caption`; the swatch carries the colour, the words never do.
 */
export const ChartLegend = ({ items, layout }: { readonly items: readonly ChartLegendItem[]; readonly layout: "row" | "column" }) => (
    <ul
        data-component="ChartLegend"
        style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: layout,
            flexWrap: layout === "row" ? "wrap" : "nowrap",
            gap: layout === "row" ? "var(--grammar-inline-gap) var(--grammar-row-gap)" : "var(--grammar-inline-gap)",
            minInlineSize: 0,
        }}
    >
        {items.map((item, index) => (
            <li key={`${index}-${item.label}`} style={{ display: "flex", alignItems: "center", gap: "var(--grammar-inline-gap)", minInlineSize: 0 }}>
                <span aria-hidden="true" style={{ ...SWATCH_STYLE, background: item.color }} />
                <div style={{ flex: "1 1 auto", minInlineSize: 0 }}>
                    <Text overflow="wrap">{item.label}</Text>
                </div>
                {item.value === undefined ? null : (
                    <Text isStrong tabular>
                        {item.value}
                    </Text>
                )}
                {item.share === undefined ? null : (
                    <Text role="caption" tabular>
                        {item.share}
                    </Text>
                )}
            </li>
        ))}
    </ul>
)
