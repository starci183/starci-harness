"use client"

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { withRegionInert } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"

/** One section of the page the outline lists. */
export type TableOfContentsItem = {
    /** The `id` of the section's element on the page. */
    readonly id: string
    readonly label: string
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
}

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
 * jumps to the section (smoothly unless the reader asks for reduced motion), moves focus to it and updates the address hash.
 * Contract: A11Y-2 (a named navigation landmark), FOCUS-1, STATE-7 (controlled active section).
 */
const TableOfContentsInner = ({ title, items, offset = 0, activeId, onActiveChange }: TableOfContentsProps) => {
    const [ownActive, setOwnActive] = useState<string | undefined>(items[0]?.id)
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
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        target.style.scrollMarginTop = `${String(offset)}px`
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1")
        target.focus({ preventScroll: true })
        history.replaceState(null, "", `#${id}`)
        settle(id)
    }

    return (
        <nav
            className="starci-core-toc"
            data-component="TableOfContents"
            data-tier="composite"
            data-contract="A11Y-2 FOCUS-1 STATE-7"
            aria-label={title}
            style={{ insetBlockStart: offset }}
        >
            <p className="starci-core-toc-title" aria-hidden="true">{title}</p>
            <ol className="starci-core-toc-list">
                {items.map((item) => (
                    <li key={item.id} className="starci-core-toc-item">
                        <a
                            className="starci-core-toc-link"
                            href={`#${item.id}`}
                            data-grammar-toc-active={active === item.id ? "true" : "false"}
                            {...(active === item.id ? { "aria-current": "location" as const } : {})}
                            onClick={(event) => jump(event, item.id)}
                        >
                            {item.label}
                        </a>
                    </li>
                ))}
            </ol>
        </nav>
    )
}

/** Inside a loading region the outline waits inert: its sections are not there yet. */
export const TableOfContents = withRegionInert(TableOfContentsInner)
