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
    /**
     * How many items the view holds, drawn as a 12px chip after the label (0.36.0), never as "· N" text in the label (lint `tab-count-chip`). Neutral (grey)
     * for an ordinary quantity. Page tabs (layers 1 and 2) hide the chip when it is `0`; filter tabs inside a table or list show a grey `0`. Leave it out while
     * the count is unknown.
     */
    readonly count?: number
    /**
     * The count is work waiting for the owner (to handle, to approve, an error): its chip is pink (the accent soft pair). Only then; a plain quantity
     * ("All 5") stays neutral, selected or not (0.36.0).
     */
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
type TabsCommon = NoChildren & {
    readonly label: string
    /** The selected tab. Required for controlled tabs; link tabs derive it from the current path when it is omitted. */
    readonly selectedKey?: string
    readonly onSelect?: (key: string) => void
    /**
     * The panel each tab controls (`aria-controls`): a function from the tab key to the id of its panel, or one id when a single
     * panel is swapped by every tab (page tabs control the page body). A string crosses a server boundary; a function does not.
     */
    readonly panelId?: string | ((key: string) => string)
    /** Keep stable labels visible when icon-only navigation would make peer views ambiguous. A tab with no `leading` icon always shows its label (0.9.11): it has nothing else to show. */
    readonly labelVisibility?: "responsive" | "always"
    /** Accessible name of the previous-tabs scroll caret. HeroUI hardcodes English; pass the localized text. Defaults to "Scroll tabs left". */
    readonly scrollPreviousLabel?: string
    /** Accessible name of the next-tabs scroll caret. Defaults to "Scroll tabs right". */
    readonly scrollNextLabel?: string
}

/**
 * `secondary` (the default, HeroUI's secondary variant): the underline. `kind="views"` switches between views of a page, in the page
 * head. `kind="filter"` narrows one list that stays in place, in a card's `filter` or `toolbar` header zone: the same underline one size
 * smaller (13px, tighter), each with its `count`; the tabs that do not fit fold into a "+n" menu and the selected one always stays visible.
 * Exactly one line stands under the strip and the selected underline lies on it. A tablist is not a form field: choosing a value of a
 * form is `ChoiceChips` or `RadioGroup`.
 */
export type SecondaryTabsProps = TabsCommon & {
    readonly appearance?: "secondary"
    readonly kind?: "views" | "filter"
    /** The accessible name of the menu that holds the folded tabs, e.g. `(count) => \`${count} more filters\``. */
    readonly moreLabel?: (count: number) => string
    /**
     * The word the fold menu draws instead of "+n" (the app's own, e.g. "More"); the menu stays named by `moreLabel`, which
     * still says how many tabs it holds, so assistive technology hears the count the word does not show. On `views` tabs, giving it
     * makes the tabs that do not fit fold into that menu (the selected one stays visible) instead of scrolling.
     */
    readonly overflowLabel?: string
    readonly items: ReadonlyArray<TabItem>
    /** Page chrome owns whether the peer strip starts at the shared page inset. */
    readonly inset?: "page" | "none"
    /**
     * A command at the strip's end (a `Button size="sm"`, a menu trigger): it stands inside the strip frame after the tab list and the
     * fold menu, vertically centred in the strip's height like a tab, so the strip's line (its own, or the host's) runs under it to the
     * column's end. An app never puts a Cluster beside the strip for this. Secondary tabs only.
     */
    readonly end?: ReactNode
}

/** One option of a primary strip: a short label, no count, no destination. */
export type PrimaryTabItem = Omit<TabItem, "count" | "isAttention" | "href"> & {
    readonly count?: never
    readonly isAttention?: never
    readonly href?: never
}

/** Two to four options. */
export type PrimaryTabItems =
    | readonly [PrimaryTabItem, PrimaryTabItem]
    | readonly [PrimaryTabItem, PrimaryTabItem, PrimaryTabItem]
    | readonly [PrimaryTabItem, PrimaryTabItem, PrimaryTabItem, PrimaryTabItem]

/**
 * `primary` (HeroUI's primary variant): a pill in a track, still `role="tab"`. It switches a mode or period of the same data ("This
 * month / Last month", "Day / Week / Month", "List / Board") among 2 to 4 short, fixed options, and never navigates: no `count`, no
 * `href`, no more than four items (refused by the types, and by a development throw for what the types cannot see). It has no
 * line; in a card it is the `switch` header zone at the head's trailing edge.
 */
export type PrimaryTabsProps = TabsCommon & {
    readonly appearance: "primary"
    readonly kind?: never
    readonly moreLabel?: never
    readonly overflowLabel?: never
    readonly inset?: never
    readonly end?: never
    readonly items: PrimaryTabItems
}

export type TabsProps = SecondaryTabsProps | PrimaryTabsProps

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
    const items: ReadonlyArray<TabItem> = props.items
    const isPill = props.appearance === "primary"
    const [isClientReady, setIsClientReady] = useState(false)
    const frameRef = useRef<HTMLDivElement>(null)
    const endRef = useRef<HTMLDivElement>(null)
    useRefuseInCustomZone("Tabs")
    // The line owner is the host's, never a prop: a card zone and the page header band wrap their strip in `TabsLineHost` (draws no line of its own, the indicator overlaps the host's divider); a standalone strip draws `--separator` itself.
    const hostLine = useTabsLineDefault()
    const line: string = isPill ? "none" : hostLine
    // A primary strip is for a mode or a period of the same data: a few short fixed options, never a destination and never counted.
    if (isPill && process.env.NODE_ENV !== "production" && (items.length < 2 || items.length > 4 || items.some((item) => item.count !== undefined || item.href !== undefined || item.isAttention !== undefined))) {
        throw new Error("Tabs appearance=\"primary\" holds two to four short, fixed options with no count, no href and no attention mark; views, filters and destinations are the secondary (underline) tabs.")
    }
    // A loading region keeps the labels real (static chrome) and draws each count as the geometry of its ready box; the region makes the tabs inert.
    const isLoading = useIsLoading(undefined)
    useEffect(() => setIsClientReady(true), [])
    const isLinkTabs = items.some((item) => item.href !== undefined)
    const [locationPath, setLocationPath] = useLocationPath(isLinkTabs && props.selectedKey === undefined)
    // A path no link tab owns falls back to the first tab, so link tabs stay controlled from their first render.
    const selectedKey = props.selectedKey
        ?? (isLinkTabs && locationPath !== undefined ? tabKeyFromPath(items, locationPath, window.location.href) ?? items[0]?.id : undefined)
    const select = (key: string) => {
        const href = items.find((item) => item.id === key)?.href
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
    }, [isClientReady, items, props.panelId, selectedKey])

    // The vendor indicator fills its tab and animates width. A label edit resizes the selected tab, so the
    // indicator follows at once: the frame disables that width transition for the commit that changed a label.
    const labelSignature = items.map((item) => `${item.id}|${item.label}`).join(", ")
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
    const folds = !isPill && (isFilter || props.overflowLabel !== undefined)
    const frameContract = inset === "page" ? "PADDING-5" : undefined
    const hasEnd = !isPill && props.end !== undefined && props.end !== null && props.end !== false
    const frameData = { ...(hasEnd ? { "data-grammar-tabs-has-end": "true" } : {}), "data-component": "Tabs", "data-tier": "branch", "data-grammar-tabs": "true", "data-grammar-tabs-inset": inset, "data-grammar-tabs-variant": isPill ? "primary" : "secondary", "data-grammar-tabs-kind": isPill ? "switch" : kind, "data-grammar-tabs-line": line, "data-grammar-tabs-folds": folds ? "true" : "false" } as const

    // `filter`: the tabs that do not fit fold into a "+n" menu. All tabs draw once to be measured (the widths are kept), then
    // the fit is recomputed from those widths whenever the frame resizes; the selected tab is always one of the shown.
    const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set())
    const [fittedFor, setFittedFor] = useState("")
    const [, setMeasureTick] = useState(0)
    const widths = useRef<ReadonlyArray<number>>([])
    const gap = useRef(0)
    const fitSignature = folds ? items.map((item) => `${item.id}|${item.label}|${item.count ?? ""}`).join("\u0000") : ""
    const renderAll = folds && fittedFor !== fitSignature
    const selectedIndex = items.findIndex((item) => item.id === selectedKey)
    const MORE_WIDTH = 64
    const fit = () => {
        const frame = frameRef.current
        if (frame === null || widths.current.length !== items.length) return
        const shown = visibleOptionIndexes(widths.current, selectedIndex, Math.floor(frame.getBoundingClientRect().width - (endRef.current?.getBoundingClientRect().width ?? 0)), MORE_WIDTH, gap.current)
        const next = new Set(items.filter((_, index) => !shown.includes(index)).map((item) => item.id))
        setHiddenIds((previous) => previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next)
    }
    useLayoutEffect(() => {
        const frame = frameRef.current
        if (!folds || !isClientReady || frame === null || !renderAll) return undefined
        const tabs = Array.from(frame.querySelectorAll<HTMLElement>("[role='tab']"))
        // The vendor collection mounts its tabs after the first commit: measure only once every tab is there.
        if (tabs.length !== items.length) {
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
        if (endRef.current !== null) observer.observe(endRef.current)
        return () => observer.disconnect()
    })
    const shownItems = !folds || renderAll ? items : items.filter((item) => !hiddenIds.has(item.id))
    const foldedItems = !folds || renderAll ? [] : items.filter((item) => hiddenIds.has(item.id))
    // A page tab (views) with nothing in it draws no chip; a filter tab keeps its grey 0.
    const shownCount = (item: TabItem): number | undefined => item.count === undefined || (item.count === 0 && !isFilter && !isLoading) ? undefined : item.count
    const labelOf = (item: TabItem) => shownCount(item) === undefined || isLoading ? item.label : `${item.label} ${item.count}`

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
                {shownCount(item) === undefined ? null : <span className="starci-core-tab-count" data-grammar-tab-count="true" {...(item.isAttention === true ? { "data-grammar-attention": "true" } : {})}>{isLoading ? <SkeletonPlaceholder>{item.count}</SkeletonPlaceholder> : item.count}</span>}
            </span>
            <HeroTabs.Indicator />
        </HeroTabs.Tab>
    ))

    return <div ref={frameRef} className={tabsFrameClassName} data-contract={frameContract} {...frameData} data-grammar-tabs-client="ready" data-grammar-tab-labels={props.labelVisibility ?? "responsive"} {...(renderAll ? { "data-grammar-tabs-measuring-fit": "true" } : {})}>
        <HeroTabs
            variant={isPill ? "primary" : "secondary"}
            {...(selectedKey === undefined ? {} : { selectedKey })}
            onSelectionChange={(key) => select(String(key))}
            className={tabsClassName ?? ""}
            data-contract="FLOW-2"
        >
            <HeroTabs.List aria-label={props.label} render={({ children, ref, ...listProps }) => isPill ? (
                <div className="tabs__list-container" data-grammar-tabs-track="true"><div {...listProps} ref={ref} style={listProps.style}>{children}</div></div>
            ) : folds ? (
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
        {hasEnd ? <div ref={endRef} className="starci-core-tabs-end" data-grammar-tabs-end="true">{props.end}</div> : null}
    </div>
}

/** Render peer tabs through Core's selected, accessible and responsive treatment. */
export const Tabs = withRegionInert(TabsInner)
