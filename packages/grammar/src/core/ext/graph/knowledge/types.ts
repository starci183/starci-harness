import type { GraphTone } from "../types.js"

/** What a bubble is: a source document, or a fact read from one. */
export type KnowledgeKind = "document" | "fact"

/** How up to date a bubble is; the app says it in its own words (`stateLabels`). */
export type KnowledgeState = "ready" | "pending" | "stale" | "error"

/** A topic: a cluster of bubbles with a name. */
export interface KnowledgeCluster {
    readonly id: string
    readonly name: string
    /** The tone of its bubbles; left out, the clusters take the tones in turn. */
    readonly tone?: GraphTone
}

/** A document or a fact. */
export interface KnowledgeItem {
    readonly id: string
    readonly name: string
    readonly kind: KnowledgeKind
    readonly clusterId: string
    /** The weight of the item (visits, uses, references: a count the app owns); it sizes the bubble. */
    readonly weight: number
    /** A fact points at the document it was read from: a line joins them. */
    readonly sourceId?: string
    readonly state?: KnowledgeState
}

/** One entry of the legend: a swatch and its words (the words are the app's). Give one of `kind`, `state` or `source`. */
export interface KnowledgeLegendItem {
    readonly label: string
    readonly kind?: KnowledgeKind
    readonly state?: KnowledgeState
    /** The line from a fact to its source. */
    readonly source?: true
}

/** The words of the zoom controls. */
export interface KnowledgeZoomLabels {
    readonly zoomIn: string
    readonly zoomOut: string
    readonly fit: string
}

export interface KnowledgeMapProps {
    /** Names the map for assistive technology. */
    readonly label: string
    readonly clusters: readonly KnowledgeCluster[]
    readonly items: readonly KnowledgeItem[]
    /** Fires with the id of the bubble (or the list row) that was clicked, or opened with Enter or Space. */
    readonly onOpen?: (id: string) => void
    /** The words of the zoom buttons (the app's). */
    readonly zoomLabels: KnowledgeZoomLabels
    readonly legend?: readonly KnowledgeLegendItem[]
    /** The kind in a bubble's name card and in the list, in the app's language. */
    readonly kindLabels?: Readonly<Record<KnowledgeKind, string>>
    readonly stateLabels?: Readonly<Partial<Record<KnowledgeState, string>>>
    /** The words for a weight. */
    readonly weightLabel?: (weight: number) => string
    /** The words before the source of an item in its name card. */
    readonly sourceLabel?: string
    /** The item the first view is centred on when the map is larger than its canvas (it opens at 100% on every screen); left out, the heaviest item. */
    readonly focusId?: string
    /** Shown instead of the map when there are no bubbles. */
    readonly emptyLabel?: string
    /** True while the data is fetched: a skeleton with no text. */
    readonly isLoading?: boolean
    readonly className?: string
}
