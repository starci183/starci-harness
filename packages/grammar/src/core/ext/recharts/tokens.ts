/**
 * The look of a chart, read from Grammar tokens only: a series is a tone token, grid and axes are the separator and muted text,
 * tick text is the `caption` role. A literal colour or length never appears here (lint `no-literal-look`).
 */

/** The tones a series may take: Grammar's built-in tones. */
export const CHART_TONES = ["default", "accent", "info", "success", "warning", "danger"] as const
export type ChartTone = (typeof CHART_TONES)[number]

/** The token a tone paints a series with. `default` is the muted text colour: the quiet series. */
export const CHART_TONE_TOKEN: Readonly<Record<ChartTone, string>> = {
    default: "var(--muted)",
    accent: "var(--accent)",
    info: "var(--info)",
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
}

/** The CSS colour of a tone (a `var()` of its token). An unknown tone from an untyped caller falls back to the accent. */
export const chartToneColor = (tone: ChartTone): string => CHART_TONE_TOKEN[tone] ?? CHART_TONE_TOKEN.accent

/** A tone's soft pair for a mark set back (the bars before the latest of a `highlightLast` BarChart): the tone mixed into the surface. */
export const chartToneSoftColor = (tone: ChartTone): string => `color-mix(in oklab, ${chartToneColor(tone)} 32%, var(--surface))`

/**
 * The fixed order a chart hands tones to series or segments that name none: the categorical order, never cycled. `default` (muted) is
 * held back for the folded "Other" segment, so a chart has at most five coloured series plus Other. `info` comes last: in the
 * default theme it sits close to `accent`, so the two are never neighbours below five series.
 */
export const CHART_CATEGORY_TONES: readonly ChartTone[] = ["accent", "success", "warning", "danger", "info"]

/** The tone of the n-th series or segment that names none (0-based): the categorical order, then the muted tone past its end. */
export const chartCategoryTone = (index: number): ChartTone => CHART_CATEGORY_TONES[index] ?? "default"

/**
 * The quiet colour mode: the series the reader should follow is the ink (the foreground at a soft step) and everything else the muted step, so a chart adds no accent of its own and a screen
 * keeps to the 10% accent budget. Both are mixes of the foreground into the surface, so they hold in every theme.
 */
export const CHART_QUIET_INK = "color-mix(in oklab, var(--foreground) 72%, var(--surface))"
export const CHART_QUIET_MUTED = "color-mix(in oklab, var(--foreground) 22%, var(--surface))"

/** An area's soft fill: its series token at the faded opacity at the top, thinning to none (or to the dimmed opacity when stacked). */
export const CHART_AREA_FILL_TOP = "var(--grammar-opacity-faded)"
export const CHART_AREA_FILL_STACKED_BOTTOM = "var(--grammar-opacity-dimmed)"

/** The gap between two filled marks (donut segments): the surface colour as a 2px stroke. */
export const CHART_MARK_GAP_STROKE = "var(--surface)"

export const CHART_GRID_STROKE = "var(--separator)"
export const CHART_AXIS_STROKE = "var(--separator)"
export const CHART_TEXT_FILL = "var(--muted)"
export const CHART_TEXT_STYLE = {
    fontSize: "var(--grammar-type-caption-size)",
    fontWeight: "var(--grammar-type-caption-weight)",
    lineHeight: "var(--grammar-type-caption-line)",
} as const
