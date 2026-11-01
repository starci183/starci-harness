import type { ReactNode } from "react"
import type { ButtonIntent } from "./buttonIntent.js"
import type { PresentationState } from "./state.js"
import type { DropdownMenuEntry } from "./branch/DropdownMenu/index.js"
import type { AvatarKind, AvatarShape } from "./leaf/Avatar/index.js"
import type { BadgeTone } from "./leaf/Badge/index.js"
import type { IconSource } from "./leaf/Icon/index.js"
import type { SurfaceHeadingLevel } from "./leaf/Label/index.js"

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
export type ItemAction = {
    readonly label: string
    readonly intent?: Exclude<ButtonIntent, "destructive">
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
    | { readonly avatar: AvatarData; readonly icon?: never; readonly position?: never }
    | { readonly icon: IconSource; readonly avatar?: never; readonly position?: never }
    | { readonly position: number; readonly avatar?: never; readonly icon?: never }

/** One row of a list. The data shape is shared by `SurfaceCard kind="list"` and a `Section` of rows. */
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
}

/** One key figure of a `figures` card. */
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
}

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
