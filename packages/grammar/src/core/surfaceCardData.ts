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
    readonly isDisabled?: boolean
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
    | { readonly position: number; readonly size?: never; readonly avatar?: never; readonly icon?: never }

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
    readonly icon?: IconSource
} & FigureDestination

/** One disclosure of an `accordion` card. */
export type AccordionRowData = {
    readonly id: string
    readonly title: string
    readonly meta?: string
    readonly body: ReactNode
    readonly isOpen: boolean
    readonly isDisabled?: boolean
}

export type CardHead = {
    readonly label?: string
    readonly ariaLabel?: string
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

/** A face of a `bands` card. */
export type Band =
    | { readonly kind: "body"; readonly label?: string; readonly children: ReactNode }
    | { readonly kind: "figures"; readonly items: readonly Figure[] }
    | { readonly kind: "media"; readonly artwork: ReactNode }

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

type TileBadges =
    | { readonly badge?: BadgeData; readonly badges?: undefined }
    | { readonly badge?: undefined; readonly badges: readonly [BadgeData] | readonly [BadgeData, BadgeData] | readonly [BadgeData, BadgeData, BadgeData] }

/** The tile owns its identity, media, supporting facts, one visible action and any overflow commands. */
export type TileData = {
    readonly name: string
    readonly description?: string
    /** A short factual line, separate from the name and the operational badges. */
    readonly facts?: string
} & TileIdentity & TileBadges & (
    | { readonly wholeAction: WholeCardAction; readonly action?: undefined; readonly menu?: undefined }
    | { readonly action?: ItemAction; readonly menu?: ItemMenu; readonly wholeAction?: undefined }
)
