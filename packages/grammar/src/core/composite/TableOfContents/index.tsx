"use client"

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react"
import { withRegionInert } from "../../regionScope.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import type { NoChildren } from "../../tier.js"

/** One section of the page the outline lists. */
export type TableOfContentsItem = {
    /** The `id` of the section's element on the page. */
    readonly id: string
    readonly label: string
    /** A short lead before the label (a time in the story, `23:58`), in tabular figures; absent when the section has none. */
    readonly meta?: string
}

export type TableOfContentsProps = NoChildren & {
    /** The outline's heading ("In this part"); also its landmark name. */
    readonly title: string
    readonly items: readonly TableOfContentsItem[]
    /**
     * The height (px) of what stays pinned over the page's top (a sticky bar): the outline sticks under it, a section counts as reached
     * when its top passes it, and a jump lands its heading just under it. Default 0.
     */
    readonly offset?: number
    /** The section in view, controlled; omit and the outline follows the scroll itself. */
    readonly activeId?: string
    readonly onActiveChange?: (id: string) => void
    /**
     * `rail` (default): the outline on a quiet rail beside the page. `bar` (0.58.0, a phone): one sticky selector at the top of the page
     * that names the section in view and opens the whole list; a pick jumps to it and closes the list.
     */
    readonly kind?: "rail" | "bar"
    /** One quiet line under the list (a count such as "Self-check: 1/6 right"). */
    readonly note?: string
    /** The bar's line over the section in view, given its place and the count ("Chapter 2/9"). Default "2/9". */
    readonly position?: (index: number, total: number) => string
}

/** The bar's default line over the section in view. */
const POSITION = (index: number, total: number): string => `${String(index)}/${String(total)}`

/** The section reached last: the last whose top has passed the line `offset` px under the top of the viewport, else the first. */
const reachedSection = (items: readonly TableOfContentsItem[], offset: number): string | undefined => {
    let reached = items[0]?.id
    for (const item of items) {
        const element = document.getElementById(item.id)
        if (element !== null && element.getBoundingClientRect().top <= offset + 8) reached = item.id
    }
    return reached
}

/**
 * COMPOSITE - `TableOfContents`: the sticky outline of a long page (owner 2026-11-23, a lesson's "why" part). Its sections are links on a
 * quiet rail; the one in view (scroll spy, whatever element scrolls) is marked on the rail in the foreground and `aria-current`. A press
 * jumps to the section (smoothly unless the reader asks for reduced motion), moves focus to it and updates the address hash. A section
 * may carry a short `meta` lead (a time). `kind="bar"` (0.58.0) is the same outline on a phone: one sticky selector naming the section in
 * view, which opens the list.
 * Contract: A11Y-2 (a named navigation landmark), FOCUS-1, STATE-7 (controlled active section).
 */
const TableOfContentsInner = ({ title, items, offset = 0, activeId, onActiveChange, kind = "rail", note, position = POSITION }: TableOfContentsProps) => {
    const [ownActive, setOwnActive] = useState<string | undefined>(items[0]?.id)
    const [isOpen, setOpen] = useState(false)
    const listId = useId()
    const active = activeId ?? ownActive

    const last = useRef<string | undefined>(items[0]?.id)
    const settle = useCallback((id: string | undefined) => {
        if (id === undefined || id === last.current) return
        last.current = id
        setOwnActive(id)
        onActiveChange?.(id)
    }, [onActiveChange])

    useEffect(() => {
        let frame = 0
        const update = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => settle(reachedSection(items, offset)))
        }
        update()
        // Capture catches the scroll of any container, not only the window's.
        document.addEventListener("scroll", update, { capture: true, passive: true })
        window.addEventListener("resize", update, { passive: true })
        return () => {
            cancelAnimationFrame(frame)
            document.removeEventListener("scroll", update, { capture: true })
            window.removeEventListener("resize", update)
        }
    }, [items, offset, settle])

    const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
        const target = document.getElementById(id)
        if (target === null || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        setOpen(false)
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        target.style.scrollMarginTop = `${String(offset)}px`
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1")
        target.focus({ preventScroll: true })
        history.replaceState(null, "", `#${id}`)
        settle(id)
    }

    const list = (
        <ol className="starci-core-toc-list" id={listId}>
            {items.map((item) => (
                <li key={item.id} className="starci-core-toc-item">
                    <a
                        className="starci-core-toc-link"
                        href={`#${item.id}`}
                        data-grammar-toc-active={active === item.id ? "true" : "false"}
                        {...(active === item.id ? { "aria-current": "location" as const } : {})}
                        onClick={(event) => jump(event, item.id)}
                    >
                        {item.meta === undefined || item.meta === "" ? null : <span className="starci-core-toc-meta">{item.meta}</span>}
                        <span className="starci-core-toc-label">{item.label}</span>
                    </a>
                </li>
            ))}
        </ol>
    )
    const noteLine = note === undefined || note === "" ? null : <p className="starci-core-toc-note">{note}</p>
    const shared = {
        className: "starci-core-toc",
        "data-component": "TableOfContents",
        "data-tier": "composite",
        "data-contract": "A11Y-2 FOCUS-1 STATE-7",
        "aria-label": title,
        style: { insetBlockStart: offset },
    } as const

    if (kind === "bar") {
        const index = Math.max(0, items.findIndex((item) => item.id === active))
        const current = items[index]
        const lead = [position(index + 1, items.length), current?.meta ?? ""].filter((part) => part !== "").join(" · ")
        return (
            <nav {...shared} data-grammar-toc-kind="bar" data-grammar-toc-open={isOpen ? "true" : "false"}>
                <button type="button" className="starci-core-toc-bar" aria-expanded={isOpen} aria-controls={listId} onClick={() => setOpen((open) => !open)}>
                    <span className="starci-core-toc-bar-words">
                        <span className="starci-core-toc-bar-position">{lead}</span>
                        <span className="starci-core-toc-bar-label">{current?.label ?? title}</span>
                    </span>
                    <span className="starci-core-toc-bar-caret" aria-hidden="true">
                        <Icon source={glyphSource("chevron-down")} usage="text" />
                    </span>
                </button>
                <div className="starci-core-toc-bar-panel" hidden={!isOpen}>
                    {list}
                    {noteLine}
                </div>
            </nav>
        )
    }

    return (
        <nav {...shared} data-grammar-toc-kind="rail">
            <p className="starci-core-toc-title" aria-hidden="true">{title}</p>
            {list}
            {noteLine}
        </nav>
    )
}

/** Inside a loading region the outline waits inert: its sections are not there yet. */
export const TableOfContents = withRegionInert(TableOfContentsInner)
