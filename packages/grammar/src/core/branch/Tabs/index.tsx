"use client"

import { useIsLoading, withRegionInert } from "../../regionScope.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { Tabs as HeroTabs } from "@heroui/react"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { PlainPressable } from "../../PlainPressable.js"
import { visibleOptionIndexes } from "../../fitIndexes.js"
import { DropdownMenu } from "../DropdownMenu/index.js"
import { HorizontalScrollFrame } from "../../HorizontalScrollFrame.js"
import {
    tabContentClassName,
    tabLabelClassName,
    tabsClassName,
    tabsFrameClassName,
} from "./classNames.js"
import type { NoChildren } from "../../tier.js"
import { useRefuseInCustomZone, useTabsLineDefault } from "../../zoneContext.js"

/** One stable peer destination rendered by the Core tab object. */
export type TabItem = {
    readonly id: string
    readonly label: string
    readonly leading?: ReactNode
    /** How many items the view holds, after the label. `0` stays visible; leave it out while the count is unknown. */
    readonly count?: number
    /** The view holds something that waits for the reader (to approve, to answer): its count reads in the danger tone. */
    readonly isAttention?: boolean
    /** Whether this tab is unavailable for selection or link navigation. */
    readonly isDisabled?: boolean
    /**
     * The route this tab opens. A tab with `href` is a link tab: it renders an anchor, navigates through the
     * `GrammarRoot` router (`navigate`, `useHref`) or the browser, and needs no `onSelect`, so a server page can pass
     * its page tabs as plain data. The selected link tab follows the current path unless `selectedKey` is given.
     */
    readonly href?: string
}

/**
 * Which component switches what: `Tabs` switch the views or periods of one block, or filter its list (in a card, the `filter` or
 * `toolbar` header zone); `ChoiceChips` or `RadioGroup` choose a form value; a `Button` holds a command, never a selection state.
 * Two joined buttons or pills acting as tabs are banned (R380, `no-button-view-switch`).
 *
 * Business-neutral peer tabs with the shared horizontal frame owning overflow, scroll shadows and the directional
 * controls. Controlled tabs pass `selectedKey` and `onSelect`; link tabs pass an `href` on every item and the selected
 * tab is the one whose `href` matches the current path (the exact path, else the longest `href` the path lies under).
 */
export type TabsProps = NoChildren & {
    readonly label: string
    /**
     * What the tabs do. `views` (default): they switch between views of a page, in the page head. `filter`: they narrow one list
     * that stays in place, inside the list pane under its search field: the same underline one size smaller (13px, tighter), each
     * with its `count`; the tabs that do not fit fold into a "+n" menu and the selected one always stays visible. A tablist is not a
     * form field: choosing a value of a form is `ChoiceChips` or `RadioGroup`.
     */
    readonly kind?: "views" | "filter"
    /** The accessible name of the menu that holds the folded tabs, e.g. `(count) => \`${count} more filters\``. */
    readonly moreLabel?: (count: number) => string
    /**
     * The word the fold menu draws instead of "+n" (the app's own, e.g. "More"); the menu stays named by `moreLabel`, which
     * still says how many tabs it holds, so assistive technology hears the count the word does not show. On `views` tabs, giving it
     * makes the tabs that do not fit fold into that menu (the selected one stays visible) instead of scrolling.
     */
    readonly overflowLabel?: string
    /** The selected tab. Required for controlled tabs; link tabs derive it from the current path when it is omitted. */
    readonly selectedKey?: string
    readonly items: ReadonlyArray<TabItem>
    readonly onSelect?: (key: string) => void
    /**
     * The panel each tab controls (`aria-controls`): a function from the tab key to the id of its panel, or one id when a single
     * panel is swapped by every tab (page tabs control the page body). A string crosses a server boundary; a function does not.
     */
    readonly panelId?: string | ((key: string) => string)
    /** Keep stable labels visible when icon-only navigation would make peer views ambiguous. A tab with no `leading` icon always shows its label (0.9.11): it has nothing else to show. */
    readonly labelVisibility?: "responsive" | "always"
    /** Page chrome owns whether the peer strip starts at the shared page inset. */
    readonly inset?: "page" | "none"
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
const TabsInner = (props: TabsProps) => {
    const [isClientReady, setIsClientReady] = useState(false)
    const frameRef = useRef<HTMLDivElement>(null)
    useRefuseInCustomZone("Tabs")
    // The line owner is the host's, never a prop: a card zone and the page header band wrap their strip in `TabsLineHost` (draws no line of its own, the indicator overlaps the host's divider); a standalone strip draws `--separator` itself.
    const hostLine = useTabsLineDefault()
    const line = hostLine
    // A loading region keeps the labels real (static chrome) and draws each count as the geometry of its ready box; the region makes the tabs inert.
    const isLoading = useIsLoading(undefined)
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
                const expected = typeof panelId === "string" ? panelId : panelId(itemId)
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
    const kind = props.kind ?? "views"
    const isFilter = kind === "filter"
    // Filter tabs always fold what does not fit; page (views) tabs fold only when the app names the fold menu (`overflowLabel`), else they scroll.
    const folds = isFilter || props.overflowLabel !== undefined
    const frameContract = inset === "page" ? "PADDING-5" : undefined
    const frameData = { "data-component": "Tabs", "data-tier": "branch", "data-grammar-tabs": "true", "data-grammar-tabs-inset": inset, "data-grammar-tabs-variant": "primary", "data-grammar-tabs-kind": kind, "data-grammar-tabs-line": line, "data-grammar-tabs-folds": folds ? "true" : "false" } as const

    // `filter`: the tabs that do not fit fold into a "+n" menu. All tabs draw once to be measured (the widths are kept), then
    // the fit is recomputed from those widths whenever the frame resizes; the selected tab is always one of the shown.
    const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set())
    const [fittedFor, setFittedFor] = useState("")
    const [, setMeasureTick] = useState(0)
    const widths = useRef<ReadonlyArray<number>>([])
    const gap = useRef(0)
    const fitSignature = folds ? props.items.map((item) => `${item.id}|${item.label}|${item.count ?? ""}`).join("\u0000") : ""
    const renderAll = folds && fittedFor !== fitSignature
    const selectedIndex = props.items.findIndex((item) => item.id === selectedKey)
    const MORE_WIDTH = 64
    const fit = () => {
        const frame = frameRef.current
        if (frame === null || widths.current.length !== props.items.length) return
        const shown = visibleOptionIndexes(widths.current, selectedIndex, Math.floor(frame.getBoundingClientRect().width), MORE_WIDTH, gap.current)
        const next = new Set(props.items.filter((_, index) => !shown.includes(index)).map((item) => item.id))
        setHiddenIds((previous) => previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next)
    }
    useLayoutEffect(() => {
        const frame = frameRef.current
        if (!folds || !isClientReady || frame === null || !renderAll) return undefined
        const tabs = Array.from(frame.querySelectorAll<HTMLElement>("[role='tab']"))
        // The vendor collection mounts its tabs after the first commit: measure only once every tab is there.
        if (tabs.length !== props.items.length) {
            const observer = new MutationObserver(() => setMeasureTick((tick) => tick + 1))
            observer.observe(frame, { childList: true, subtree: true })
            return () => observer.disconnect()
        }
        // The tabs' own gap (the list's computed column gap) is what separates two of them: measure it, never assume one.
        const list = tabs[0]?.parentElement
        gap.current = list == null ? 0 : Number.parseFloat(getComputedStyle(list).columnGap) || 0
        widths.current = tabs.map((tab) => Math.ceil(tab.getBoundingClientRect().width))
        setFittedFor(fitSignature)
        fit()
        return undefined
    })
    useLayoutEffect(() => { if (folds && !renderAll) fit() }, [selectedIndex, fittedFor])
    useEffect(() => {
        const frame = frameRef.current
        if (!folds || frame === null || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(() => { if (!renderAll) fit() })
        observer.observe(frame)
        return () => observer.disconnect()
    })
    const shownItems = !folds || renderAll ? props.items : props.items.filter((item) => !hiddenIds.has(item.id))
    const foldedItems = !folds || renderAll ? [] : props.items.filter((item) => hiddenIds.has(item.id))
    const labelOf = (item: TabItem) => item.count === undefined || isLoading ? item.label : `${item.label} ${item.count}`

    if (!isClientReady) return <div aria-hidden="true" className={tabsFrameClassName} data-contract={frameContract} {...frameData} data-grammar-tabs-client="pending" />

    const tabs = shownItems.map((item) => (
        <HeroTabs.Tab
            key={item.id}
            id={item.id}
            isDisabled={item.isDisabled ?? false}
            {...(item.href === undefined ? {} : { href: item.href })}
            aria-label={labelOf(item)}
            data-contract="PADDING-3"
        >
            <span className={tabContentClassName} data-contract="GAP-2" data-grammar-tab-id={item.id}>
                {item.leading}
                <span className={tabLabelClassName} style={props.labelVisibility === "always" || item.leading == null ? { display: "inline" } : undefined}>{item.label}</span>
                {item.count === undefined ? null : <span className="starci-core-tab-count" data-grammar-tab-count="true" {...(item.isAttention === true ? { "data-grammar-attention": "true" } : {})}>{isLoading ? <SkeletonPlaceholder>{item.count}</SkeletonPlaceholder> : item.count}</span>}
            </span>
            <HeroTabs.Indicator />
        </HeroTabs.Tab>
    ))

    return <div ref={frameRef} className={tabsFrameClassName} data-contract={frameContract} {...frameData} data-grammar-tabs-client="ready" data-grammar-tab-labels={props.labelVisibility ?? "responsive"} {...(renderAll ? { "data-grammar-tabs-measuring-fit": "true" } : {})}>
        <HeroTabs
            variant="secondary"
            {...(selectedKey === undefined ? {} : { selectedKey })}
            onSelectionChange={(key) => select(String(key))}
            className={tabsClassName ?? ""}
            data-contract="FLOW-2"
        >
            <HeroTabs.List aria-label={props.label} render={({ children, ref, ...listProps }) => folds ? (
                <div {...listProps} ref={ref} style={listProps.style}>{children}</div>
            ) : (
                <HorizontalScrollFrame appearance="tabs" hideScrollBar size={64} scrollPreviousLabel={scrollPreviousLabel} scrollNextLabel={scrollNextLabel}>
                    <div {...listProps} ref={ref} style={listProps.style}>{children}</div>
                </HorizontalScrollFrame>
            )}>
                {tabs}
            </HeroTabs.List>
        </HeroTabs>
        {foldedItems.length === 0 ? null : (
            <span className="starci-core-tabs-more">
                <DropdownMenu
                    placement="bottom end"
                    entries={[{ kind: "section", id: "folded-tabs", items: foldedItems.map((item) => ({ id: item.id, label: labelOf(item), onAction: () => select(item.id) })) }]}
                    trigger={<PlainPressable aria-label={(props.moreLabel ?? ((count: number) => isFilter ? `${count} more filters` : `${count} more tabs`))(foldedItems.length)}><span className="starci-core-tabs-more-label">{props.overflowLabel ?? `+${foldedItems.length}`}<svg aria-hidden="true" viewBox="0 0 16 16" className="starci-core-tabs-more-caret"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span></PlainPressable>}
                />
            </span>
        )}
    </div>
}

/** Render peer tabs through Core's selected, accessible and responsive treatment. */
export const Tabs = withRegionInert(TabsInner)
