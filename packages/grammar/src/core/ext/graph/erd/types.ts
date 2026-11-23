import type { IconSource } from "../../../index.js"

/** One field of an entity: its name and, in the app's words, its plain type (text, number, money, date, choice). A field a relation starts at shows a link icon and the name of the other entity instead. */
export interface ErdField {
    readonly id: string
    readonly label: string
    readonly type?: string
}

/** A box of the map: one kind of record of the app, with its icon, its record count and its fields. */
export interface ErdEntity {
    readonly id: string
    readonly label: string
    /** The record count in the app's words and format (e.g. "1.280"). */
    readonly count?: number | string
    /** The subject glyph on the round tile: an SVG component of the app's own icon set (Grammar's `IconSource`); left out, the tile shows the first letter of the name. */
    readonly icon?: IconSource
    readonly fields?: readonly ErdField[]
}

/** One end of a relation: whether many records stand there (a crow's foot) or one (two bars), and whether the end may be empty (a ring). */
export interface ErdEnd {
    /** Many records at this end. Default: true at the `from` end, false at the `to` end. */
    readonly many?: boolean
    /** This end may have no record at all. Default false. */
    readonly optional?: boolean
}

/** A relation: the field `field` of the entity `source` points at the entity `target`. Its words come from the app. */
export interface ErdRelation {
    readonly id?: string
    readonly source: string
    /** The field of `source` the line starts at; left out, it starts at the head of `source`. */
    readonly field?: string
    readonly target: string
    /** The words on the line, in the app's language (e.g. "1 khách · nhiều đơn"). */
    readonly label?: string
    /** The end at the field's entity (`source`): many by default. */
    readonly from?: ErdEnd
    /** The end at `target`: one by default. */
    readonly to?: ErdEnd
}

export interface ErdMapProps {
    readonly entities: readonly ErdEntity[]
    readonly relations: readonly ErdRelation[]
    /** The accessible name of the map. */
    readonly label: string
    /** An entity was pressed (click, Enter or Space): its id. */
    readonly onOpen?: (type: string) => void
    /** Most field rows an entity draws (the fields its relations start at always stay); the rest is one "+N" row. Default 8. */
    readonly maxFields?: number
    /** The "+N" row, in the app's words (e.g. `(n) => "+" + n + " trường"`). */
    readonly moreLabel?: (count: number) => string
    readonly isLoading?: boolean
    readonly emptyLabel?: string
    /** The entity the first view is centred on when the map is larger than its frame (it opens at 100% on every screen); left out, the map opens at its top-left corner. */
    readonly focusId?: string
    /** The labels of the zoom controls (xyflow's `ariaLabelConfig`). */
    readonly ariaLabelConfig?: Readonly<Record<string, string>>
    readonly className?: string
}
