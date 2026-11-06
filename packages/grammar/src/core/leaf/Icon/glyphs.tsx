import type { IconSource, IconSourceProps } from "./index.js"

/**
 * The closed glyph vocabulary Grammar draws itself, for the few marks every product needs and an app with no icon registry cannot
 * supply: `more` (an overflow menu), `send`, `panel-end` (show or hide the pane at the end of a layout), `pencil` (edit) and `close`.
 * Any other glyph stays app-owned (`Icon` with a `source`).
 */
export const GLYPH_NAMES = ["more", "send", "panel-end", "pencil", "close"] as const

export type GlyphName = (typeof GLYPH_NAMES)[number]

const More = (props: IconSourceProps) => (
    <svg {...props} fill="currentColor" focusable="false" viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="1.75" />
        <circle cx="12" cy="12" r="1.75" />
        <circle cx="19" cy="12" r="1.75" />
    </svg>
)

const Send = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24">
        <path d="M6 12L3.27 3.13A59.77 59.77 0 0121.49 12 59.77 59.77 0 013.27 20.88L6 12zm0 0h7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
    </svg>
)

const PanelEnd = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
        <path d="M15 4.5v15" stroke="currentColor" strokeWidth="1.75" />
    </svg>
)

const Pencil = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24">
        <path d="M16.86 4.49l1.69-1.69a1.88 1.88 0 012.65 2.65L10.58 16.07a4.5 4.5 0 01-1.9 1.13L6 18l.8-2.69a4.5 4.5 0 011.13-1.9l8.93-8.92zm0 0L19.5 7.13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
    </svg>
)

const Close = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
)

const SOURCES: Readonly<Record<GlyphName, IconSource>> = { more: More, send: Send, "panel-end": PanelEnd, pencil: Pencil, close: Close }

/** The SVG source of a glyph of the vocabulary, for `Icon`. */
export const glyphSource = (name: GlyphName): IconSource => SOURCES[name]
