/**
 * The Grammar tokens an effect takes its colours from, so every app plays its own brand: the accent, its soft pair and the
 * warm warning hue (a celebration reads in the brand, never in the success green). A token the app leaves unset is skipped.
 */
export const THEME_TOKENS: readonly string[] = ["--accent", "--accent-soft", "--accent-soft-foreground", "--warning"]

/** Used only when the page sets none of THEME_TOKENS (a page outside any Grammar root). */
export const FALLBACK_COLORS: readonly string[] = ["#e11d48", "#fb7185", "#ffe3e3", "#f59e0b", "#fbbf24"]

/** The colours of the page's Grammar theme, in token order, falling back to FALLBACK_COLORS when none is set. */
export const themeColors = (read: (name: string) => string): readonly string[] => {
    const colors = THEME_TOKENS.map((name) => read(name).trim()).filter((value) => value !== "")
    return colors.length === 0 ? FALLBACK_COLORS : colors
}
