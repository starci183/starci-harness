"use client"

import { Card } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { SurfaceNesting, assertNoSurfaceInSurface, useSurfaceHost } from "../../surfaceContext.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { assertPresentationState, treatmentFor, type PresentationState } from "../../state.js"
import type {
    AccordionData,
    AccordionRowData,
    CardHead,
    Figure,
    FooterZone,
    HeaderZone,
    ListData,
    SelectData,
    TableData,
    TileData,
    WholeCardAction,
} from "../../surfaceCardData.js"
import { VerticalScrollRegionPart } from "../VerticalScrollRegion/index.js"
import { DEFAULT_SURFACE_HEADING_LEVEL, Label, type SurfaceHeadingLevel } from "../../leaf/Label/index.js"
import { Sublabel } from "../../leaf/Sublabel/index.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import { AccordionRows } from "./AccordionRows.js"
import { FigureCells, figureItems } from "./FigureCells.js"
import { ListRows } from "./ListRows.js"
import { SelectRows } from "./SelectRows.js"
import { DescriptionList, type DescriptionListItem } from "../../composite/DescriptionList/index.js"
import { TableRows } from "./TableRows.js"
import { SurfaceCardTile } from "./SurfaceCardTile.js"
import { FooterZoneView, HeaderZoneView } from "./Zones.js"
import {
    getSurfaceCardClassName,
    getSurfaceContentClassName,
    surfaceArtworkClassName,
    surfaceClassName,
    surfaceFactClassName,
    surfaceMainClassName,
    surfaceNoteClassName,
    surfaceHighlightClassName,
    surfaceHighlightSweepClassName,
    surfaceLabelClassName,
    surfaceOrbitClassName,
    type AccentCorner,
    type SurfaceCardMeasure,
    type SurfaceCardMotif,
    type SurfaceCardTreatment,
} from "./classNames.js"

export type {
    AccordionData, AccordionRowData, AvatarData, BadgeData, CardHead, Collection, Figure, FilterFields, FooterZone, HeaderZone, ImageData, ItemAction, ItemLeading,
    ItemMenu, ListData, ListRowData, SearchFields, SearchZoneFields, SelectZoneField, TableColumnData, TableData, TableGroupData, TableRowData, TileData, TileMark, TilePoster, WholeCardAction,
} from "../../surfaceCardData.js"

/** Every card names itself: a visible `label`, or an `ariaLabel` when the surrounding owner already shows the name. */
type Labelled = { readonly label: string; readonly ariaLabel?: string; readonly sublabel?: undefined }
type SelfNamed = { readonly label?: undefined; readonly ariaLabel: string; readonly sublabel?: undefined }
/** A group inside a labelled section (0.37.7): named by a Sublabel 8px above the card, never by a second Label; `sublabel` and `label` are never given together. */
type Sublabelled = { readonly sublabel: string; readonly label?: undefined; readonly ariaLabel?: string }
type Named = Labelled | SelfNamed | Sublabelled
type OptionallyNamed = { readonly label?: string; readonly ariaLabel?: string; readonly sublabel?: undefined } | Sublabelled

type Head = Omit<CardHead, "label" | "ariaLabel">

/** The ordinary light surface: no artwork slot, no motif. */
type PlainSurfaceCard = {
    readonly treatment?: "surface"
    readonly artwork?: undefined
    readonly motif?: undefined
    /**
     * `accent`: the one card a set of peers recommends (the popular plan of a pricing grid), drawn with an accent ring on the
     * same ground; the reason stays in words beside it (a badge). Absent: no ring.
     */
    readonly emphasis?: "accent"
}

/**
 * The soft card: the brand's light tint as ground (the family's `accentSoft`) under the default foreground, for a
 * card the product deliberately raises (SURFACE-4), such as a first-run welcome. It rebinds the surface pair onto
 * the tint and may carry copy and controls; it keeps the artwork slot and has no motif.
 */
type SoftSurfaceCard = {
    readonly treatment: "soft"
    /** Decorative art (a `Mascot`, or an `Image` / `MediaFrame`, carrying its `assetSlot`), `aria-hidden` and behind the content. */
    readonly artwork?: ReactNode
    readonly motif?: undefined
}

/**
 * The ink band: the page's one signature overview moment (DISCIPLINE-3), painted on the family's brand
 * ink. Its content re-binds the surface pair onto the ink, so grammar children keep their own anatomy and stay AA.
 */
type InkSurfaceCard = {
    readonly treatment: "ink"
    readonly artwork?: ReactNode
    /** Decorative motif in the artwork zone: `orbit` draws thin rings with nodes (static SVG, low contrast). */
    readonly motif?: SurfaceCardMotif
}

/** What every card has: a note under it, a skeleton state, a highlight, a presentation state. */
type Shell = {
    /** A note under the card: a small muted line, full width. */
    readonly note?: ReactNode
    /**
     * Typed zones above the body, top to bottom (the first sits right under the label). The shell draws the ONE divider between
     * neighbouring zones and between a zone and the body; a `Divider` in a zone is refused. A `filter` or `toolbar` zone's divider
     * IS the line under its tabs. Loading, error and empty draw in the body; the zones keep their geometry while loading.
     */
    readonly headers?: readonly HeaderZone[]
    /** Typed zones below the body, top to bottom, divided from it and from each other by one divider. */
    readonly footers?: readonly FooterZone[]
    /**
     * The first read has no data yet (knowledge STATE-8): the card keeps its ready geometry, drawn from the content it was
     * given, with the label kept. A refresh that has data is not loading. A card inside a loading region follows the region.
     */
    readonly isLoading?: boolean
    /** The read failed: the card keeps its label and draws this in place of its content. Loading comes first, then error, then empty. */
    readonly error?: ErrorData
    /** Draw one accent sweep behind this card; use for one featured card only. */
    readonly isHighlight?: boolean
    /** How the subject is doing; paints nothing new, exposes `data-grammar-state` for the family. */
    readonly state?: PresentationState
    /** Let a peer grid stretch the complete card (a card that fills the height its host gives it). */
    readonly height?: "fill"
    /**
     * Grammar-owned width contract (0.37.5: every kind takes it). `content` (default): the card fills its host. `narrow`: capped at 30rem, left-aligned (an order card in a
     * chat bubble; `standard` content is 40rem, too wide for a bubble). `form` / `formCompact` are the centred form measures of a `body` card.
     */
    readonly measure?: SurfaceCardMeasure
}

type BodyCard = Shell & OptionallyNamed & Head & (PlainSurfaceCard | SoftSurfaceCard | InkSurfaceCard) & {
    readonly kind?: "body"
    readonly children: ReactNode
    /** The whole card is one destination or command; the card then holds no control of its own. */
    readonly wholeAction?: WholeCardAction
    /** One logical corner of the painted face drawn at the Common accent radius. */
    readonly accentCorner?: AccentCorner
}

type FiguresCard = Shell & Named & Head & {
    readonly kind: "figures"
    /** Two to five key figures as touching cells. */
    readonly items: readonly Figure[]
}

type ListCard = Shell & Named & Head & ListData
/**
 * Facts as term/value rows that touch the card's edge, each row inset by the card padding and divided by a full-width seam (the
 * order of a purchase, a record's summary). The pairs are a real `<dl>` (DescriptionList); a strip of key figures is `figures`.
 */
type DetailsCard = Shell & Named & Head & {
    readonly kind: "details"
    readonly items: readonly DescriptionListItem[]
}
type AccordionCard = Shell & Named & Head & AccordionData
/** A choice list: checkbox rows with a title and a subtitle, full-width dividers (0.37.5). */
type SelectCard = Shell & Named & Head & SelectData
/** A table Grammar owns: columns, rows or day groups under heading rows, one column header, every line to the card's edges. */
type TableCard = Shell & Named & Head & TableData

/**
 * A tile: a peer you recognise and open (a provider, a connector). It has no `label`, `fact` or `labelEnd`: its name
 * sits inside with its mark or media, supporting facts and one action with optional overflow commands.
 */
type TileCard = Shell & TileData & {
    readonly kind: "tile"
    readonly headingLevel?: SurfaceHeadingLevel
    readonly label?: undefined
    readonly fact?: undefined
    readonly labelEnd?: undefined
}

export type SurfaceCardProps = BodyCard | FiguresCard | ListCard | DetailsCard | AccordionCard | TableCard | SelectCard | TileCard

/**
 * The orbit motif: three thin concentric rings with five small nodes, one static SVG. It is drawn in the
 * artwork zone only (never behind body copy), in the ink band's orbit colour (the ink foreground at 20%),
 * and never animates, so reduced motion has nothing to stop.
 */
const OrbitMotif = () => (
    <svg
        aria-hidden="true"
        className={surfaceOrbitClassName}
        data-grammar-surface-orbit="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
        viewBox="0 0 480 320"
    >
        <ellipse cx="264" cy="168" rx="216" ry="118" />
        <ellipse cx="264" cy="168" rx="150" ry="80" />
        <ellipse cx="264" cy="168" rx="84" ry="44" />
        <circle cx="48" cy="168" r="4" />
        <circle cx="420" cy="86" r="3.5" />
        <circle cx="160" cy="236" r="3.5" />
        <circle cx="370" cy="226" r="3" />
        <circle cx="196" cy="140" r="2.5" />
    </svg>
)

const kindOf = (props: SurfaceCardProps) => props.kind ?? "body"

const PLACEHOLDER_DISCLOSURES: readonly AccordionRowData[] = [1, 2, 3].map((n) => ({ id: `loading-${n}`, title: "Loading", body: null, isOpen: false }))

/**
 * The one card: a bounded object with its own face (COLLECTION-2). What it holds is its `kind`, a discriminated
 * union the compiler checks in every file: a plain `body` (the default), a strip of `figures`, a `list` of rows, `details` (term/value rows), an
 * `accordion`, a `table` or a `tile`; any kind may carry typed `headers` and `footers` (zones the shell pads and divides).
 *
 * Where the name sits follows the kind: a card that heads a section has a `label`, drawn
 * outside the material as an unpainted row above it; a tile has its `name` and mark or media drawn inside.
 *
 * A card never stands inside another card (development throws). On a white ground (`Pane surface`, `Drawer`, `Dialog`, `Popover`) a card IS the
 * group and draws itself bordered with no shadow (SURFACE-ELEVATION); on the pink well it has the shadow and no border.
 */
export const SurfaceCard = (props: SurfaceCardProps) => {
    const host = useSurfaceHost()
    assertNoSurfaceInSurface(host)
    const kind = kindOf(props)
    const headingId = useId()
    const state = props.state ?? "neutral"
    assertPresentationState(state)
    const stateTreatment = treatmentFor(state)
    const isLoading = useIsLoading(props.isLoading)
    const height = props.height ?? (props.kind === "tile" ? "fill" : "auto")
    const disabled = isLoading || state === "unavailable" || state === "pending"
    const isTile = props.kind === "tile"
    const body = props.kind === undefined || props.kind === "body" ? props : undefined
    const labelled = isTile ? undefined : props.label
    const name = isTile ? props.name : props.label
    const sublabel = isTile ? undefined : props.sublabel
    const accessibleName = isTile ? props.name : props.ariaLabel ?? props.label ?? sublabel
    const headingLevel = props.headingLevel ?? DEFAULT_SURFACE_HEADING_LEVEL
    const measure: SurfaceCardMeasure = props.measure ?? "content"
    const treatment: SurfaceCardTreatment = body?.treatment ?? "surface"
    const emphasis = body !== undefined && (body.treatment === undefined || body.treatment === "surface") ? body.emphasis : undefined
    const motif: SurfaceCardMotif = body?.treatment === "ink" ? body.motif ?? "none" : "none"
    const artwork = body?.treatment === "ink" || body?.treatment === "soft" ? body.artwork : undefined
    const wholeAction = isTile ? props.wholeAction : body?.wholeAction
    const headers = props.headers ?? []
    const footers = props.footers ?? []
    const isZoned = headers.length > 0 || footers.length > 0
    // A kind that draws its own faces (list, figures, accordion) touches the card's edge; a zoned card is flush too, its body and zones drawing their own insets.
    const isFace = kind !== "body" && kind !== "tile"
    const flush = isFace || isZoned
    const hasNamedHeading = name !== undefined && !isTile && labelled !== undefined

    const rootContract = wholeAction === undefined ? undefined : "SURFACE-4"
    const contentContract = ["SURFACE-2", "OVERFLOW-2", "BOUNDARY-6"].join(" ")

    const action = wholeAction?.kind === "link" ? (
        <a
            aria-disabled={disabled || undefined}
            aria-label={wholeAction.label}
            data-grammar-whole-action="link"
            href={disabled ? undefined : wholeAction.href}
            tabIndex={disabled ? -1 : undefined}
        />
    ) : wholeAction?.kind === "button" ? (
        <button
            aria-label={wholeAction.label}
            data-grammar-whole-action="button"
            disabled={disabled}
            onClick={wholeAction.press}
            type="button"
        />
    ) : null

    const failure = isLoading ? undefined : props.error
    const face = (() => {
        switch (props.kind) {
            case "figures":
                return <FigureCells items={figureItems(props.items, isLoading)} isLoading={isLoading} isDisabled={disabled} />
            case "list":
                return <ListRows data={props} isLoading={isLoading} ariaLabel={accessibleName} />
            case "select":
                return <SelectRows data={props} isLoading={isLoading} ariaLabel={accessibleName} />
            case "details":
                return <DescriptionList items={props.items} isLoading={isLoading} />
            case "accordion":
                return <AccordionRows data={isLoading && props.items.length === 0 ? { ...props, items: PLACEHOLDER_DISCLOSURES } : props} isLoading={isLoading} />
            case "table":
                return <TableRows data={props} isLoading={isLoading} ariaLabel={accessibleName} />
            case "tile":
                return <SurfaceCardTile data={props} headingId={headingId} headingLevel={headingLevel} isLoading={isLoading} isDisabled={disabled} />
            default:
                return body === undefined ? null : <LoadingScope isLoading={isLoading}>{body.children}</LoadingScope>
        }
    })()

    const surface = (
        <Card.Content
            aria-label={labelled === undefined && !isTile ? accessibleName : undefined}
            aria-labelledby={labelled !== undefined || isTile ? headingId : undefined}
            aria-busy={isLoading || undefined}
            data-grammar-loading-region={isLoading ? "true" : undefined}
            className={surfaceClassName}
            data-contract={contentContract}
            data-grammar-accent-corner={body?.accentCorner}
            data-grammar-frame="bounded"
            data-grammar-surface-kind={kind}
            data-grammar-surface-flush={flush ? "true" : undefined}
            data-grammar-surface-height={height}
            data-grammar-state={state}
            data-grammar-treatment={stateTreatment.tone}
            data-grammar-surface-treatment={treatment}
            data-grammar-surface-emphasis={emphasis}
            data-grammar-surface-artwork={artwork !== undefined ? "art" : motif !== "none" ? "motif" : "none"}
        >
            {artwork !== undefined || motif !== "none" ? (
                <div
                    aria-hidden="true"
                    className={surfaceArtworkClassName}
                    data-grammar-surface-artwork={artwork === undefined ? "none" : "art"}
                    data-grammar-surface-motif={motif}
                >
                    {motif === "orbit" ? <OrbitMotif /> : null}
                    {artwork}
                </div>
            ) : null}
            <VerticalScrollRegionPart
                className={getSurfaceContentClassName(measure, false)}
                data-contract={flush ? "GAP-0 PADDING-0" : "PADDING-4"}
                data-grammar-surface-zoned={isZoned ? "true" : undefined}
                data-grammar-surface-content="true"
                isScrollable={false}
            >
                {isZoned ? (
                    <>
                        <LoadingScope isLoading={isLoading}>
                            {headers.map((zone, index) => <HeaderZoneView key={`${zone.kind}-${index}`} zone={zone} isLoading={isLoading} />)}
                        </LoadingScope>
                        <div className={surfaceMainClassName} data-grammar-surface-main={isFace ? "face" : "padded"}>
                            {failure === undefined ? face : <ErrorView error={failure} />}
                        </div>
                        <LoadingScope isLoading={isLoading}>
                            {footers.map((zone, index) => <FooterZoneView key={`${zone.kind}-${index}`} zone={zone} />)}
                        </LoadingScope>
                    </>
                ) : failure === undefined ? face : <ErrorView error={failure} />}
            </VerticalScrollRegionPart>
            {action}
        </Card.Content>
    )
    const highlightedSurface = props.isHighlight === true && state !== "pending" ? (
        <div className={surfaceHighlightClassName} data-grammar-highlight="true">
            <div aria-hidden className={surfaceHighlightSweepClassName} />
            {surface}
        </div>
    ) : surface

    const content = (
        <Card.Root
            className={getSurfaceCardClassName(measure) ?? ""}
            data-contract={rootContract}
            data-grammar-frame="bounded"
            data-grammar-surface-kind={kind}
            data-grammar-surface-height={height}
            data-grammar-interaction={wholeAction === undefined ? "static" : "whole-action"}
            data-grammar-surface-labelled={hasNamedHeading ? "true" : "false"}
            data-grammar-surface-sublabel={sublabel === undefined ? undefined : "true"}
            data-grammar-surface-card="true"
            data-grammar-nesting="surface"
            data-grammar-surface-treatment={treatment}
            data-grammar-surface-emphasis={emphasis}
            data-component="SurfaceCard"
            data-tier="frame"
            render={(cardProps) => <section {...cardProps} />}
            variant="transparent"
        >
            {sublabel === undefined ? null : <Sublabel>{sublabel}</Sublabel>}
            {labelled === undefined || isTile ? null : (
                <Card.Header className={surfaceLabelClassName} data-contract="GAP-2" data-grammar-surface-label="true" data-grammar-label-end={props.labelEnd === undefined ? "false" : "true"}>
                    <Label as={`h${headingLevel}`} id={headingId}>{labelled}</Label>
                    {props.count === undefined || isLoading ? null : <span className="starci-core-section-count" data-grammar-section-count={props.count} {...(props.isAttention === true ? { "data-grammar-attention": "true" } : {})} data-contract="TONE-2">{props.count}</span>}
                    {props.fact === undefined ? null : <span className={surfaceFactClassName} data-contract="TONE-2 FONT-2">{props.fact}</span>}
                    {props.labelEnd === undefined ? null : <span className="starci-core-surface-label-end"><ButtonPlacementProvider placement="chrome">{props.labelEnd}</ButtonPlacementProvider></span>}
                </Card.Header>
            )}
            {highlightedSurface}
            {props.note === undefined ? null : <div className={surfaceNoteClassName} data-grammar-surface-note="true">{props.note}</div>}
        </Card.Root>
    )
    return <SurfaceNesting host="card">{content}</SurfaceNesting>
}
