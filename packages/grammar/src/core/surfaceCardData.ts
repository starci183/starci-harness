import type { ReactNode } from "react"
import type { PresentationState } from "./state.js"
import type { MarkState } from "./statusMark.js"
import type { DropdownMenuEntry } from "./branch/DropdownMenu/index.js"
import type { AvatarKind, AvatarShape } from "./leaf/Avatar/index.js"
import type { BadgeTone } from "./leaf/Badge/index.js"
import type { IconSource } from "./leaf/Icon/index.js"
import type { SurfaceHeadingLevel } from "./leaf/Label/index.js"
import type { LinkProps } from "./leaf/Link/index.js"
import type { ButtonProps, ButtonVariant } from "./leaf/Button/index.js"
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
    /**
     * The command's look (0.55.0, the Button's three): `border` (default) the outlined pill of an item command; `danger` a destructive one (sign out,
     * remove; a confirming press belongs in a dialog); `primary` the region's ONE solid action (`DNA-COMMON-ONE-ACCENT-FILL` counts it with every other filled button).
     */
    readonly variant?: ButtonVariant
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
    | { readonly icon: IconSource; readonly size?: "sm" | "md"; readonly avatar?: never; readonly position?: never; readonly state?: never }
    /**
     * A row among DIFFERENT things side by side (0.55.0, the status-mark rule, case 2 "which thing is which?": a run or workflow list, notification
     * rows): the subject icon on the round 40px plate of the state's tone. The status then trails as an `InlineStatus` (the row's `value`), never a second circle.
     */
    | { readonly icon: IconSource; readonly state: MarkState; readonly size?: never; readonly avatar?: never; readonly position?: never }
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
export type RowEdgeTone = "accent" | "info" | "success" | "warning" | "danger"

/** The tone of a table row's ground (0.46.2): the row takes the soft pair of the theme's token of that tone. The same four tones as the edge; see `DataTableRow.groundTone`. */
export type RowGroundTone = RowEdgeTone

/** One row of a list. A destination links its text title; its sibling commands remain separate targets. */
export type ListRowData = {
    readonly id: string
    readonly title: string
    /**
     * The title drawn with inline marks (0.55.1): the same words as `title` with a term that carries its note (`GlossaryTerm`, `SidenoteTerm`) or
     * inline `Code` among them. `title` stays the plain words that name the row. Only a row that is not itself a control (no `href`, no
     * `onPress`) draws it: an interactive term inside a link or a button would nest one control in another.
     */
    readonly titleContent?: ReactNode
    /** The title names an AI agent: a small neutral "AI" Chip follows it (`AgentName`). The app never places the Chip by hand. */
    readonly isAgent?: boolean
    /** The Chip's word in the app's language; "AI" when omitted. Only with `isAgent`. */
    readonly agentLabel?: string
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
     * A row of a version diff (0.37.28, GitHub-style; a block since 0.55.0): a rounded block (the control / nested-region corner) in the tone's soft pair (success, danger,
     * warning) with 12 padding on every side and a small gap from the next diff block, its gutter mark (`+` added, `−` removed, `~` changed, monospace, in the tone's ink)
     * in a column of its own beside the copy, and `diffLabel` as a visible 12 label in the tone's ink over the title. A removed row's title is struck through, its label
     * is not. The meaning is never colour alone: the glyph and the label carry it.
     */
    readonly diff?: "added" | "removed" | "changed"
    /** A changed row's change, drawn as the 12 muted line "from", the Grammar arrow icon, "to" under the title (no typed arrow, 0.55.0) (after `description`). Only with `diff: "changed"`. */
    readonly change?: { readonly from: string; readonly to: string }
    /** The visible label over a diff row's title, in the app's language ("Đang dùng", "Sau khi duyệt"); read once, before the title. Default "Added", "Removed", "Changed". */
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
    /**
     * The figure's trend chart under the value and meta: the app passes a `Sparkline` of `@starci/grammar/core/ext/recharts`
     * (core never imports an ext, so the figure takes the drawn chart, not its numbers). Follows the region's loading itself.
     */
    readonly trendChart?: ReactNode
    readonly icon?: IconSource
} & FigureDestination

export type CardHead = {
    readonly label?: string
    /** The label names an AI agent: a small neutral "AI" Chip follows it in the head (`AgentName`). */
    readonly isAgent?: boolean
    /** The Chip's word in the app's language; "AI" when omitted. Only with `isAgent`. */
    readonly agentLabel?: string
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
    /**
     * Full-bleed cover (0.47.2): the poster sits flush against the card's top and both side edges (no gap between the card's edge and the picture),
     * clipped by the card's top corners; the name, badges, facts and figure keep their padding below it. Works with every `aspect` and `fit`,
     * the absence frame and the loading skeleton. Default `false`: the poster sits inside the padding.
     */
    readonly bleed?: boolean
} & (
    | {
        readonly image: ImageFacts & MediaSourceRef
        readonly absence?: never
    }
    | { readonly absence: string; readonly image?: never }
)

/** A tile names itself by a mark, by a poster, or (0.47.1) by its name alone: a table of a floor plan, a product with no picture yet. */
type TileIdentity =
    | { readonly mark: TileMark; readonly poster?: undefined }
    | { readonly poster: TilePoster; readonly mark?: TileMark }
    | { readonly mark?: undefined; readonly poster?: undefined }

/** The tone of a tile's whole ground (0.47.1): the same four tones, soft pair, as `DataTableRow.groundTone`. */
export type TileGroundTone = RowGroundTone

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
    /** The tile names an AI agent (0.55.0): a small neutral "AI" Chip follows its name (`AgentName`), as on a ListRow title and a card head. */
    readonly isAgent?: boolean
    /** The Chip's word in the app's language; "AI" when omitted. Only with `isAgent`. */
    readonly agentLabel?: string
    /** A muted small line under the name, beside the mark (who made it, which version, which category). */
    readonly byline?: string
    readonly description?: string
    /** Short factual lines, separate from the name and the operational badges: one muted line each (a string is one line). */
    readonly facts?: string | readonly string[]
    /**
     * A status the whole tile answers (0.47.1; a table free, busy or waiting to pay on a floor plan): the tile takes the soft pair of the theme's
     * token of that tone, its words the pair's foreground, in both families. It sits beside the badge, which still carries the words; colour is never the only cue.
     */
    readonly groundTone?: TileGroundTone
} & TileIdentity & TileBadges & TileFigure & (
    /** 0.37.8: a whole-card action may carry the `menu` (the card's ⋯): the trigger stands above the whole-card link and never follows it; `action` stays exclusive. */
    | { readonly wholeAction: WholeCardAction; readonly action?: undefined; readonly menu?: ItemMenu }
    | { readonly action?: ItemAction; readonly menu?: ItemMenu; readonly wholeAction?: undefined }
)
