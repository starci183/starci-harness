"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * Who draws the one line under a tab strip. `own`: the strip draws `--separator` itself (a standalone strip). `host`: the host's
 * divider IS the line (the page header band's bottom border) and the strip draws none; the selected
 * indicator overlaps that divider on the same bottom edge.
 */
export type TabsLine = "own" | "host"

const TabsLineContext = createContext<TabsLine>("own")

/** Tells the tab strips inside that their host draws the line under them; an internal host mode: `Tabs` has no `line` prop, so no page can override it. */
export const TabsLineHost = ({ children }: { readonly children: ReactNode }) => (
    <TabsLineContext.Provider value="host">{children}</TabsLineContext.Provider>
)

/** The line owner a `Tabs` takes from its host. */
export const useTabsLineDefault = (): TabsLine => useContext(TabsLineContext)

const CardActionsContext = createContext(false)

/** Marks the `actions` band at the foot of an object card, which holds commands only. */
export const CardActionsScope = ({ children }: { readonly children: ReactNode }) => (
    <CardActionsContext.Provider value>{children}</CardActionsContext.Provider>
)

/**
 * The refusal of a part that does not belong in a card's `actions` band (development only, like the surface refusals): the band holds
 * buttons and links. Tabs and a search narrow a collection, and a collection stands in a `Section` (its `filter`), never in a card; the
 * card draws the hairline above the band itself.
 */
export const useRefuseInCardActions = (part: "Tabs" | "SearchField" | "Divider"): void => {
    const inActions = useContext(CardActionsContext)
    if (!inActions || process.env.NODE_ENV === "production") return
    const where = part === "Divider" ? "the card draws the hairline above its actions" : "it narrows a collection: give it to the Section's `filter`"
    throw new Error(`${part} stands in a card's actions band: ${where}.`)
}
