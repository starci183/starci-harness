"use client"

import type { CSSProperties } from "react"
import { Pie, PieChart, Tooltip } from "recharts"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { Text } from "../../leaf/Text/index.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import { CHART_TOOLTIP_STYLE, ChartLegend, asNumberText } from "./shared.js"
import { CHART_MARK_GAP_STROKE, chartCategoryTone, chartToneColor, type ChartTone } from "./tokens.js"
import type { NoChildren } from "../../tier.js"

/** One part of the whole: its name, its amount and, optionally, its tone (else the next of the categorical order). */
export type DonutSegment = {
    readonly label: string
    readonly value: number
    readonly tone?: ChartTone
}

export type DonutChartProps = NoChildren & {
    /** The parts of the whole, in the app's order. A part that is not a positive number is left out. */
    readonly data: readonly DonutSegment[]
    /** Names the ring for assistive technology, e.g. "Lessons by topic". Required: the ring is an image; the legend beside it is text. */
    readonly ariaLabel: string
    /** What shows in place of the chart when no part has a positive value. Required. */
    readonly emptyLabel: string
    /** The first read has no data yet: a Skeleton of the ring and of the legend. Inside a loading region it follows the region. */
    readonly isLoading?: boolean
    /** The figure in the ring's hole (the `figure` role), e.g. a total or "68%". None when omitted. */
    readonly centerFigure?: string
    /** The words under the centre figure (the `caption` role), e.g. "lessons done". None when omitted. */
    readonly centerCaption?: string
    /** The name of the part the smaller parts fold into past `maxSegments`, from the app's copy (e.g. "Khác"). Default "Other". */
    readonly otherLabel?: string
    /** How many parts the ring draws at most, Other included: 2 to 6 (five tones plus Other). Default 6. */
    readonly maxSegments?: number
    /** How a value reads in the legend and the tooltip. Defaults to the number as text. */
    readonly formatValue?: (value: number) => string
    /** How a share reads, given whole percent (the shares add up to 100). Defaults to "42%". */
    readonly formatShare?: (percent: number) => string
    /** The ring's diameter in px, a chart size: 64 (sm), 120 (md) or 160 (lg, default). The ring is always `DONUT_RING_WIDTH` thick. */
    readonly size?: number
}

/** The most parts a ring draws: the five categorical tones, then Other in the muted tone. */
export const DONUT_MAX_SEGMENTS = 6
export const DEFAULT_DONUT_SIZE = 160
export const DEFAULT_OTHER_LABEL = "Other"
/**
 * The ring's thickness in px: HeroUI ProgressBar's md track (h-2, `--grammar-bar-md`; ramps.css "BARS"), so a ring and a bar of one
 * screen are one weight. Recharts takes the radius as a number, so the step is written here, at the vendor's 0.25rem spacing.
 */
export const DONUT_RING_WIDTH = 8
/** The empty track, the measures' one neutral (ramps.css "BARS", `--grammar-bar-track`). */
const TRACK_COLOR = "var(--grammar-bar-track)"

/** One drawn part: the folded segments with their colour and their whole-percent share. */
export type DonutSlice = {
    readonly label: string
    readonly value: number
    readonly tone: ChartTone
    readonly percent: number
    readonly isOther: boolean
}

const asShare = (percent: number): string => `${percent}%`

/** Whole percents that add up to 100 (largest remainder), so a legend never reads 99% or 101%. */
const wholePercents = (values: readonly number[]): number[] => {
    const total = values.reduce((sum, value) => sum + value, 0)
    if (total <= 0) return values.map(() => 0)
    const exact = values.map((value) => (value / total) * 100)
    const floors = exact.map(Math.floor)
    let left = 100 - floors.reduce((sum, value) => sum + value, 0)
    const byRemainder = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    for (const { index } of byRemainder) {
        if (left <= 0) break
        floors[index] = (floors[index] ?? 0) + 1
        left -= 1
    }
    return floors
}

/**
 * The parts a ring draws: the positive segments, and past `maxSegments` the largest `maxSegments - 1` kept in the app's order with the
 * rest folded into one Other part (muted, last). A segment without a tone takes the categorical order by its drawn place.
 */
export const donutSlices = (data: readonly DonutSegment[], maxSegments: number = DONUT_MAX_SEGMENTS, otherLabel: string = DEFAULT_OTHER_LABEL): DonutSlice[] => {
    const cap = Math.min(DONUT_MAX_SEGMENTS, Math.max(2, Math.floor(maxSegments)))
    const parts = data.filter((segment) => Number.isFinite(segment.value) && segment.value > 0)
    let kept: readonly DonutSegment[] = parts
    let other = 0
    if (parts.length > cap) {
        const largest = new Set(
            parts
                .map((segment, index) => ({ segment, index }))
                .sort((a, b) => b.segment.value - a.segment.value || a.index - b.index)
                .slice(0, cap - 1)
                .map(({ index }) => index),
        )
        kept = parts.filter((_, index) => largest.has(index))
        other = parts.filter((_, index) => !largest.has(index)).reduce((sum, segment) => sum + segment.value, 0)
    }
    const drawn = [
        ...kept.map((segment, index) => ({ label: segment.label, value: segment.value, tone: segment.tone ?? chartCategoryTone(index), isOther: false })),
        ...(other > 0 ? [{ label: otherLabel, value: other, tone: "default" as ChartTone, isOther: true }] : []),
    ]
    const percents = wholePercents(drawn.map(({ value }) => value))
    return drawn.map((slice, index) => ({ ...slice, percent: percents[index] ?? 0 }))
}

type DonutTooltipProps = {
    readonly active?: boolean
    readonly payload?: readonly { readonly name?: unknown; readonly value?: unknown; readonly payload?: { readonly share?: string } }[]
    readonly formatValue: (value: number) => string
}

/** The ring's tooltip: the same shadowless surface as the other charts, `name: value (share)`. */
export const DonutTooltip = ({ active, payload, formatValue }: DonutTooltipProps) => {
    const first = payload?.[0]
    if (active !== true || first === undefined) return null
    const value = typeof first.value === "number" ? formatValue(first.value) : String(first.value ?? "")
    const share = first.payload?.share
    return (
        <div data-component="ChartTooltip" style={CHART_TOOLTIP_STYLE}>
            {String(first.name ?? "")}: <strong style={{ fontWeight: "var(--grammar-weight-semibold)" }}>{value}</strong>
            {share === undefined ? null : <span style={{ color: "var(--muted)" }}> ({share})</span>}
        </div>
    )
}

const rowStyle: CSSProperties = { inlineSize: "100%", minInlineSize: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--grammar-card-gap)" }
const ringStyle = (size: number): CSSProperties => ({ position: "relative", flex: "none", inlineSize: size, blockSize: size })
const legendStyle = (size: number): CSSProperties => ({ flex: "1 1 0", flexBasis: size, minInlineSize: 0, maxInlineSize: size * 2 })
/** The bare ring in the track colour: drawn under the parts, and alone in the empty state. */
const trackRingStyle = (size: number): CSSProperties => ({
    position: "absolute",
    inset: 0,
    boxSizing: "border-box",
    inlineSize: size,
    blockSize: size,
    border: `${DONUT_RING_WIDTH}px solid ${TRACK_COLOR}`,
    borderRadius: "50%",
    pointerEvents: "none",
})
const centreStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    pointerEvents: "none",
}

/**
 * EXT (`@starci/grammar/core/ext/recharts`) - `DonutChart`: the parts of one whole (topics, progress) as a ring, with an optional centre
 * figure and caption and a legend of each part's value and share. The ring is one image named by `ariaLabel`; the centre and the legend
 * are text beside it. The ring is HeroUI ProgressBar's md track thick (`DONUT_RING_WIDTH`, 8px) over a ring of the empty track colour,
 * which alone is the empty state, `emptyLabel` beside it. At most six parts: the rest fold into Other (`otherLabel`). The legend wraps under the ring on a narrow box.
 */
export const DonutChart = ({
    data,
    ariaLabel,
    emptyLabel,
    isLoading: ownLoading,
    centerFigure,
    centerCaption,
    otherLabel = DEFAULT_OTHER_LABEL,
    maxSegments = DONUT_MAX_SEGMENTS,
    formatValue = asNumberText,
    formatShare = asShare,
    size = DEFAULT_DONUT_SIZE,
}: DonutChartProps) => {
    const isLoading = useIsLoading(ownLoading)
    const regionOwnsBusy = useRegionOwnsBusy()
    const marks = { "data-tier": "ext", "data-component": "DonutChart", "data-grammar-chart": "true" } as const
    if (isLoading) {
        const rows = Math.min(Math.max(data.length, 3), DONUT_MAX_SEGMENTS)
        return (
            <div {...marks} data-state="loading" style={rowStyle} {...(regionOwnsBusy ? {} : { "aria-busy": true })}>
                <div style={ringStyle(size)}>
                    <Skeleton shape="box" width={`${size}px`} height={`${size}px`} radius="full" />
                </div>
                <div style={legendStyle(size)}>
                    <Skeleton shape="text" lines={rows} />
                </div>
            </div>
        )
    }
    const slices = donutSlices(data, maxSegments, otherLabel)
    if (slices.length === 0) {
        return (
            <div {...marks} data-state="empty" style={rowStyle}>
                <div style={ringStyle(size)} aria-hidden="true">
                    <div data-slot="track" style={trackRingStyle(size)} />
                </div>
                <div style={legendStyle(size)}>
                    <Text role="caption">{emptyLabel}</Text>
                </div>
            </div>
        )
    }
    const drawn = slices.map((slice) => ({ ...slice, fill: chartToneColor(slice.tone), share: formatShare(slice.percent) }))
    return (
        <div {...marks} data-state="ready" style={rowStyle}>
            <div style={ringStyle(size)}>
                <div data-slot="track" style={trackRingStyle(size)} />
                <div role="img" aria-label={ariaLabel} style={{ position: "relative", inlineSize: size, blockSize: size }}>
                    <PieChart width={size} height={size} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <Pie
                            data={drawn}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={Math.max(0, size / 2 - DONUT_RING_WIDTH)}
                            outerRadius={size / 2}
                            startAngle={90}
                            endAngle={-270}
                            stroke={CHART_MARK_GAP_STROKE}
                            strokeWidth={2}
                            isAnimationActive={false}
                        />
                        <Tooltip content={<DonutTooltip formatValue={formatValue} />} />
                    </PieChart>
                </div>
                {centerFigure === undefined && centerCaption === undefined ? null : (
                    <div data-slot="center" style={centreStyle}>
                        {centerFigure === undefined ? null : (
                            <Text role="figure" tabular>
                                {centerFigure}
                            </Text>
                        )}
                        {centerCaption === undefined ? null : <Text role="caption">{centerCaption}</Text>}
                    </div>
                )}
            </div>
            <div style={legendStyle(size)}>
                <ChartLegend layout="column" items={drawn.map((slice) => ({ label: slice.label, color: slice.fill, value: formatValue(slice.value), share: slice.share }))} />
            </div>
        </div>
    )
}
