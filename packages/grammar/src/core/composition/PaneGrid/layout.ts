/**
 * Pure layout maths for PaneGrid: reads `grid-template-areas` rows and answers, for every named area, which of its
 * start edges touch another pane. The divider is drawn on exactly those edges, so n panes in a row have n-1 lines and
 * none is doubled.
 */

/**
 * A track size by role. `fill`, `fill-2` and `fill-3` share the free space in proportion 1, 2 and 3 (1fr, 2fr, 3fr);
 * `compact`, `standard` and `wide` are the grammar's Rail widths; `auto` is the content's size.
 */
export type PaneTrack = "auto" | "fill" | "fill-2" | "fill-3" | "compact" | "standard" | "wide"

const trackCss: Readonly<Record<PaneTrack, string>> = {
    auto: "auto",
    fill: "minmax(0, 1fr)",
    "fill-2": "minmax(0, 2fr)",
    "fill-3": "minmax(0, 3fr)",
    compact: "minmax(14rem, var(--starci-core-rail-compact, 16rem))",
    standard: "minmax(16rem, var(--starci-core-rail-standard, 20rem))",
    wide: "minmax(20rem, var(--starci-core-rail-wide, 24rem))",
}

export const trackToCss = (track: PaneTrack): string => trackCss[track]

const tracks: ReadonlySet<string> = new Set<PaneTrack>(["auto", "fill", "fill-2", "fill-3", "compact", "standard", "wide"])
export const isPaneTrack = (value: string): value is PaneTrack => tracks.has(value)

const emptyCell = "."

export type PaneEdges = {
    /** A pane sits to the inline-start of this one: the vertical divider is drawn on its start edge. */
    readonly inline: boolean
    /** A pane sits above this one: the horizontal divider is drawn on its block-start edge. */
    readonly block: boolean
}

export type PaneGridModel = {
    readonly areas: ReadonlyArray<string>
    readonly columns: ReadonlyArray<PaneTrack>
    readonly rows: ReadonlyArray<PaneTrack>
    readonly edges: Readonly<Record<string, PaneEdges>>
}

export const parseAreas = (areas: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
    areas.map((row) => row.trim().split(/\s+/).filter((cell) => cell !== ""))

const fillTracks = (given: ReadonlyArray<PaneTrack> | undefined, count: number): ReadonlyArray<PaneTrack> =>
    Array.from({ length: count }, (_, index) => given?.[index] ?? "fill")

/**
 * Build the model. `collapsed` names the areas that leave the grid (they became drawers): a column or row that holds
 * only collapsed areas disappears with its track, so the remaining panes close the gap.
 */
export const buildPaneGridModel = (
    areas: ReadonlyArray<string>,
    columns: ReadonlyArray<PaneTrack> | undefined,
    rows: ReadonlyArray<PaneTrack> | undefined,
    collapsed: ReadonlySet<string>,
): PaneGridModel => {
    const matrix = parseAreas(areas)
    const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0)
    const allColumns = fillTracks(columns, columnCount)
    const allRows = fillTracks(rows, matrix.length)
    const isGone = (cell: string | undefined) => cell === undefined || collapsed.has(cell)
    const keepColumn = Array.from({ length: columnCount }, (_, c) =>
        collapsed.size === 0 || !matrix.every((row) => isGone(row[c])))
    const keepRow = matrix.map((row) => collapsed.size === 0 || !row.every((cell) => isGone(cell)))
    const kept = matrix
        .filter((_, r) => keepRow[r])
        .map((row) => row.filter((_, c) => keepColumn[c]).map((cell) => (collapsed.has(cell) ? emptyCell : cell)))

    const box = new Map<string, { r0: number; c0: number; c1: number }>()
    kept.forEach((row, r) => row.forEach((cell, c) => {
        if (cell === emptyCell) return
        const known = box.get(cell)
        box.set(cell, known === undefined
            ? { r0: r, c0: c, c1: c }
            : { r0: Math.min(known.r0, r), c0: Math.min(known.c0, c), c1: Math.max(known.c1, c) })
    }))

    const edges: Record<string, PaneEdges> = {}
    box.forEach(({ r0, c0, c1 }, name) => {
        const left = kept[r0]?.[c0 - 1]
        const above = Array.from({ length: c1 - c0 + 1 }, (_, i) => kept[r0 - 1]?.[c0 + i])
        edges[name] = {
            inline: left !== undefined && left !== emptyCell,
            block: above.some((cell) => cell !== undefined && cell !== emptyCell),
        }
    })

    return {
        areas: kept.map((row) => row.join(" ")),
        columns: allColumns.filter((_, c) => keepColumn[c]),
        rows: allRows.filter((_, r) => keepRow[r]),
        edges,
    }
}

/** The grammar's pane breakpoints, mobile first: `base` below 48rem (the compact boundary), `medium` from 48rem, `wide` from 70rem. */
export const paneBreakpoints = ["base", "medium", "wide"] as const
export type PaneBreakpoint = typeof paneBreakpoints[number]

/** A value per breakpoint; a missing `medium` or `wide` inherits the next smaller one. */
export type PaneByBreakpoint<T> = {
    readonly base: T
    readonly medium?: T
    readonly wide?: T
}

/** One value for every breakpoint, or one per breakpoint. */
export type PaneResponsive<T> = T | PaneByBreakpoint<T>

const isByBreakpoint = <T>(value: PaneResponsive<T>): value is PaneByBreakpoint<T> =>
    typeof value === "object" && value !== null && !Array.isArray(value) && "base" in value

export const resolvePaneValue = <T>(value: PaneResponsive<T>, breakpoint: PaneBreakpoint): T => {
    if (!isByBreakpoint(value)) return value
    if (breakpoint === "base") return value.base
    if (breakpoint === "medium") return value.medium ?? value.base
    return value.wide ?? value.medium ?? value.base
}

/**
 * The grid model at every breakpoint. A single `areas` with collapsing panes arranges the full grid from `medium` up and,
 * at `base`, the same grid without the collapsed areas (their columns and rows leave with them).
 */
export const buildResponsivePaneGridModels = (
    areas: PaneResponsive<ReadonlyArray<string>>,
    columns: PaneResponsive<ReadonlyArray<PaneTrack>> | undefined,
    rows: PaneResponsive<ReadonlyArray<PaneTrack>> | undefined,
    collapsed: ReadonlySet<string>,
): Readonly<Record<PaneBreakpoint, PaneGridModel>> => {
    const none: ReadonlySet<string> = new Set()
    const dropsAtBase = !isByBreakpoint(areas)
    const model = (breakpoint: PaneBreakpoint) => buildPaneGridModel(
        resolvePaneValue(areas, breakpoint),
        columns === undefined ? undefined : resolvePaneValue(columns, breakpoint),
        rows === undefined ? undefined : resolvePaneValue(rows, breakpoint),
        dropsAtBase && breakpoint === "base" ? collapsed : none,
    )
    return { base: model("base"), medium: model("medium"), wide: model("wide") }
}
