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

/** Internal to the composition tier: not exported from the public entries. */
export const PaneContext = createContext<PaneContextValue | undefined>(undefined)

export const usePaneContext = (): PaneContextValue | undefined => useContext(PaneContext)
