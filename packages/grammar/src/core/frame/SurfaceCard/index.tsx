"use client"

import { Card } from "@heroui/react"
import { useId, type ReactNode } from "react"
import { SurfaceNesting, assertNoSurfaceInSurface, useSurfaceHost } from "../../surfaceContext.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { assertPresentationState, treatmentFor, type PresentationState } from "../../state.js"
import type {
    AccordionData,
    Band,
    BadgeData,
    CardHead,
    Collection,
    Figure,
    ItemAction,
    ListData,
    TileMark,
    WholeCardAction,
} from "../../surfaceCardData.js"
import { VerticalScrollRegion } from "../VerticalScrollRegion/index.js"
import { DEFAULT_SURFACE_HEADING_LEVEL, Label, type SurfaceHeadingLevel } from "../../leaf/Label/index.js"
import { Avatar } from "../../leaf/Avatar/index.js"
import { Badge } from "../../leaf/Badge/index.js"
import { Button } from "../../leaf/Button/index.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import { Image } from "../../leaf/Image/index.js"
import { Skeleton, SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { AccordionRows } from "./AccordionRows.js"
import { FigureCells } from "./FigureCells.js"
import { ListRows } from "./ListRows.js"
import {
    getSurfaceCardClassName,
    getSurfaceContentClassName,
    surfaceArtworkClassName,
    surfaceBandClassName,
    surfaceClassName,
    surfaceFactClassName,
    surfaceFooterClassName,
    surfaceHighlightClassName,
    surfaceHighlightSweepClassName,
    surfaceLabelClassName,
    surfaceOrbitClassName,
    tileClassName,
    type AccentCorner,
    type SurfaceCardMeasure,
    type SurfaceCardMotif,
    type SurfaceCardTreatment,
} from "./classNames.js"

export type {
    AccordionData, AccordionRowData, AvatarData, BadgeData, Band, CardHead, Collection, Figure, ImageData, ItemAction, ItemLeading,
    ItemMenu, ListData, ListRowData, TileMark, WholeCardAction,
} from "../../surfaceCardData.js"

/** Every card names itself: a visible `label`, or an `ariaLabel` when the surrounding owner already shows the name. */
type Labelled = { readonly label: string; readonly ariaLabel?: string }
type SelfNamed = { readonly label?: undefined; readonly ariaLabel: string }
type OptionallyNamed = { readonly label?: string; readonly ariaLabel?: string }

type Head = Omit<CardHead, "label" | "ariaLabel">

/** The ordinary light surface: no artwork slot, no motif. */
type PlainSurfaceCard = {
    readonly treatment?: "surface"
    readonly artwork?: undefined
    readonly motif?: undefined
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

type WholeActionOnly = { readonly wholeAction: WholeCardAction; readonly action?: undefined }
type ActionOnly = { readonly action?: ItemAction; readonly wholeAction?: undefined }

/** What every card has: a note under it, a skeleton state, a highlight, a presentation state. */
type Shell = {
    /** A note under the card: the same small muted line, full width. */
    readonly footer?: ReactNode
    /** Unresolved content (knowledge STATE-8): the card keeps its ready geometry. */
    readonly isSkeleton?: boolean
    /** Draw one accent sweep behind this card; use for one featured card only. */
    readonly isHighlight?: boolean
    /** How the subject is doing; paints nothing new, exposes `data-grammar-state` for the family. */
    readonly state?: PresentationState
    /** Let a peer grid stretch the complete card (a card that fills the height its host gives it). */
    readonly height?: "fill"
}

type BodyCard = Shell & OptionallyNamed & Head & (PlainSurfaceCard | SoftSurfaceCard | InkSurfaceCard) & {
    readonly kind?: "body"
    readonly children: ReactNode
    /** The whole card is one destination or command; the card then holds no control of its own. */
    readonly wholeAction?: WholeCardAction
    /** Grammar-owned width contract for ordinary content or compact form cards. */
    readonly measure?: SurfaceCardMeasure
    /** One logical corner of the painted face drawn at the Common accent radius (ruling accent-corner). */
    readonly accentCorner?: AccentCorner
}

type FiguresCard = Shell & (Labelled | SelfNamed) & Head & {
    readonly kind: "figures"
    /** Two to four key figures as touching cells. */
    readonly items: readonly Figure[]
}

type ListCard = Shell & (Labelled | SelfNamed) & Head & ListData
type AccordionCard = Shell & (Labelled | SelfNamed) & Head & AccordionData

/** Any number of faces, then at most one collection, last. The shell draws the seams; a `Divider` is refused. */
type BandsCard = Shell & (Labelled | SelfNamed) & Head & {
    readonly kind: "bands"
    readonly bands: readonly [...Band[], Band | Collection]
}

/**
 * A tile: a peer you recognise and open (a provider, a connector). It has no `label`, `fact` or `labelEnd`: its name
 * sits inside, beside its mark, and the foot row holds its status and its one action.
 */
type TileCard = Shell & {
    readonly kind: "tile"
    readonly name: string
    readonly mark: TileMark
    readonly description?: string
    readonly badge?: BadgeData
    readonly headingLevel?: SurfaceHeadingLevel
    readonly label?: undefined
    readonly fact?: undefined
    readonly labelEnd?: undefined
} & (WholeActionOnly | ActionOnly)

export type SurfaceCardProps = BodyCard | FiguresCard | ListCard | AccordionCard | BandsCard | TileCard

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

const TileMarkView = ({ mark, isSkeleton }: { readonly mark: TileMark; readonly isSkeleton: boolean }) => {
    if (isSkeleton) return <span className="starci-core-tile-mark" data-grammar-tile-mark="skeleton"><Skeleton shape="rect" size="md" /></span>
    if (mark.logo !== undefined) {
        return <span className="starci-core-tile-mark" data-grammar-tile-mark="logo"><Image src={mark.logo.src} alt={mark.logo.alt} aspect="square" fit="contain" plate="none" /></span>
    }
    if (mark.icon !== undefined) return <span className="starci-core-tile-mark" data-grammar-tile-mark="icon"><IconTile source={mark.icon} size="md" /></span>
    return <span className="starci-core-tile-mark" data-grammar-tile-mark="avatar"><Avatar {...mark.avatar} size="lg" isDecorative /></span>
}

const BandView = ({ band, isSkeleton }: { readonly band: Band | Collection; readonly isSkeleton: boolean }) => {
    switch (band.kind) {
        case "body":
            return (
                <div className={surfaceBandClassName} data-grammar-band="body">
                    {band.label === undefined ? null : <Label as="h4">{band.label}</Label>}
                    {band.children}
                </div>
            )
        case "figures":
            return <div className={surfaceBandClassName} data-grammar-band="figures"><FigureCells items={band.items} isSkeleton={isSkeleton} /></div>
        case "media":
            return <div className={surfaceBandClassName} data-grammar-band="media">{band.artwork}</div>
        case "list":
            return <div className={surfaceBandClassName} data-grammar-band="list"><ListRows data={band} isSkeleton={isSkeleton} /></div>
        case "accordion":
            return <div className={surfaceBandClassName} data-grammar-band="accordion"><AccordionRows data={band} isSkeleton={isSkeleton} /></div>
    }
}

const kindOf = (props: SurfaceCardProps) => props.kind ?? "body"

/**
 * The one card: a bounded object with its own face (COLLECTION-2). What it holds is its `kind`, a discriminated
 * union the compiler checks in every file: a plain `body` (the default), a strip of `figures`, a `list` of rows, an
 * `accordion`, `bands` (faces divided by seams, ending in at most one collection), or a `tile`.
 *
 * Where the name sits follows the kind (ruling `card-label-by-kind`): a card that heads a section has a `label`, drawn
 * outside the material as an unpainted row above it; a tile has a `name` and a `mark`, drawn inside.
 *
 * A card never stands inside another surface (a card, `Pane surface`, a `Dialog`, `Drawer` or `Popover`); development
 * throws, and R356 refuses it across files.
 */
export const SurfaceCard = (props: SurfaceCardProps) => {
    const host = useSurfaceHost()
    assertNoSurfaceInSurface(host)
    const kind = kindOf(props)
    const headingId = useId()
    const state = props.state ?? "neutral"
    assertPresentationState(state)
    const stateTreatment = treatmentFor(state)
    const isSkeleton = props.isSkeleton === true
    const height = props.height ?? (props.kind === "tile" ? "fill" : "auto")
    const disabled = state === "unavailable" || state === "pending"
    const isTile = props.kind === "tile"
    const body = props.kind === undefined || props.kind === "body" ? props : undefined
    const labelled = isTile ? undefined : props.label
    const name = isTile ? props.name : props.label
    const accessibleName = isTile ? props.name : props.ariaLabel ?? props.label
    const headingLevel = props.headingLevel ?? DEFAULT_SURFACE_HEADING_LEVEL
    const measure: SurfaceCardMeasure = body?.measure ?? "content"
    const treatment: SurfaceCardTreatment = body?.treatment ?? "surface"
    const motif: SurfaceCardMotif = body?.treatment === "ink" ? body.motif ?? "none" : "none"
    const artwork = body?.treatment === "ink" || body?.treatment === "soft" ? body.artwork : undefined
    const wholeAction = isTile ? props.wholeAction : body?.wholeAction
    const flush = kind !== "body" && kind !== "tile"
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

    const face = (() => {
        switch (props.kind) {
            case "figures":
                return <FigureCells items={props.items} isSkeleton={isSkeleton} />
            case "list":
                return <ListRows data={props} isSkeleton={isSkeleton} ariaLabel={accessibleName} />
            case "accordion":
                return <AccordionRows data={props} isSkeleton={isSkeleton} />
            case "bands":
                return props.bands.map((band, index) => <BandView key={`${band.kind}-${index}`} band={band} isSkeleton={isSkeleton} />)
            case "tile":
                return (
                    <div className={tileClassName} data-grammar-tile="true">
                        <TileMarkView mark={props.mark} isSkeleton={isSkeleton} />
                        <span className="starci-core-tile-copy" data-contract="GAP-1">
                            <Label as={`h${headingLevel}`} id={headingId}>{isSkeleton ? <SkeletonPlaceholder>{props.name}</SkeletonPlaceholder> : props.name}</Label>
                            {props.description === undefined ? null : (
                                <span className="starci-core-tile-description" data-contract="TONE-2 FONT-2">{isSkeleton ? <SkeletonPlaceholder>{props.description}</SkeletonPlaceholder> : props.description}</span>
                            )}
                        </span>
                        {props.badge === undefined && props.action === undefined ? null : (
                            <ButtonPlacementProvider placement="item">
                                <span className="starci-core-tile-foot" data-contract="GAP-2">
                                    {props.badge === undefined ? <span /> : (
                                        props.badge.isDot === true
                                            ? <Badge isDot tone={props.badge.tone ?? "neutral"} isSkeleton={isSkeleton}>{props.badge.label}</Badge>
                                            : <Badge tone={props.badge.tone ?? "neutral"} isSkeleton={isSkeleton}>{props.badge.label}</Badge>
                                    )}
                                    {props.action === undefined ? null : (
                                        props.action.href === undefined
                                            ? <Button size="sm" intent={props.action.intent ?? "neutral"} isDisabled={props.action.isDisabled === true} isSkeleton={isSkeleton} onPress={props.action.press}>{props.action.label}</Button>
                                            : <Button size="sm" intent={props.action.intent ?? "neutral"} isDisabled={props.action.isDisabled === true} isSkeleton={isSkeleton} href={props.action.href}>{props.action.label}</Button>
                                    )}
                                </span>
                            </ButtonPlacementProvider>
                        )}
                    </div>
                )
            default:
                return body?.children
        }
    })()

    const surface = (
        <Card.Content
            aria-label={labelled === undefined && !isTile ? accessibleName : undefined}
            aria-labelledby={labelled !== undefined || isTile ? headingId : undefined}
            aria-busy={isSkeleton || undefined}
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
            <VerticalScrollRegion
                className={getSurfaceContentClassName(measure, false)}
                data-contract={flush ? "GAP-0 PADDING-0" : "PADDING-4"}
                data-grammar-surface-content="true"
                isScrollable={false}
            >
                {face}
            </VerticalScrollRegion>
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
            data-grammar-surface-card="true"
            data-grammar-nesting="surface"
            data-grammar-surface-treatment={treatment}
            data-component="SurfaceCard"
            data-tier="frame"
            render={(cardProps) => <section {...cardProps} />}
            variant="transparent"
        >
            {labelled === undefined || isTile ? null : (
                <Card.Header className={surfaceLabelClassName} data-contract="GAP-2" data-grammar-surface-label="true" data-grammar-label-end={props.labelEnd === undefined ? "false" : "true"}>
                    <Label as={`h${headingLevel}`} id={headingId}>{labelled}</Label>
                    {props.fact === undefined ? null : <span className={surfaceFactClassName} data-contract="TONE-2 FONT-2">{props.fact}</span>}
                    {props.labelEnd === undefined ? null : <span className="starci-core-surface-label-end"><ButtonPlacementProvider placement="chrome">{props.labelEnd}</ButtonPlacementProvider></span>}
                </Card.Header>
            )}
            {highlightedSurface}
            {props.footer === undefined ? null : <div className={surfaceFooterClassName} data-grammar-surface-footer="true">{props.footer}</div>}
        </Card.Root>
    )
    return <SurfaceNesting host="card">{content}</SurfaceNesting>
}
