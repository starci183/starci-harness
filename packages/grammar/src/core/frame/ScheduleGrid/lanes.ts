import type { ScheduleColumn, ScheduleItem, ScheduleRow } from "./index.js"

/** The first and last column index an entry covers (equal for an entry in one cell); null when its column is not in the grid. */
export const rangeOf = (item: ScheduleItem, indexOf: ReadonlyMap<string, number>): readonly [number, number] | null => {
    const start = indexOf.get(item.column)
    if (start === undefined) return null
    const end = item.endColumn === undefined ? start : indexOf.get(item.endColumn)
    if (end === undefined) return [start, start]
    return start <= end ? [start, end] : [end, start]
}

/** An entry that crosses more than one column, with the columns it covers. */
export type SpanPlacement = { readonly item: ScheduleItem; readonly start: number; readonly end: number }

/**
 * The spans of one row, in lanes: a lane is a run of spans that do not overlap, so each lane is one table row of the grid.
 * Spans are placed in the order of their first column, each in the first lane it fits.
 */
export const spanLanes = (spans: readonly SpanPlacement[]): readonly (readonly SpanPlacement[])[] => {
    const lanes: SpanPlacement[][] = []
    const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
    for (const span of sorted) {
        const lane = lanes.find((entries) => (entries[entries.length - 1] as SpanPlacement).end < span.start)
        if (lane === undefined) lanes.push([span])
        else lane.push(span)
    }
    return lanes
}

/** The ids of the rows hidden because a group above them is collapsed. */
export const hiddenRowIds = (rows: readonly ScheduleRow[]): ReadonlySet<string> => {
    const byId = new Map(rows.map((row) => [row.id, row]))
    const hidden = new Set<string>()
    for (const row of rows) {
        const seen = new Set<string>()
        let parent = row.parent === undefined ? undefined : byId.get(row.parent)
        while (parent !== undefined && !seen.has(parent.id)) {
            if (parent.isCollapsed === true) { hidden.add(row.id); break }
            seen.add(parent.id)
            parent = parent.parent === undefined ? undefined : byId.get(parent.parent)
        }
    }
    return hidden
}

/** How many groups sit above a row (0 for a top-level row), for its indent. */
export const depthOf = (row: ScheduleRow, byId: ReadonlyMap<string, ScheduleRow>): number => {
    let depth = 0
    const seen = new Set<string>([row.id])
    let parent = row.parent === undefined ? undefined : byId.get(row.parent)
    while (parent !== undefined && !seen.has(parent.id)) {
        depth += 1
        seen.add(parent.id)
        parent = parent.parent === undefined ? undefined : byId.get(parent.parent)
    }
    return depth
}

export type ScheduleDependency = { readonly from: string; readonly to: string }

export const dependenciesOf = (items: readonly ScheduleItem[]): readonly ScheduleDependency[] => {
    const ids = new Set(items.map((item) => item.id))
    return items.flatMap((item) => (item.after ?? []).filter((id) => ids.has(id)).map((from) => ({ from, to: item.id })))
}

export const columnLabelOf = (column: ScheduleColumn): string => `${column.label}${column.description === undefined ? "" : ` ${column.description}`}`
