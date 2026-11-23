"use client"

import { cn, skeletonVariants } from "@heroui/react"
import type { ReactNode } from "react"
import { Icon, type IconSource } from "../Icon/index.js"
import type { NoChildren } from "../../tier.js"
import type { CustomTone } from "../../../common/tones.js"
import { useCustomTone } from "../../useCustomTone.js"
import { MARK_STATE_TONE, StatusGlyph, StatusTile, type MarkState } from "../../statusMark.js"
import { isToneSlot, toneSlotStyle, type ToneSlot } from "../../toneSlot.js"

export type IconTileBuiltInTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"
/** HeroUI's palette tones, and any tone the app declared in `GrammarToneRegistry`. */
export type IconTileTone = IconTileBuiltInTone | CustomTone
const BUILT_IN_TONES: readonly string[] = ["neutral", "accent", "info", "success", "warning", "danger"]
/** `slot` is the attribute of a `ToneSlot`: never an app-declared tone name. */
const SLOT_AND_BUILT_IN_TONES: readonly string[] = [...BUILT_IN_TONES, "slot"]

type IconTileShared = NoChildren & {
    /** Optional app-owned artwork replaces the fallback glyph without changing plate geometry. */
    readonly artwork?: ReactNode
    readonly ariaLabel?: string
    /** A named tone, or a `ToneSlot` (`{ soft, ink }`, 0.55.1): the glyph on the app's own soft pair (`data-tone="slot"`); its contrast is the app's. */
    readonly tone?: IconTileTone | ToneSlot
    readonly isLoading?: boolean
    /**
     * The tile by the place it leads (the icon table, ramps.css): `row` (default) the 40 tile, radius 10, with a 20 glyph, leading a list row (a run,
     * a document); `head` the 48 tile, radius 12, with a 24 glyph, leading a page head or an empty state. A status mark is always the round 40.
     */
    readonly size?: IconTileSize
}

/** The two tiles of the icon table. */
export type IconTileSize = "row" | "head"

/** An identity tile: the app's glyph on the tone's soft plate (an agent, a feature, a graph node's kind). */
type IconTileIdentity = IconTileShared & {
    /** Fallback glyph selected by the app's semantic icon map. */
    readonly source: IconSource
    readonly state?: never
}

/**
 * (B) A status mark (0.55.0): the round 40px tile whose PLATE TONE is the state (`MARK_STATE_TONE`: done success, running info with a spinning
 * ring, waiting warning, error danger, skipped and notRun neutral); `tone` is ignored.
 * - With `source` (case 2, "which thing is which?"): the glyph is the SUBJECT the app passes in (the workflow, step or channel icon); the status
 *   trails beside it as an inline status (`InlineStatus`), a small glyph plus a word.
 * - Without `source` (case 1, "how far along is it?", or a mark with no subject of its own): the tile carries the STATUS glyph (the bare three: check,
 *   x, a small ring for waiting, skipped or not run; the ring spins while running); the step's name carries the subject and time or meta trails, never a status word.
 */
type IconTileStatus = IconTileShared & {
    readonly state: MarkState
    readonly source?: IconSource
}

export type IconTileProps = IconTileIdentity | IconTileStatus

/*
 * Plate size, corner and tone pair are SHIPPED by `.starci-core-icon-tile` in
 * `src/common/styles.css`, selected by the `data-size`, `data-tone`, `data-artwork` and
 * `data-loading` attributes this element already emits. The corner comes from the theme radius
 * ramp (`--radius-lg` / `--radius-xl`), not from a HeroUI v2 radius name.
 */

const SKELETON_CLASS_NAME = skeletonVariants({ animationType: "shimmer" }).base()

/**
 * surface.md Catalog / tone.md Scale: only these tone classes have a published rule for their exact
 * pairing. `bg-default` (neutral) and the warning/danger soft pairs are not catalogued, so they are
 * left unclaimed.
 */
const TONE_CONTRACT: Partial<Record<IconTileBuiltInTone, string>> = {
    neutral: "TONE-2",
    accent: "SURFACE-4",
    success: "SURFACE-5",
}

/**
 * Soft-tone icon tile: an outline icon on a `row` (40, radius 10) or `head` (48, radius 12) plate (the icon table, owner 2026-11-23), with its tone pair and loading geometry.
 * With `state` it is the status mark (B) of the status-mark rule, contexts/ui/components/identity-mark.md.
 */
export const IconTile = (props: IconTileProps) => {
    if (props.state !== undefined && props.isLoading !== true && props.artwork == null) {
        const { state, source, ariaLabel } = props
        return (
            <StatusTile tone={MARK_STATE_TONE[state]} state={state} hasSubject={source !== undefined} label={ariaLabel}>
                {source === undefined ? <StatusGlyph kind={state} /> : <Icon source={source} usage="row" />}
            </StatusTile>
        )
    }
    return <IdentityTile {...props} />
}

const IdentityTile = ({
    source,
    artwork,
    ariaLabel,
    tone: ownTone = "neutral",
    isLoading = false,
    state,
    size = "row",
}: IconTileProps) => {
    // a loading status mark keeps the 40px plate in the state's tone; its glyph is not drawn
    const slot = state === undefined && isToneSlot(ownTone) ? ownTone : undefined
    const tone: string = state !== undefined ? MARK_STATE_TONE[state] : slot !== undefined ? "slot" : (ownTone as IconTileTone)
    const showsArtwork = !isLoading && artwork != null
    const custom = useCustomTone(tone, SLOT_AND_BUILT_IN_TONES)
    const toneRule = isLoading || showsArtwork ? undefined : (TONE_CONTRACT as Record<string, string | undefined>)[tone]
    return (
        <span
            ref={custom.ref}
            {...custom.attrs}
            {...(slot === undefined ? {} : { style: toneSlotStyle(slot) })}
            data-tier="leaf"
            data-component="IconTile"
            data-tone={tone}
            data-size={state === undefined ? size : "row"}
            data-artwork={showsArtwork ? "true" : "false"}
            data-loading={isLoading ? "true" : "false"}
            aria-hidden={isLoading || undefined}
            data-contract={["OVERFLOW-2", toneRule].filter(Boolean).join(" ")}
            className={cn("starci-core-icon-tile", isLoading ? SKELETON_CLASS_NAME : undefined)}
        >
            {isLoading ? null : showsArtwork ? artwork : source === undefined ? null : (
                <Icon source={source} usage={size === "head" ? "head" : "row"} {...(ariaLabel === undefined ? {} : { ariaLabel })} />
            )}
        </span>
    )
}
