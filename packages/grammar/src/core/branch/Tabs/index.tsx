"use client"

import { Tabs as HeroTabs } from "@heroui/react"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { HorizontalScrollFrame } from "../../HorizontalScrollFrame.js"
import { usePaneContext } from "../../paneContext.js"
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
    /**
     * The route this tab opens. A tab with `href` is a link tab: it renders an anchor, navigates through the
     * `GrammarRoot` router (`navigate`, `useHref`) or the browser, and needs no `onSelect`, so a server page can pass
     * its page tabs as plain data. The selected link tab follows the current path unless `selectedKey` is given.
     */
    readonly href?: string
}

/**
 * Business-neutral peer tabs with the shared horizontal frame owning overflow, scroll shadows and the directional
 * controls. Controlled tabs pass `selectedKey` and `onSelect`; link tabs pass an `href` on every item and the selected
 * tab is the one whose `href` matches the current path (the exact path, else the longest `href` the path lies under).
 */
export type TabsProps = {
    readonly label: string
    /** The selected tab. Required for controlled tabs; link tabs derive it from the current path when it is omitted. */
    readonly selectedKey?: string
    readonly items: ReadonlyArray<TabItem>
    readonly onSelect?: (key: string) => void
    readonly panelId?: (key: string) => string
    /** Keep stable labels visible when icon-only navigation would make peer views ambiguous. A tab with no `leading` icon always shows its label (0.9.11): it has nothing else to show. */
    readonly labelVisibility?: "responsive" | "always"
    /** Page chrome owns whether the peer strip starts at the shared page inset. */
    readonly inset?: "page" | "none"
    /**
     * `primary` (default) is the underline tab bar, on the page and inside a sub-region alike: the labels are text on
     * the content edge, the first label on the edge it shares with the title and the box below.
     * `secondary` is HeroUI's own pill tabs, unpainted by the grammar (a soft track, the selected tab a white segment
     * pill with the surface shadow). A pill is a filter's shape: a filter over a collection is a selectable `TagGroup`,
     * so a new screen never picks `secondary`. Same roles, keyboard, panel wiring and focus ring either way.
     */
    readonly variant?: "primary" | "secondary"
    /** Accessible name of the previous-tabs scroll caret. HeroUI hardcodes English; pass the localized text. Defaults to "Scroll tabs left". */
    readonly scrollPreviousLabel?: string
    /** Accessible name of the next-tabs scroll caret. Defaults to "Scroll tabs right". */
    readonly scrollNextLabel?: string
}

/** A path without its trailing slash, the root kept as `/`. */
const trimPath = (path: string): string => (path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path)

/**
 * The link tab the current path selects: the item whose `href` path is the current path, else the one with the
 * longest `href` path the current path lies under, else none.
 */
const tabKeyFromPath = (items: ReadonlyArray<TabItem>, pathname: string, base: string): string | undefined => {
    const current = trimPath(pathname)
    let best: { readonly id: string; readonly length: number } | undefined
    for (const item of items) {
        if (item.href === undefined) continue
        const path = trimPath(new URL(item.href, base).pathname)
        if (path === current) return item.id
        const under = path === "/" ? current.startsWith("/") : current.startsWith(`${path}/`)
        if (under && (best === undefined || path.length > best.length)) best = { id: item.id, length: path.length }
    }
    return best?.id
}

/** The current location's path, read on the client and kept current across history moves. */
const useLocationPath = (enabled: boolean): readonly [string | undefined, (path: string) => void] => {
    const [path, setPath] = useState<string | undefined>(undefined)
    useEffect(() => {
        if (!enabled) return
        const read = () => setPath(window.location.pathname)
        read()
        window.addEventListener("popstate", read)
        return () => window.removeEventListener("popstate", read)
    }, [enabled])
    return [path, setPath]
}

/** Render peer tabs through Core's selected, accessible and responsive treatment. */
export const Tabs = (props: TabsProps) => {
    const inPane = usePaneContext() !== undefined
    const [isClientReady, setIsClientReady] = useState(false)
    const frameRef = useRef<HTMLDivElement>(null)
    useEffect(() => setIsClientReady(true), [])
    const isLinkTabs = props.items.some((item) => item.href !== undefined)
    const [locationPath, setLocationPath] = useLocationPath(isLinkTabs && props.selectedKey === undefined)
    // A path no link tab owns falls back to the first tab, so link tabs stay controlled from their first render.
    const selectedKey = props.selectedKey
        ?? (isLinkTabs && locationPath !== undefined ? tabKeyFromPath(props.items, locationPath, window.location.href) ?? props.items[0]?.id : undefined)
    const select = (key: string) => {
        const href = props.items.find((item) => item.id === key)?.href
        // A link tab navigates on its own; selecting it ahead of the route change keeps the indicator on the press.
        if (href !== undefined && props.selectedKey === undefined) setLocationPath(new URL(href, window.location.href).pathname)
        props.onSelect?.(key)
    }
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
    }, [isClientReady, props.items, props.panelId, selectedKey])

    // The vendor indicator fills its tab and animates width. A label edit resizes the selected tab, so the
    // indicator follows at once: the frame disables that width transition for the commit that changed a label.
    const labelSignature = props.items.map((item) => `${item.id}|${item.label}`).join(", ")
    const previousSignature = useRef(labelSignature)
    useLayoutEffect(() => {
        const frame = frameRef.current
        if (previousSignature.current === labelSignature) return
        previousSignature.current = labelSignature
        if (frame === null) return
        frame.dataset.grammarTabsMeasuring = "true"
        const first = requestAnimationFrame(() => {
            requestAnimationFrame(() => { delete frame.dataset.grammarTabsMeasuring })
        })
        return () => { cancelAnimationFrame(first); delete frame.dataset.grammarTabsMeasuring }
    }, [labelSignature, isClientReady])

    const scrollPreviousLabel = props.scrollPreviousLabel ?? "Scroll tabs left"
    const scrollNextLabel = props.scrollNextLabel ?? "Scroll tabs right"

    const inset = props.inset ?? "none"
    const variant = props.variant ?? "primary"
    // STATE-6 names the page underline "primary" and the nested pill "secondary".
    // HeroUI names those looks secondary and primary respectively.
    const vendorVariant = variant === "secondary" ? "primary" : "secondary"
    const frameContract = inset === "page" ? "PADDING-5" : undefined
    if (!isClientReady) return <div aria-hidden="true" className={tabsFrameClassName} data-contract={frameContract} data-component="Tabs" data-tier="branch" data-grammar-tabs="true" data-grammar-tabs-client="pending" data-grammar-tabs-inset={inset} data-grammar-tabs-variant={variant} style={{ minHeight: "3rem" }} />

    return <div ref={frameRef} className={tabsFrameClassName} data-contract={frameContract} data-component="Tabs" data-tier="branch" data-grammar-tabs="true" data-grammar-tabs-client="ready" data-grammar-tabs-inset={inset} data-grammar-tabs-variant={variant} data-grammar-tab-labels={props.labelVisibility ?? "responsive"}>
        <HeroTabs
            variant={vendorVariant}
            {...(selectedKey === undefined ? {} : { selectedKey })}
            onSelectionChange={(key) => select(String(key))}
            className={tabsClassName ?? ""}
            data-contract="FLOW-2"
        >
            <HeroTabs.List aria-label={props.label} render={({ children, ref, ...listProps }) => (
                <HorizontalScrollFrame appearance="tabs" hideScrollBar size={64} scrollPreviousLabel={scrollPreviousLabel} scrollNextLabel={scrollNextLabel}>
                    <div {...listProps} ref={ref} style={variant === "secondary" && inPane ? { ...listProps.style, paddingInline: 0 } : listProps.style}>{children}</div>
                </HorizontalScrollFrame>
            )}>
                {props.items.map((item) => (
                    <HeroTabs.Tab
                        key={item.id}
                        id={item.id}
                        {...(item.href === undefined ? {} : { href: item.href })}
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
