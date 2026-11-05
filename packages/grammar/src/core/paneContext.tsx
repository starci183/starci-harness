"use client"

import { createContext, useContext } from "react"

/** What a Pane gives its descendants: `content` publishes the Grammar pane inset to its PaneSections, `flush` publishes none. */
export type PaneInset = "content" | "flush"

export type PaneContextValue = {
    readonly area: string
    readonly inset: PaneInset
    /** A PaneSection or nested PaneGrid announces itself on mount; the returned function withdraws it. */
    readonly register: () => () => void
}

/** Internal to the frame tier: not exported from the public entries. */
export const PaneContext = createContext<PaneContextValue | undefined>(undefined)

/**
 * What a PaneGrid gives a PaneHeader that opens one of its drawer panes (`trigger="head"`): the grid owns the open state, so the
 * page holds none. Internal to the frame and composite tiers: not exported from the public entries.
 */
export type PaneOpenerValue = {
    /** Whether `area` is a pane with `collapse="drawer" trigger="head"`. */
    readonly has: (area: string) => boolean
    readonly open: (area: string) => void
    /** The CSS display the opener takes at each breakpoint: shown where the pane's area is not arranged. */
    readonly displays: (area: string) => Readonly<Record<"base" | "medium" | "wide", "inline-flex" | "none">>
}

export const PaneOpenerContext = createContext<PaneOpenerValue | undefined>(undefined)

export const usePaneContext = (): PaneContextValue | undefined => useContext(PaneContext)
