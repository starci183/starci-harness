/**
 * The Grammar tokens an effect takes its colours from, so every app plays its own brand: the accent, its soft pair, and the
 * status hues. A token the app leaves unset is skipped.
 */
export const THEME_TOKENS: readonly string[] = ["--accent", "--accent-soft", "--success", "--warning", "--accent-soft-foreground"]

/** Used only when the page sets none of THEME_TOKENS (a page outside any Grammar root). */
export const FALLBACK_COLORS: readonly string[] = ["#e11d48", "#fb7185", "#f59e0b", "#22c55e", "#3b82f6"]

/** The colours of the page's Grammar theme, in token order, falling back to FALLBACK_COLORS when none is set. */
export const themeColors = (read: (name: string) => string): readonly string[] => {
    const colors = THEME_TOKENS.map((name) => read(name).trim()).filter((value) => value !== "")
    return colors.length === 0 ? FALLBACK_COLORS : colors
}
