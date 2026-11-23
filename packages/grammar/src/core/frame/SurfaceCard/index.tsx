"use client"

import { toneEdgeProps, type ToneEdge } from "../../toneEdge.js"
import { Card } from "@heroui/react"
import { DropdownMenu } from "../../branch/DropdownMenu/index.js"
import { AgentName } from "../../leaf/AgentName/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { useId, type ReactNode } from "react"
import { SurfaceNesting, assertNoSurfaceInSurface, useSurfaceHost } from "../../surfaceContext.js"
import { assertPresentationState, treatmentFor, type PresentationState } from "../../state.js"
import type { CardHead, ItemMenu, TileData, WholeCardAction } from "../../surfaceCardData.js"
import { VerticalScrollRegionPart } from "../VerticalScrollRegion/index.js"
import { DEFAULT_SURFACE_HEADING_LEVEL, Label, type SurfaceHeadingLevel } from "../../leaf/Label/index.js"
import { Sublabel } from "../../leaf/Sublabel/index.js"
import { ErrorView, type ErrorData } from "../../loadingState.js"
import { LoadingScope, useIsLoading } from "../../regionScope.js"
import { CardActionsScope } from "../../zoneContext.js"
import { SurfaceCardTile } from "./SurfaceCardTile.js"
import { TablerDots } from "../../leaf/Icon/tabler.js"
import {
    getSurfaceCardClassName,
    surfaceActionsClassName,
    surfaceClassName,
    surfaceContentClassName,
    surfaceFactClassName,
    surfaceLabelClassName,
    surfaceNoteClassName,
    type SurfaceCardMeasure,
} from "./classNames.js"

export type {
    AvatarData, BadgeData, CardHead, Figure, ImageData, ItemAction, ItemLeading, ItemMenu, ListRowData, TileData, TileGroundTone, TileMark, TilePoster, WholeCardAction,
} from "../../surfaceCardData.js"

/** A group inside a labelled section: named by a Sublabel 8px above the card, never by a second Label; `sublabel` and `label` are never given together. */
type Sublabelled = { readonly sublabel: string; readonly label?: undefined; readonly ariaLabel?: string }
type OptionallyNamed = { readonly label?: string; readonly ariaLabel?: string; readonly sublabel?: undefined } | Sublabelled

type Head = Omit<CardHead, "label" | "ariaLabel">

/** The tone of a card's edge: every Grammar tone, each with its standard `--<tone>-border` token (the one tone-edge rule, `toneEdge.ts`). */
export type SurfaceCardTone = ToneEdge

/** What every card has: a note under it, a skeleton state, a presentation state, a height and a measure. */
type Shell = {
    /** A note under the card: a small muted line, full width. */
    readonly note?: ReactNode
    /**
     * The first read has no data yet (knowledge STATE-8): the card keeps its ready geometry, drawn from the content it was
     * given, with the label kept. A refresh that has data is not loading. A card inside a loading region follows the region.
     */
    readonly isLoading?: boolean
    /** The read failed: the card keeps its label and draws this in place of its content. Loading comes first, then error. */
    readonly error?: ErrorData
    /** How the subject is doing; paints nothing new, exposes `data-grammar-state` for the family. */
    readonly state?: PresentationState
    /** Let a peer grid stretch the complete card (a card that fills the height its host gives it). */
    readonly height?: "fill"
    /**
     * A card that waits on the reader draws its 1px edge in the tone's standard border token (`--<tone>-border`, 0.55.0: "card chờ duyệt có viền
     * vàng" is `tone="warning"`). Only the edge takes the tone; the fill stays the surface. Say why in words too (a status, a needs-you line).
     */
    readonly tone?: SurfaceCardTone
    /**
     * Grammar-owned width contract. `content` (default): the card fills its host. `narrow`: capped at 30rem, left-aligned (an order
     * card in a chat bubble). `formCompact`: the centred form measure of the one form that has no page around it (sign-in).
     */
    readonly measure?: SurfaceCardMeasure
}

/**
 * An object whose face is free content (a message, an approval, a receipt, a plan): its own facts, copy and controls, inset by the
 * card padding.
 */
type BodyCard = Shell & OptionallyNamed & Head & {
    readonly kind?: "body"
    readonly children: ReactNode
    /**
     * `accent`: the one card a set of peers recommends or the reader has chosen (the popular plan, the chosen path), drawn with a 1px
     * accent edge and the 3px accent ring; the reason stays in words beside it (a badge). Absent: the plain edge.
     */
    readonly emphasis?: "accent"
    /** The whole card is one destination or command; the card then holds no control of its own. */
    readonly wholeAction?: WholeCardAction
    /** The card's ⋯ actions, with or without a `wholeAction`: the trigger stands at the top end above the whole-card link and is its own tab stop. */
    readonly menu?: ItemMenu
    /**
     * The one band of commands at the foot of the object (approve and decline, reconnect, choose): under a `--separator` hairline,
     * padded by the row step and the card's inline padding. It holds buttons and links; `Tabs`, `SearchField` and `Divider` are refused there.
     */
    readonly actions?: ReactNode
}

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

export type SurfaceCardProps = BodyCard | TileCard

/**
 * The one card: ONE object with its own face (a customer, an agent, a provider, a plan, a message, an approval), never a collection.
 * A list is `Section kind="list"`, a table is a flat `DataTable` under its `Section`, a strip of figures is `Section kind="figures"`, facts
 * are a `DescriptionList` and a choice is a `RadioGroup` or `CheckboxGroup`: none of them is a card. Two kinds: `tile` (the mark or
 * media, the name, facts, one action and a menu) and `body` (the default: free content, with an optional foot band of `actions`).
 *
 * A card that heads a group has a `label`, drawn outside the material as an unpainted row above it; a tile has its `name` and mark or
 * media drawn inside. Every card is white with a 1px `--border` edge, the card radius and no shadow, on every ground. A card never
 * stands inside another card (development throws).
 */
export const SurfaceCard = (props: SurfaceCardProps) => {
    const host = useSurfaceHost()
    assertNoSurfaceInSurface(host)
    const kind = props.kind ?? "body"
    const headingId = useId()
    const state = props.state ?? "neutral"
    assertPresentationState(state)
    const stateTreatment = treatmentFor(state)
    const isLoading = useIsLoading(props.isLoading)
    const height = props.height ?? (props.kind === "tile" ? "fill" : "auto")
    const disabled = isLoading || state === "unavailable" || state === "pending"
    const isTile = props.kind === "tile"
    const body = props.kind === "tile" ? undefined : props
    const labelled = body?.label
    const sublabel = body?.sublabel
    const accessibleName = isTile ? props.name : props.ariaLabel ?? props.label ?? sublabel
    const headingLevel = props.headingLevel ?? DEFAULT_SURFACE_HEADING_LEVEL
    const measure: SurfaceCardMeasure = props.measure ?? "content"
    const emphasis = body?.emphasis
    const wholeAction = isTile ? props.wholeAction : body?.wholeAction
    const actions = body?.actions
    const hasNamedHeading = labelled !== undefined

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
    const face = props.kind === "tile"
        ? <SurfaceCardTile data={props} headingId={headingId} headingLevel={headingLevel} isLoading={isLoading} isDisabled={disabled} />
        : <LoadingScope isLoading={isLoading}>{props.children}</LoadingScope>

    const surface = (
        <Card.Content
            aria-label={labelled === undefined && !isTile ? accessibleName : undefined}
            aria-labelledby={labelled !== undefined || isTile ? headingId : undefined}
            aria-busy={isLoading || undefined}
            data-grammar-loading-region={isLoading ? "true" : undefined}
            className={surfaceClassName}
            data-contract={contentContract}
            data-grammar-frame="bounded"
            data-grammar-surface-kind={kind}
            data-grammar-surface-height={height}
            data-grammar-state={state}
            data-grammar-treatment={stateTreatment.tone}
            data-grammar-surface-emphasis={emphasis}
            {...toneEdgeProps(props.tone)}
            data-grammar-surface-ground={props.kind === "tile" ? props.groundTone : undefined}
            data-grammar-surface-bleed={props.kind === "tile" && props.poster?.bleed === true ? "true" : undefined}
        >
            <VerticalScrollRegionPart
                className={surfaceContentClassName}
                data-contract="PADDING-4"
                data-grammar-surface-content="true"
                isScrollable={false}
            >
                {failure === undefined ? face : <ErrorView error={failure} />}
            </VerticalScrollRegionPart>
            {actions === undefined || failure !== undefined ? null : (
                <div className={surfaceActionsClassName} data-grammar-surface-actions="true" data-contract="GAP-2">
                    <LoadingScope isLoading={isLoading}><CardActionsScope>{actions}</CardActionsScope></LoadingScope>
                </div>
            )}
            {action}
            {body?.menu === undefined ? null : (
                <span className="starci-core-body-menu" data-grammar-body-menu="true">
                    {isLoading || disabled ? (
                        <IconButton label={body.menu.label} source={TablerDots} size="sm" variant="border" isLoading={isLoading} isDisabled={disabled} />
                    ) : (
                        <DropdownMenu
                            placement="bottom end"
                            entries={body.menu.entries}
                            trigger={<IconButton label={body.menu.label} source={TablerDots} size="sm" variant="border" />}
                        />
                    )}
                </span>
            )}
        </Card.Content>
    )

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
            data-grammar-surface-emphasis={emphasis}
            data-component="SurfaceCard"
            data-tier="frame"
            render={(cardProps) => <section {...cardProps} />}
            variant="transparent"
        >
            {sublabel === undefined ? null : <Sublabel>{sublabel}</Sublabel>}
            {body === undefined || labelled === undefined ? null : (
                <Card.Header className={surfaceLabelClassName} data-contract="GAP-2" data-grammar-surface-label="true" data-grammar-label-end={body.labelEnd === undefined ? "false" : "true"}>
                    <AgentName isAgent={body.isAgent === true} {...(body.agentLabel === undefined ? {} : { agentLabel: body.agentLabel })} name={<Label as={`h${headingLevel}`} id={headingId}>{labelled}</Label>} />
                    {body.fact === undefined ? null : <span className={surfaceFactClassName} data-contract="TONE-2 FONT-2">{body.fact}</span>}
                    {body.labelEnd === undefined ? null : <span className="starci-core-surface-label-end">{body.labelEnd}</span>}
                </Card.Header>
            )}
            {surface}
            {props.note === undefined ? null : <div className={surfaceNoteClassName} data-grammar-surface-note="true">{props.note}</div>}
        </Card.Root>
    )
    return <SurfaceNesting host="card">{content}</SurfaceNesting>
}
