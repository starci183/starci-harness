import type { IconSource } from "./index.js"
import {
    TablerAlertCircle,
    TablerAlertTriangle,
    TablerArrowRight,
    TablerBell,
    TablerChevronDown,
    TablerChevronLeft,
    TablerChevronRight,
    TablerCircleCheck,
    TablerDots,
    TablerExternalLink,
    TablerInbox,
    TablerInfoCircle,
    TablerLayoutSidebarRight,
    TablerMenu2,
    TablerMinus,
    TablerPaperclip,
    TablerPencil,
    TablerPin,
    TablerPlus,
    TablerSearch,
    TablerSend,
    TablerUpload,
    TablerX,
} from "./tabler.js"

/**
 * The closed glyph vocabulary Grammar draws itself, for the few marks every product needs and an app with no icon registry cannot
 * supply: `empty` (an empty tray: nothing here yet), `arrow-end` (go on: the mark that follows a label that leads somewhere), `chevron-end` (a pressable row opens something: the quiet mark at its end), `more` (an overflow menu), `send`, `panel-end` (show or hide the pane at the end of a layout), `pencil` (edit), `close`, `search` (the magnifier, for a search that opens on press) `bell` (something is waiting) `menu` (the three lines that open a navigation menu), `attach` (a paperclip: add a file to what is being written) and `pin` (a pushpin: keep an item at the top).
 * Every one is a Tabler outline glyph (`tabler.tsx`), the one icon set; any other glyph stays app-owned (`Icon` with a `source`, from `@tabler/icons-react`).
 */
export const GLYPH_NAMES = ["more", "send", "panel-end", "pencil", "close", "search", "arrow-end", "chevron-end", "empty", "plus", "upload", "external", "chevron-down", "chevron-start", "minus", "info", "success", "warning", "danger", "bell", "menu", "attach", "pin"] as const

export type GlyphName = (typeof GLYPH_NAMES)[number]

/** A box with an arrow out of its corner: the link leaves the app (Link `kind="external"` draws it after the label). */
export const ExternalGlyph: IconSource = TablerExternalLink

const SOURCES: Readonly<Record<GlyphName, IconSource>> = {
    more: TablerDots,
    send: TablerSend,
    "panel-end": TablerLayoutSidebarRight,
    pencil: TablerPencil,
    close: TablerX,
    search: TablerSearch,
    "arrow-end": TablerArrowRight,
    "chevron-end": TablerChevronRight,
    empty: TablerInbox,
    plus: TablerPlus,
    upload: TablerUpload,
    external: TablerExternalLink,
    "chevron-down": TablerChevronDown,
    "chevron-start": TablerChevronLeft,
    minus: TablerMinus,
    info: TablerInfoCircle,
    success: TablerCircleCheck,
    warning: TablerAlertTriangle,
    danger: TablerAlertCircle,
    bell: TablerBell,
    menu: TablerMenu2,
    attach: TablerPaperclip,
    pin: TablerPin,
}

/** The SVG source of a glyph of the vocabulary, for `Icon`. */
export const glyphSource = (name: GlyphName): IconSource => SOURCES[name]
