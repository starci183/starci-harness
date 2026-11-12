import type { ReactNode } from "react"
import type { IconSource, IconSourceProps } from "./index.js"

/**
 * The closed glyph vocabulary Grammar draws itself, for the few marks every product needs and an app with no icon registry cannot
 * supply: `empty` (an empty tray: nothing here yet), `arrow-end` (go on: the mark that follows a label that leads somewhere), `chevron-end` (a pressable row opens something: the quiet mark at its end), `more` (an overflow menu), `send`, `panel-end` (show or hide the pane at the end of a layout), `pencil` (edit), `close`, `search` (the magnifier, for a search that opens on press) and `bell` (something is waiting).
 * Any other glyph stays app-owned (`Icon` with a `source`).
 */
export const GLYPH_NAMES = ["more", "send", "panel-end", "pencil", "close", "search", "arrow-end", "chevron-end", "empty", "plus", "upload", "external", "chevron-down", "chevron-start", "minus", "info", "success", "warning", "danger", "bell"] as const

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

const Search = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
        <path d="M16 16l4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
    </svg>
)

/** An arrow toward the reading end: the label leads somewhere. It points right; a right-to-left page mirrors it in CSS. */
const ArrowEnd = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
    </svg>
)

/** A chevron toward the reading end: the row it ends opens something. It points right; a right-to-left page mirrors it in CSS. */
const ChevronEnd = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
    </svg>
)

/** An empty tray: the default mark of a region with nothing in it yet. */
const Empty = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 13l2.5-7h11L20 13" />
        <path d="M4 13v5h16v-5h-5l-1 2h-4l-1-2z" />
    </svg>
)

/** A plus: the action creates or adds something (`startGlyph="plus"` on "New agent"). */
const Plus = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
    </svg>
)

/** A tray with an arrow up: the action uploads a file. */
const Upload = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 15V4" />
        <path d="M7.5 8.5L12 4l4.5 4.5" />
        <path d="M4 15v4h16v-4" />
    </svg>
)

/** A box with an arrow out of its corner: the link leaves the app (Link `kind="external"` draws it after the label). */
export const ExternalGlyph = (props: IconSourceProps) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 4h6v6" />
        <path d="M20 4l-9 9" />
        <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
    </svg>
)

const outline = (props: IconSourceProps, children: ReactNode) => (
    <svg {...props} fill="none" focusable="false" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

/** A chevron down: a select or a disclosure opens (the HeroUI default is a filled chevron; Grammar draws this outline one). */
const ChevronDown = (props: IconSourceProps) => outline(props, <path d="M6 9l6 6 6-6" />)

/** A chevron toward the reading start: a scroller goes back. It points left; a right-to-left page mirrors it in CSS. */
const ChevronStart = (props: IconSourceProps) => outline(props, <path d="M15 5l-7 7 7 7" />)

/** A minus: a number steps down. */
const Minus = (props: IconSourceProps) => outline(props, <path d="M5 12h14" />)

/** The status marks of an alert (outline circles and triangle): informative, affirmative, cautionary, negative. */
const InfoCircle = (props: IconSourceProps) => outline(props, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>)
const CheckCircle = (props: IconSourceProps) => outline(props, <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>)
const Warning = (props: IconSourceProps) => outline(props, <path d="M12 9v4M12 16.5h.01M10.3 4.2L2.9 17.1A2 2 0 004.6 20h14.8a2 2 0 001.7-2.9L13.7 4.2a2 2 0 00-3.4 0z" />)
/** A bell: something is waiting (notifications, the app bar custom button). */
const Bell = (props: IconSourceProps) => outline(props, <path d="M6 9a6 6 0 0112 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7zM10 19.5a2 2 0 004 0" />)
const DangerCircle = (props: IconSourceProps) => outline(props, <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>)

const SOURCES: Readonly<Record<GlyphName, IconSource>> = { more: More, send: Send, "panel-end": PanelEnd, pencil: Pencil, close: Close, search: Search, "arrow-end": ArrowEnd, "chevron-end": ChevronEnd, empty: Empty, plus: Plus, upload: Upload, external: ExternalGlyph, "chevron-down": ChevronDown, "chevron-start": ChevronStart, minus: Minus, info: InfoCircle, success: CheckCircle, warning: Warning, danger: DangerCircle, bell: Bell }

/** The SVG source of a glyph of the vocabulary, for `Icon`. */
export const glyphSource = (name: GlyphName): IconSource => SOURCES[name]
