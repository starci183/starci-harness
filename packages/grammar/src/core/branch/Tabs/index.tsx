"use client"

import { Tabs as HeroTabs } from "@heroui/react"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { HorizontalScrollFrame } from "../../HorizontalScrollFrame.js"
import { useSurfaceNesting } from "../../surfaceContext.js"
import {
    tabContentClassName,
    tabLabelClassName,
    tabsClassName,
    tabsFrameClassName,
} from "./classNames.js"

/** One stable peer destination rendered by the Core tab object. */
export type TabItem = {
    readonly id: string
    readonly label: string
    readonly leading?: ReactNode
}

/**
 * Business-neutral controlled peer tabs with the shared horizontal frame owning overflow,
 * scroll shadows and the directional controls.
 */
export type TabsProps = {
    readonly label: string
    readonly selectedKey: string
    readonly items: ReadonlyArray<TabItem>
    readonly onSelect?: (key: string) => void
    readonly panelId?: (key: string) => string
    /** Keep stable labels visible when icon-only navigation would make peer views ambiguous. A tab with no `leading` icon always shows its label (0.9.11): it has nothing else to show. */
    readonly labelVisibility?: "responsive" | "always"
    /** Page chrome owns whether the peer strip starts at the shared page inset. */
    readonly inset?: "page" | "none"
    /**
     * `primary` is the underline tab bar: the page's main area switcher, at most one per page.
     * `secondary` is HeroUI's own pill tabs, unpainted by the grammar (a soft track, the selected tab a white segment
     * pill with the surface shadow): for tabs inside a sub-region (drawer, card, dialog, rail). Same roles, keyboard, panel
     * wiring and focus ring either way. Omit it to follow the surrounding surface (`secondary` inside,
     * `primary` on the page background).
     */
    readonly variant?: "primary" | "secondary"
    /** Accessible name of the previous-tabs scroll caret. HeroUI hardcodes English; pass the localized text. Defaults to "Scroll tabs left". */
    readonly scrollPreviousLabel?: string
    /** Accessible name of the next-tabs scroll caret. Defaults to "Scroll tabs right". */
    readonly scrollNextLabel?: string
}

/** Render peer tabs through Core's selected, accessible and responsive treatment. */
export const Tabs = (props: TabsProps) => {
    const nested = useSurfaceNesting()
    const [isClientReady, setIsClientReady] = useState(false)
    const frameRef = useRef<HTMLDivElement>(null)
    useEffect(() => setIsClientReady(true), [])
    useLayoutEffect(() => {
        const frame = frameRef.current
        const panelId = props.panelId
        if (!isClientReady || frame === null || panelId === undefined) return

        // HeroUI's collection may mount or update after this layout effect. Observe
        // only the owned relationship, preserving the actual vendor value for cleanup.
        const relationships = new Map<HTMLElement, { original: string | null; applied: string }>()
        const syncPanelIds = () => {
            frame.querySelectorAll<HTMLElement>("[data-grammar-tab-id]").forEach((identity) => {
                const itemId = identity.dataset.grammarTabId
                const tab = identity.closest<HTMLElement>("[role='tab']")
                if (itemId === undefined || tab === null) return
                const current = tab.getAttribute("aria-controls")
                const previous = relationships.get(tab)
                const expected = panelId(itemId)
                const original = previous !== undefined && current === previous.applied ? previous.original : current
                relationships.set(tab, { original, applied: expected })
                if (current !== expected) tab.setAttribute("aria-controls", expected)
            })
        }
        const observer = new MutationObserver(syncPanelIds)
        observer.observe(frame, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-controls", "data-grammar-tab-id"] })
        syncPanelIds()
        return () => {
            observer.disconnect()
            relationships.forEach(({ original, applied }, tab) => {
                if (tab.getAttribute("aria-controls") !== applied) return
                if (original === null) tab.removeAttribute("aria-controls")
                else tab.setAttribute("aria-controls", original)
            })
        }
    }, [isClientReady, props.items, props.panelId, props.selectedKey])

    const scrollPreviousLabel = props.scrollPreviousLabel ?? "Scroll tabs left"
    const scrollNextLabel = props.scrollNextLabel ?? "Scroll tabs right"

    const inset = props.inset ?? "none"
    const variant = props.variant ?? (nested ? "secondary" : "primary")
    // STATE-6 names the page underline "primary" and the nested pill "secondary".
    // HeroUI names those looks secondary and primary respectively.
    const vendorVariant = variant === "secondary" ? "primary" : "secondary"
    const frameContract = inset === "page" ? "PADDING-5" : undefined
    if (!isClientReady) return <div aria-hidden="true" className={tabsFrameClassName} data-contract={frameContract} data-component="Tabs" data-tier="branch" data-grammar-tabs="true" data-grammar-tabs-client="pending" data-grammar-tabs-inset={inset} data-grammar-tabs-variant={variant} style={{ minHeight: "3rem" }} />

    return <div ref={frameRef} className={tabsFrameClassName} data-contract={frameContract} data-component="Tabs" data-tier="branch" data-grammar-tabs="true" data-grammar-tabs-client="ready" data-grammar-tabs-inset={inset} data-grammar-tabs-variant={variant} data-grammar-tab-labels={props.labelVisibility ?? "responsive"}>
        <HeroTabs
            variant={vendorVariant}
            selectedKey={props.selectedKey}
            onSelectionChange={(key) => props.onSelect?.(String(key))}
            className={tabsClassName ?? ""}
            data-contract="FLOW-2"
        >
            <HeroTabs.List aria-label={props.label} render={({ children, ref, ...listProps }) => (
                <HorizontalScrollFrame appearance="tabs" hideScrollBar size={64} scrollPreviousLabel={scrollPreviousLabel} scrollNextLabel={scrollNextLabel}>
                    <div {...listProps} ref={ref}>{children}</div>
                </HorizontalScrollFrame>
            )}>
                {props.items.map((item) => (
                    <HeroTabs.Tab
                        key={item.id}
                        id={item.id}
                        aria-label={item.label}
                        data-contract="PADDING-3"
                    >
                        <span className={tabContentClassName} data-contract="GAP-2" data-grammar-tab-id={item.id}>
                            {item.leading}
                            <span className={tabLabelClassName} style={props.labelVisibility === "always" || item.leading == null ? { display: "inline" } : undefined}>{item.label}</span>
                        </span>
                        <HeroTabs.Indicator />
                    </HeroTabs.Tab>
                ))}
            </HeroTabs.List>
        </HeroTabs>
    </div>
}
