"use client"

import { withRegionInert } from "../../regionScope.js"
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { NoChildren } from "../../tier.js"

type ExpandableBase = NoChildren & {
    /** The trigger's words while folded, from the caller ("Xem thêm", "Chi tiết kỹ thuật"). */
    readonly expandLabel: string
    /** The trigger's words while open ("Thu gọn", "Ẩn chi tiết kỹ thuật"). */
    readonly collapseLabel: string
    /** Controlled expansion. Omit for uncontrolled use with `defaultExpanded`. */
    readonly isExpanded?: boolean
    readonly defaultExpanded?: boolean
    readonly onExpandedChange?: (isExpanded: boolean) => void
}

export type ExpandableProps = ExpandableBase & (
    | {
        /** `details`: the trigger is the title; open, it reveals the content as a muted mono block (a raw error, a payload). */
        readonly kind: "details"
        /** The raw text the block shows, kept verbatim (whitespace and line breaks). */
        readonly content: string
        readonly lines?: never
    }
    | {
        /** `clamp`: the content shows `lines` lines; the trigger under it opens the rest, and hides itself when the content fits. */
        readonly kind: "clamp"
        readonly content: ReactNode
        /** How many lines show while folded (1-12). Default 3. */
        readonly lines?: number
    }
)

const clampLines = (lines: number) => Math.min(12, Math.max(1, Math.floor(Number.isFinite(lines) ? lines : 3)))

/*
 * The trigger is HeroUI's link as shipped (owner, 2026-11-21: "cái expandable làm link chứ ko phải làm nút", "link sao có cái border bọc như nút??"): its `link`
 * class (what HeroUI's `linkVariants().base()` returns) on a native button, so it reads as a text link (no border, no background, no padding box, underline on hover) and acts as a disclosure control
 * (`aria-expanded`, `aria-controls`). The packaged sheet only resets the button's own box (`.starci-core-expandable-trigger`).
 */
const TRIGGER_CLASS_NAME = "link starci-core-expandable-trigger"

const ExpandableInner = (props: ExpandableProps) => {
    const { kind, expandLabel, collapseLabel, isExpanded, defaultExpanded = false, onExpandedChange } = props
    const [uncontrolled, setUncontrolled] = useState(defaultExpanded)
    const expanded = isExpanded ?? uncontrolled
    const contentId = useId()
    const clampRef = useRef<HTMLDivElement>(null)
    // `clamp` only: whether the folded content overflows its lines; a content that fits needs no trigger
    const [overflows, setOverflows] = useState(kind === "details")
    const lines = kind === "clamp" ? clampLines(props.lines ?? 3) : 0
    useLayoutEffect(() => {
        if (kind !== "clamp") return undefined
        const element = clampRef.current
        if (element === null) return undefined
        const measure = () => {
            // measured folded: an open content is folded for the reading, then given back its state
            const open = element.dataset["grammarExpandableState"] === "open"
            if (open) element.dataset["grammarExpandableState"] = "closed"
            setOverflows(element.scrollHeight > element.clientHeight + 1)
            if (open) element.dataset["grammarExpandableState"] = "open"
        }
        measure()
        if (typeof ResizeObserver === "undefined") return undefined
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [kind, lines, props.content])
    const toggle = () => {
        const next = !expanded
        if (isExpanded === undefined) setUncontrolled(next)
        onExpandedChange?.(next)
    }
    const trigger = (
        <button
            type="button"
            className={TRIGGER_CLASS_NAME}
            aria-expanded={expanded}
            aria-controls={contentId}
            data-contract="FOCUS-1"
            onClick={toggle}
        >
            {expanded ? collapseLabel : expandLabel}
        </button>
    )
    if (kind === "details") {
        return (
            <div className="starci-core-expandable" data-component="Expandable" data-tier="branch" data-contract="STATE-7" data-kind="details" data-grammar-expandable-state={expanded ? "open" : "closed"}>
                {trigger}
                <pre id={contentId} className="starci-core-expandable-details" hidden={!expanded}>
                    {props.content}
                </pre>
            </div>
        )
    }
    return (
        <div className="starci-core-expandable" data-component="Expandable" data-tier="branch" data-contract="STATE-7" data-kind="clamp" data-grammar-expandable-state={expanded ? "open" : "closed"}>
            <div
                ref={clampRef}
                id={contentId}
                className="starci-core-expandable-clamp"
                data-grammar-expandable-state={expanded ? "open" : "closed"}
                style={{ ["--starci-core-expandable-lines" as string]: String(lines) }}
            >
                {props.content}
            </div>
            {overflows || expanded ? trigger : null}
        </div>
    )
}

/**
 * Content folded behind a text-link toggle. `details` hides a muted mono block under its title ("Chi tiết kỹ thuật"); `clamp` shows the first lines of a text
 * and opens the rest ("Xem thêm"), drawing no toggle when the text fits. The trigger is HeroUI's link on a native button with `aria-expanded` and
 * `aria-controls`; the labels come from the caller; nothing animates (no motion to reduce).
 * Contract: root STATE-7 (controlled expansion), trigger FOCUS-1.
 */
export const Expandable = withRegionInert(ExpandableInner)
