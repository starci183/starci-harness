"use client"

import type { ReactNode } from "react"
import { Button } from "../../leaf/Button/index.js"
import { useIsLoading } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"
import { SurfaceCard } from "../SurfaceCard/index.js"

/** One side of a conflict: what is remembered now, or what is newly proposed. */
export type ConflictSide = {
    /** Which side it is, e.g. "Remembered now" or "New suggestion". */
    readonly label: string
    /** The sentence, in the owner's words. */
    readonly text: string
    /** Where it came from, e.g. "setup chat, 18 Nov". */
    readonly source?: string
}

/** One way to settle the conflict. */
export type ConflictChoice = {
    readonly label: string
    readonly press: () => void
    readonly isPending?: boolean
}

export type ConflictCardProps = NoChildren & {
    /** What clashes, as a plain question or statement, e.g. "Two notes disagree about discounts". */
    readonly title: string
    readonly current: ConflictSide
    readonly proposed: ConflictSide
    /** The ways to settle it (keep the old, use the new, keep both), as buttons in this order; none is the solid one: no choice is the right one by default. */
    readonly choices: readonly ConflictChoice[]
    /** A line under the card, e.g. what happens to the note that is not kept. */
    readonly note?: ReactNode
    readonly isLoading?: boolean
}

/**
 * FRAME - `ConflictCard`: two notes of an agent that disagree, side by side (what it remembers now, and what the owner just told it) with the ways to settle it at the foot. It is a
 * warning card (the reader decides; nothing is changed until they do) on `SurfaceCard`; below 30rem the two sides stack. The sides are read as two named groups, never colour alone.
 */
export const ConflictCard = ({ title, current, proposed, choices, note, isLoading: ownLoading }: ConflictCardProps) => {
    const isLoading = useIsLoading(ownLoading)
    const side = (one: ConflictSide, name: "current" | "proposed") => (
        <section className="starci-core-conflict-side" aria-label={one.label} data-grammar-conflict-side={name}>
            <span className="starci-core-conflict-side-label">{one.label}</span>
            <p className="starci-core-conflict-side-text">{one.text}</p>
            {one.source === undefined ? null : <span className="starci-core-conflict-side-source">{one.source}</span>}
        </section>
    )
    return (
        <div data-tier="frame" data-component="ConflictCard" data-contract="SURFACE-2" className="starci-core-conflict-card">
            <SurfaceCard
                label={title}
                tone="warning"
                isLoading={isLoading}
                {...(note === undefined ? {} : { note })}
                actions={<>{choices.map((choice) => <Button key={choice.label} variant="border" isPending={choice.isPending === true} onPress={choice.press}>{choice.label}</Button>)}</>}
            >
                <div className="starci-core-conflict-sides">
                    {side(current, "current")}
                    {side(proposed, "proposed")}
                </div>
            </SurfaceCard>
        </div>
    )
}
