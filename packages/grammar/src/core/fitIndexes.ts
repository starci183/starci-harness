const GAP_PX = 8

/**
 * The indexes that show in a row that folds the rest into a "+n" menu: the first and the selected one always, then the
 * rest in order while they fit with the overflow control after them. `widths` are the measured widths of every item,
 * `plusWidth` the overflow control's.
 */
export const visibleOptionIndexes = (widths: ReadonlyArray<number>, selected: number, available: number, plusWidth: number): ReadonlyArray<number> => {
    const all = widths.map((_, index) => index)
    const total = widths.reduce((sum, width) => sum + width, 0) + GAP_PX * Math.max(0, widths.length - 1)
    if (total <= available) return all
    const pinned = new Set<number>([0])
    if (selected >= 0) pinned.add(selected)
    const used = (set: ReadonlySet<number>) => [...set].reduce((sum, index) => sum + (widths[index] ?? 0), 0) + GAP_PX * Math.max(0, set.size - 1) + GAP_PX + plusWidth
    const shown = new Set(pinned)
    for (const index of all) {
        if (shown.has(index)) continue
        const next = new Set(shown).add(index)
        if (used(next) > available) break
        shown.add(index)
    }
    return all.filter((index) => shown.has(index))
}
