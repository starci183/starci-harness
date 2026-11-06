"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * Who draws the one line under a tab strip. `own`: the strip draws `--separator` itself (a standalone strip). `host`: the host's
 * divider IS the line (a card zone's divider, the page header band's bottom border) and the strip draws none; the selected
 * indicator overlaps that divider on the same bottom edge.
 */
export type TabsLine = "own" | "host"

const TabsLineContext = createContext<TabsLine>("own")

/** Tells the tab strips inside that their host draws the line under them; an internal host mode: `Tabs` has no `line` prop, so no page and no child of a zone can override it. */
export const TabsLineHost = ({ children }: { readonly children: ReactNode }) => (
    <TabsLineContext.Provider value="host">{children}</TabsLineContext.Provider>
)

/** The line owner a `Tabs` takes from its host. */
export const useTabsLineDefault = (): TabsLine => useContext(TabsLineContext)

const CustomZoneContext = createContext(false)

/** Marks the content of a `custom` card zone, which holds none of the parts the typed zones draw. */
export const CustomZoneScope = ({ children }: { readonly children: ReactNode }) => (
    <CustomZoneContext.Provider value>{children}</CustomZoneContext.Provider>
)

/**
 * The refusal of a part that has a typed zone (development only, like the surface refusals): a `custom` zone of a card may not
 * hold `Tabs`, `SearchField` or a `Divider`. Filter and search are the `filter`, `search` and `toolbar` zones; the card draws its own seams.
 */
export const useRefuseInCustomZone = (part: "Tabs" | "SearchField" | "Divider"): void => {
    const inCustomZone = useContext(CustomZoneContext)
    if (!inCustomZone || process.env.NODE_ENV === "production") return
    const typed = part === "Divider"
        ? "the card draws its own seams between zones and the body"
        : part === "Tabs" ? "use a `filter` or `toolbar` zone" : "use a `search` or `toolbar` zone"
    throw new Error(`${part} stands in a custom card zone: ${typed}.`)
}
