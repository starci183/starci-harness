import type { IconSource } from "../../leaf/Icon/index.js"

/** One result: a place to go or a command to run. */
export type CommandPaletteItem = {
    readonly id: string
    readonly label: string
    /** The one supporting line under the label (what kind of thing it is, where it stands). */
    readonly hint?: string
    /** A glyph before the label. */
    readonly source?: IconSource
    /** A key chord that runs it without the palette, drawn at the end of the row as a `Kbd` ("Ctrl", "N"). */
    readonly shortcut?: readonly string[]
    /** A destination: the result is a real link through the app root's router; `onAction` runs alongside. */
    readonly href?: string
    readonly isDisabled?: boolean
}

/** The results of one kind, under their name. The app orders the groups and the items. */
export type CommandPaletteGroup = {
    readonly id: string
    readonly label: string
    readonly items: ReadonlyArray<CommandPaletteItem>
}
