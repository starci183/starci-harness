import type { ReactNode } from "react"
import type { ButtonIntent } from "./buttonIntent.js"
import type { PresentationState } from "./state.js"
import type { DropdownMenuEntry } from "./branch/DropdownMenu/index.js"
import type { AvatarKind, AvatarShape } from "./leaf/Avatar/index.js"
import type { BadgeTone } from "./leaf/Badge/index.js"
import type { IconSource } from "./leaf/Icon/index.js"
import type { SurfaceHeadingLevel } from "./leaf/Label/index.js"
import type { LinkProps } from "./leaf/Link/index.js"
import type { ButtonProps } from "./leaf/Button/index.js"
import type { ImageFacts, ImageProps, MediaSourceRef } from "./leaf/Image/index.js"

/** A status mark as data: the words, the tone, and whether it leads with a status dot. */
export type BadgeData = {
    readonly label: string
    readonly tone?: BadgeTone
    /** A status with its words: draws the leading dot. */
    readonly isDot?: boolean
}

/** A person or an agent as data. */
export type AvatarData = {
    readonly name: string
    readonly seed?: string
    readonly src?: string
    readonly kind?: AvatarKind
    readonly shape?: AvatarShape
}

/** A picture as data. `alt` is required; pass "" only for a purely decorative one. */
export type ImageData = MediaSourceRef & {
    readonly alt: string
}

/** One visible command of an item or a tile: a destination or a same-document command, never both. */
export type ItemAction = Pick<ButtonProps, "isPending"> & {
    readonly label: string
    /** The command's consequence. `destructive` draws the soft danger pill of the entry step (sign out, remove); the confirming press belongs in a dialog. Default `neutral`: the outlined pill of an item command. */
    readonly intent?: ButtonIntent
    /**
     * With `intent="commit"`: this row command is the region's ONE primary (the filled accent button), not the outlined item pill. At most
     * one per region (`DNA-COMMON-ONE-ACCENT-FILL` counts it with every other filled button); ignored for any other intent.
     */
    readonly isPrimary?: boolean
    readonly isDisabled?: boolean
    /** The command leads somewhere (opens a page, the next step): the button ends with Grammar's arrow (`Button endArrow`). */
    readonly endArrow?: boolean
} & (
    | { readonly href: string; readonly press?: never }
    | { readonly press: () => void; readonly href?: never }
)

/** The commands of an item beyond its one visible action. */
export type ItemMenu = {
    /** The accessible name of the menu button. */
    readonly label: string
    readonly entries: readonly DropdownMenuEntry[]
}

/** The mark that leads a row. */
export type ItemLeading =
    | { readonly avatar: AvatarData; readonly size?: "sm" | "md"; readonly icon?: never; readonly position?: never }
    | { readonly icon: IconSource; readonly size?: "sm" | "md"; readonly avatar?: never; readonly position?: never }
    | { readonly position: number; readonly format?: "ordinal" | "hash"; readonly size?: never; readonly avatar?: never; readonly icon?: never }

type ListRowDestination = Pick<LinkProps, "href" | "onFollow"> | {
    readonly href?: never
    readonly onFollow?: never
}

/**
 * A row that can be moved by dragging, with a keyboard alternative (Alt + arrow keys). A `Board` supplies it to its rows; an app
 * rarely writes it. The row keeps its look at rest: no handle is drawn.
 */
export type RowDrag = {
    readonly onDragStart: () => void
    readonly onDragEnd: () => void
    /** Alt + ArrowLeft or ArrowRight on the focused row: move it to the previous or next place. */
    readonly onMoveKey?: (direction: "previous" | "next") => void
    /** The words that explain the keyboard move to a screen reader (the app's language). */
    readonly keyHint?: string
}

/**
 * The tone of a row's leading edge (0.45.1): a 2px bar on the row's start edge in the theme's token of that tone (`accent`, `success`, `warning`, `danger`), the same bar a selected
 * table row draws. It marks a row that waits for the reader or leads a list (a pending approval, the most recent item), never a status word: the row's badge or meta carries the words.
 */
export type RowEdgeTone = "accent" | "success" | "warning" | "danger"

/** One row of a list. A destination links its text title; its sibling commands remain separate targets. */
export type ListRowData = {
    readonly id: string
    readonly title: string
    /**
     * The line under the name. A string is the muted description (14). A node (inline text with 16px marks: "@chatbot · [logo] Email · [logo] Chat")
     * is drawn at 12, muted, directly under the name at the identity gap; keep it to one line of inline content.
     */
    readonly description?: ReactNode
    readonly leading?: ItemLeading
    /** At most two: the operational state, then one exception. */
    readonly badges?: readonly [BadgeData] | readonly [BadgeData, BadgeData]
    /** How the row itself is doing. The row paints its state mark and tone; nothing else changes. */
    readonly state?: PresentationState
    /** In a collection that reports outcomes: the direction of what this row reports (its leading edge). `edgeTone` draws the same edge for any other reason and wins when both are set. */
    readonly verdict?: "success" | "danger"
    /** The tone of the row's 2px leading edge (0.45.1), for a row that waits for the reader or leads the list; see `RowEdgeTone`. */
    readonly edgeTone?: RowEdgeTone
    /**
     * `unread` (0.46.0): the row has not been read. Its title takes the strong weight and an accent dot follows it, the one look of an unread row (the same fact as a
     * `ListBox` item's `emphasis: "unread"`). The dot is decorative: `unreadLabel` is the word a screen reader reads before the title.
     */
    readonly emphasis?: "unread"
    /** The word read before the title of an unread row, in the app's language ("Unread"). Without it the weight and the dot are visual only. */
    readonly unreadLabel?: string
    readonly action?: ItemAction
    /**
     * Where the command and the menu stand. `below` (default) lets them wrap under the copy when the row is narrow (below 28rem of its
     * container); `end` keeps them at the END of the row, vertically centred against the copy, at every width (a two-line row whose
     * one short command must not take a line of its own). The copy truncates instead of the commands wrapping.
     */
    readonly actionPlacement?: "below" | "end"
    readonly menu?: ItemMenu
    /** The one named field for custom drawing under the row's copy: a pre-rendered node, never a function. */
    readonly detail?: ReactNode
    /**
     * The value of a key-value row (0.37.5, list `layout="keyValue"`): `title` is the key (muted, at the start) and `value` is the content (normal text, at the end; it wraps under the key
     * on a narrow container). In a `rows` list it is the row's fact between the copy and the end group: `value`, `badges` and an end `action` (`actionPlacement: "end"`) are
     * one supported combination, one line, centred against the copy (the value is a grid track of its own, 0.37.36).
     */
    readonly value?: ReactNode
    /**
     * The whole row opens something: pressing anywhere on it (the title is the one focusable button, its hit area is the row)
     * runs this. Sibling commands and the menu stay separate targets above it. Exclusive with `href`.
     */
    readonly onPress?: () => void
    readonly drag?: RowDrag
    /**
     * One control at the END of the row, after the command and the menu: a `Select` (which agent uses this connection) or a `Switch`
     * (this agent may). It keeps its own state and label; the row draws it as it draws an action.
     */
    readonly control?: ReactNode
    /**
     * One short fact at the END of the row, before the commands (a due date, "8 min ago"): one line, truncating. `tone="danger"`
     * for a fact that is a problem (overdue). Drawn as a Skeleton of its width while the row loads.
     */
    readonly meta?: { readonly text: string; readonly tone?: "muted" | "danger" }
    /**
     * A row of a version diff (0.37.28, GitHub-style): a gutter mark at the row's start, `+` added, `−` removed, `~` changed (monospace, in the tone's ink), and the row's ground in
     * the tone's soft pair (success, danger, warning). A removed row's title is struck through. The mark is never colour alone: the glyph carries the meaning and `diffLabel`
     * is read before the title.
     */
    readonly diff?: "added" | "removed" | "changed"
    /** A changed row's change, drawn as the 12 muted line "from → to" under the title (after `description`). Only with `diff: "changed"`. */
    readonly change?: { readonly from: string; readonly to: string }
    /** The word a screen reader reads for the gutter mark, in the app's language. Default "Added", "Removed", "Changed". */
    readonly diffLabel?: string
} & ListRowDestination

type FigureDestination = Pick<LinkProps, "href" | "onFollow" | "isDisabled"> | {
    readonly href?: never
    readonly onFollow?: never
    readonly isDisabled?: never
}

/** One key figure of a `Section kind="figures"` ribbon; its optional destination belongs to the whole figure cell. */
export type Figure = {
    readonly id: string
    /** What the figure measures. */
    readonly term: string
    readonly value: string | number
    /** Follows the value in a lighter face. */
    readonly unit?: string | number
    /** Its source or its time, under the value. */
    readonly meta?: string
    /**
     * The direction of the change `meta` reports. The meta line starts with a mark in the tone: `up` a triangle up in the success pair,
     * `down` a triangle down in the danger pair (swapped by `trendSense="lower-is-better"`), `flat` a neutral dash. The mark is
     * decorative; the direction is also said in words (`trendLabel`). Needs `meta`.
     */
    readonly trend?: "up" | "down" | "flat"
    /** Which way is good. `higher-is-better` (default): up is success, down is danger. `lower-is-better` (a cost, a churn): the pairs swap. */
    readonly trendSense?: "higher-is-better" | "lower-is-better"
    /** The direction in words for assistive technology, read before the meta (e.g. "Tang", "Giam"). Default "Up", "Down", "No change". */
    readonly trendLabel?: string
    /** The figure's recent values, oldest first: a Sparkline under the value and meta, 96 x 32. */
    readonly trendLine?: readonly number[]
    /** Names the trend line for assistive technology. Defaults to the term. */
    readonly trendLineLabel?: string
    readonly icon?: IconSource
} & FigureDestination

export type CardHead = {
    readonly label?: string
    readonly ariaLabel?: string
    /*
     * A card head has NO description, subtitle or count: the head is the label, one fact and one end action. A line that explains the
     * card's data (a legend, a source, a period) goes in `note`; a line that explains a row is that row's own subtitle.
     */
    /** One short fact beside the label. */
    readonly fact?: string
    /** The one action at the end of the label row: a `Link variant="head"` or an info `IconButton`. It stands at the end, after `fact`. */
    readonly labelEnd?: ReactNode
    /** Outline rank of the visible `label` (default 3): the rank below the nearest heading above the card. */
    readonly headingLevel?: SurfaceHeadingLevel
}

export type WholeCardAction =
    | { readonly kind: "link"; readonly href: string; readonly label: string }
    | { readonly kind: "button"; readonly press: () => void; readonly label: string }

/** What a tile is marked with: a logo, a glyph or a person. */
export type TileMark =
    | { readonly logo: ImageData; readonly icon?: never; readonly avatar?: never }
    | { readonly icon: IconSource; readonly logo?: never; readonly avatar?: never }
    | { readonly avatar: AvatarData; readonly logo?: never; readonly icon?: never }

/** A tile reserves the same media frame for an image and for a known missing image. */
export type TilePoster = {
    /** Landscape is the default 4:3 frame; unresolved content uses this same ratio. */
    readonly aspect?: "square" | "landscape" | "portrait"
    readonly fit?: ImageProps["fit"]
} & (
    | {
        readonly image: ImageFacts & MediaSourceRef
        readonly absence?: never
    }
    | { readonly absence: string; readonly image?: never }
)

type TileIdentity =
    | { readonly mark: TileMark; readonly poster?: undefined }
    | { readonly poster: TilePoster; readonly mark?: TileMark }

/**
 * One stronger plain value at the START of the action row (a price, a count): bold text, no chip, truncating on one line; the `action`
 * and the `menu` stay at the end of the same row. A tile with a `figure` has no single `badge` (the foot holds one or the other).
 */
type TileFigure =
    | { readonly figure?: undefined }
    | { readonly figure: string; readonly badge?: undefined }

type TileBadges =
    | { readonly badge?: BadgeData; readonly badges?: undefined }
    | { readonly badge?: undefined; readonly badges: readonly [BadgeData] | readonly [BadgeData, BadgeData] | readonly [BadgeData, BadgeData, BadgeData] }

/** The tile owns its identity, media, supporting facts, one visible action and any overflow commands. */
export type TileData = {
    readonly name: string
    /** A muted small line under the name, beside the mark (who made it, which version, which category). */
    readonly byline?: string
    readonly description?: string
    /** Short factual lines, separate from the name and the operational badges: one muted line each (a string is one line). */
    readonly facts?: string | readonly string[]
} & TileIdentity & TileBadges & TileFigure & (
    /** 0.37.8: a whole-card action may carry the `menu` (the card's ⋯): the trigger stands above the whole-card link and never follows it; `action` stays exclusive. */
    | { readonly wholeAction: WholeCardAction; readonly action?: undefined; readonly menu?: ItemMenu }
    | { readonly action?: ItemAction; readonly menu?: ItemMenu; readonly wholeAction?: undefined }
)
