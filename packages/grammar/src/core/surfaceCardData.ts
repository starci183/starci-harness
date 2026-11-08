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
import type { PrimaryTabItems, TabItem } from "./branch/Tabs/index.js"
import type { ListOption } from "./branch/Select/index.js"
import type { ImageAspect, ImageProps } from "./leaf/Image/index.js"

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
export type ImageData = {
    readonly src: string
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

/** One row of a list. A destination links its text title; its sibling commands remain separate targets. */
export type ListRowData = {
    readonly id: string
    readonly title: string
    readonly description?: string
    readonly leading?: ItemLeading
    /** At most two: the operational state, then one exception. */
    readonly badges?: readonly [BadgeData] | readonly [BadgeData, BadgeData]
    /** How the row itself is doing. The row paints its state mark and tone; nothing else changes. */
    readonly state?: PresentationState
    /** In a collection that reports outcomes: the direction of what this row reports (its leading edge). */
    readonly verdict?: "success" | "danger"
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
} & ListRowDestination

type FigureDestination = Pick<LinkProps, "href" | "onFollow" | "isDisabled"> | {
    readonly href?: never
    readonly onFollow?: never
    readonly isDisabled?: never
}

/** One key figure of a `figures` card; its optional destination belongs to the whole figure cell. */
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

/** One disclosure of an `accordion` card. */
export type AccordionRowData = {
    readonly id: string
    readonly title: string
    readonly meta?: string
    /**
     * A step mark at the start of the row: `done` (a check), `current` (the filled accent number), `problem` (a warning triangle) or
     * `todo` (a grey number). The step's number is `position`; the state is also said in words by the app (title or meta), never by the mark alone.
     */
    readonly leading?: { readonly state: "done" | "current" | "problem" | "todo"; readonly position?: number }
    readonly body: ReactNode
    readonly isOpen: boolean
    readonly isDisabled?: boolean
}

export type CardHead = {
    readonly label?: string
    readonly ariaLabel?: string
    /** One muted small line under the label, the title's own words (what the card holds, for whom). It stands 4 under the label. */
    readonly description?: string
    /** The count or one short fact beside the label. */
    readonly fact?: string
    /** The one action at the end of the label row. It takes the fact's place. */
    readonly labelEnd?: ReactNode
    /** Outline rank of the visible `label` (default 3): the rank below the nearest heading above the card. */
    readonly headingLevel?: SurfaceHeadingLevel
}

/** A collection a card holds: a list of rows or an accordion. */
export type ListData = {
    readonly kind: "list"
    readonly items: readonly ListRowData[]
    /** What the card shows when it has no rows. Required: every list answers for its empty state. */
    readonly empty: ReactNode
}

export type AccordionData = {
    readonly kind: "accordion"
    readonly items: readonly AccordionRowData[]
    readonly onItemOpenChange: (id: string, isOpen: boolean) => void
}

export type Collection = ListData | AccordionData

/** The fields of a filter zone: the tabs that narrow the card's own list. */
export type FilterFields = {
    /** The accessible name of the tab list. */
    readonly label: string
    /** The views, each with its `count`. */
    readonly items: readonly TabItem[]
    readonly selectedKey: string
    readonly onSelect: (key: string) => void
    /** The accessible name of the fold menu, from the number of folded tabs (for example "3 more filters"). */
    readonly moreLabel?: (count: number) => string
    /** The word the fold menu draws (the app's own "More"). */
    readonly overflowLabel?: string
}

/** The fields of a search zone: one search field over the card's own list. */
export type SearchFields = {
    /** The accessible name of the field (it is not drawn). */
    readonly label: string
    readonly value: string
    readonly onChange: (value: string) => void
    readonly placeholder?: string
    /** Accessible name of the clear button. */
    readonly clearLabel?: string
}

/**
 * One trailing filter of a search zone: a `Select` that narrows the same list the search does ("Status", "Owner"). Its label is its
 * accessible name and is not drawn; a muted `prefix` inside the trigger says it in words ("Status:"). The trigger keeps its natural
 * width and its words never wrap; the search takes the rest of the row.
 */
export type SelectZoneField = {
    /** The accessible name of the select (it is not drawn). */
    readonly label: string
    readonly options: readonly ListOption[]
    readonly value: string | null
    readonly onChange: (value: string | null) => void
    /** Words in the trigger while nothing is chosen. */
    readonly placeholder?: string
    /** Muted words before the value inside the trigger ("Status:"). */
    readonly prefix?: string
}

/** The fields of a search zone with its filters: the search grows, each filter keeps its natural width; narrow, the filters wrap below the search. */
export type SearchZoneFields = SearchFields & {
    /** Selects at the trailing edge of the same row, narrowing the same list. */
    readonly filters?: readonly SelectZoneField[]
}

/** The fields of a switch zone: a mode or period of the block's own data, 2 to 4 short fixed options, no count and no destination. */
export type SwitchFields = {
    /** The accessible name of the tab list. */
    readonly label: string
    /** An optional title at the leading edge of the row (muted); the row is empty there otherwise. */
    readonly title?: string
    readonly items: PrimaryTabItems
    readonly selectedKey: string
    readonly onSelect: (key: string) => void
}

/**
 * A band above the card's body. Zones are typed: the shell owns their padding, their geometry while loading and the ONE divider
 * between neighbouring zones and between a zone and the body (a `Divider` inside a zone is refused). `custom` is the only free
 * zone: Grammar pads and seams it, and it may not hold `Tabs`, `SearchField` or `Divider` (use the typed zones).
 */
export type HeaderZone =
    | ({ readonly kind: "filter" } & FilterFields)
    | ({ readonly kind: "search" } & SearchZoneFields)
    /** The filter tabs at the leading edge and a compact search field at the trailing edge, in one row; narrow: the extra tabs fold into the menu and the search becomes a search button that opens a row. */
    | { readonly kind: "toolbar"; readonly filter: FilterFields; readonly search: SearchFields }
    | { readonly kind: "figures"; readonly items: readonly Figure[] }
    /** The card's first header row, inside the surface: primary tabs (a pill in a track) at the trailing edge, an optional title at the leading edge, the one line under it: "This month / Last month", "Day / Week / Month", "List / Board". */
    | ({ readonly kind: "switch" } & SwitchFields)
    | { readonly kind: "custom"; readonly children: ReactNode }

/** A band below the card's body. */
export type FooterZone =
    | { readonly kind: "more"; readonly label: string; readonly press: () => void; readonly href?: never }
    | { readonly kind: "more"; readonly label: string; readonly href: string; readonly press?: never }
    | {
        readonly kind: "paging"
        readonly page: number
        readonly pageCount: number
        readonly onPage: (page: number) => void
        readonly labels: {
            /** Names the pager landmark, e.g. "Results pages". */
            readonly nav: string
            readonly previous: string
            readonly next: string
            /** The accessible name of one page button, e.g. "Page 3". */
            readonly page: (page: number) => string
            /** An optional summary, e.g. "21-30 of 94". */
            readonly summary?: string
        }
    }
    | { readonly kind: "custom"; readonly children: ReactNode }

/** One column of a `table` card. */
export type TableColumnData = {
    readonly id: string
    readonly label: string
    readonly align?: "start" | "end"
    /** A column of amounts: its cells never wrap, read in tabular numerals and align to the end. */
    readonly numeric?: boolean
    /** Narrow-width mode: a `low` column leaves the header below the card's collapse width and joins the row as a muted line under the first column. Default `high`. */
    readonly priority?: "high" | "low"
}

/** One row of a `table` card: its cells by column id. */
export type TableRowData = {
    readonly id: string
    readonly cells: Readonly<Record<string, ReactNode>>
    /** A destination: the whole row is a link target. */
    readonly href?: string
}

/** A run of rows under one group heading row inside the same table (a day of a ledger). */
export type TableGroupData = {
    readonly id: string
    /** The group heading, e.g. the date. */
    readonly label: string
    /** One short fact at the end of the heading, e.g. the end-of-day balance. */
    readonly fact?: string
    readonly rows: readonly TableRowData[]
}

/** The body of a `table` card: Grammar owns the table. The rows are one list or groups of rows under heading rows; the column header is drawn once. */
export type TableData = {
    readonly kind: "table"
    readonly columns: readonly TableColumnData[]
    /** What the card shows when it has no rows. Required: every table answers for its empty state. */
    readonly empty: ReactNode
    /** The whole row is pressable (opens a drawer): called with the row's `id` on a click, Enter or Space on the focused row. Commands inside a row stay their own. */
    readonly onRowAction?: (id: string) => void
} & (
    | { readonly rows: readonly TableRowData[]; readonly groups?: undefined }
    | { readonly groups: readonly TableGroupData[]; readonly rows?: undefined }
)

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
    readonly aspect?: Exclude<ImageAspect, "auto">
    readonly fit?: ImageProps["fit"]
} & (
    | {
        readonly image: Pick<ImageProps, "src" | "alt" | "loading" | "srcSet" | "sizes" | "width" | "height">
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
    | { readonly wholeAction: WholeCardAction; readonly action?: undefined; readonly menu?: undefined }
    | { readonly action?: ItemAction; readonly menu?: ItemMenu; readonly wholeAction?: undefined }
)
