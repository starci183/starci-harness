"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button } from "../../leaf/Button/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Link } from "../../leaf/Link/index.js"
import { DropdownMenu, type DropdownMenuItem } from "../../branch/DropdownMenu/index.js"

/** A destination of the bar's inline navigation (a marketing site's "Product", "Pricing"). */
export type TopBarNavigationItem = {
    readonly id: string
    readonly label: string
    readonly href: string
    /** Marks the page the reader is on (`aria-current="page"`). */
    readonly isCurrent?: boolean
}

/**
 * An action of the bar's row ("Đăng nhập", "Tải xuống"): a text button that is a destination (`href`) or a command (`onPress`). `emphasis` `primary` is the bar's one call to action (the
 * commit plate); `secondary` (default) is the quiet text button. The label is always one line: an action that does not fit the row moves into the menu whole, never wraps.
 */
export type TopBarActionItem = {
    readonly id: string
    readonly label: string
    readonly emphasis?: "primary" | "secondary"
} & (
    | { readonly href: string; readonly onPress?: never }
    | { readonly onPress: () => void; readonly href?: never }
)

type FitItem =
    | { readonly kind: "navigation"; readonly item: TopBarNavigationItem }
    | { readonly kind: "action"; readonly item: TopBarActionItem }

/** The menu trigger is an icon button at the one control height (2.5rem, 40px): its width is reserved before an item is taken out of the row. */
const TRIGGER_PX = 40

/** The order items leave the row: navigation first (last entry first), then the quiet actions, the primary action last. */
const collapseOrder = (items: readonly FitItem[]): readonly string[] => {
    const rank = (entry: FitItem): number => (entry.kind === "navigation" ? 0 : entry.item.emphasis === "primary" ? 2 : 1)
    return items
        .map((entry, index) => ({ id: entry.item.id, rank: rank(entry), index }))
        .sort((a, b) => a.rank - b.rank || b.index - a.index)
        .map((entry) => entry.id)
}

/**
 * Which items stay in a row `available` wide: all of them while they fit; otherwise the menu trigger takes its place and items leave, in collapse order, until the rest and the
 * trigger fit. Pure, so the order and the arithmetic hold at any width.
 */
export const fitItems = (items: readonly FitItem[], widths: ReadonlyMap<string, number>, available: number, gap: number): ReadonlySet<string> => {
    const span = (ids: readonly string[]): number => ids.reduce((sum, id) => sum + (widths.get(id) ?? 0), 0) + gap * Math.max(0, ids.length - 1)
    const all = items.map((entry) => entry.item.id)
    if (span(all) <= available) return new Set()
    const hidden = new Set<string>()
    for (const id of collapseOrder(items)) {
        hidden.add(id)
        const shown = all.filter((candidate) => !hidden.has(candidate))
        if (span(shown) + (shown.length === 0 ? 0 : gap) + TRIGGER_PX <= available) break
    }
    return hidden
}

const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect

const menuEntry = (entry: FitItem): DropdownMenuItem => {
    const base = { id: `top-bar-fit-${entry.item.id}`, label: entry.item.label }
    if (entry.kind === "navigation") return { ...base, href: entry.item.href }
    return entry.item.href === undefined ? { ...base, onAction: entry.item.onPress } : { ...base, href: entry.item.href }
}

/**
 * The bar's fitting row: navigation links and action buttons on one line that never wraps and never scrolls. The row measures its items once, then keeps the ones that fit its width
 * and offers the rest, in order, in a menu opened by the three-line trigger at its end. The trigger exists only while something is in the menu. It follows the row's own width, not a
 * breakpoint, so a long label or a narrow phone moves an action into the menu where a wide one keeps it in the row.
 */
export const TopBarFitRow = ({ navigationItems = [], actionItems = [], overflowLabel }: { readonly navigationItems?: readonly TopBarNavigationItem[]; readonly actionItems?: readonly TopBarActionItem[]; readonly overflowLabel: string }) => {
    const items: readonly FitItem[] = [
        ...navigationItems.map((item): FitItem => ({ kind: "navigation", item })),
        ...actionItems.map((item): FitItem => ({ kind: "action", item })),
    ]
    const signature = items.map((entry) => `${entry.kind}:${entry.item.id}:${entry.item.label}:${entry.kind === "action" ? (entry.item.emphasis ?? "secondary") : ""}`).join("|")
    const rowRef = useRef<HTMLDivElement>(null)
    const widths = useRef(new Map<string, number>())
    const [fit, setFit] = useState<{ readonly signature: string; readonly epoch: number; readonly hidden: ReadonlySet<string> }>({ signature, epoch: 0, hidden: new Set() })
    // A changed list or a settled font draws every item again before it is measured again.
    const hidden = fit.signature === signature ? fit.hidden : new Set<string>()

    useLayout(() => {
        const row = rowRef.current
        if (row === null) return undefined
        const measure = () => {
            for (const element of Array.from(row.querySelectorAll<HTMLElement>("[data-grammar-top-bar-fit-item]"))) {
                widths.current.set(element.dataset["grammarTopBarFitItem"] ?? "", element.getBoundingClientRect().width)
            }
            const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
            const next = fitItems(items, widths.current, row.clientWidth, gap)
            setFit((current) => {
                const same = current.signature === signature && current.hidden.size === next.size && [...next].every((id) => current.hidden.has(id))
                return same ? current : { signature, epoch: current.epoch, hidden: next }
            })
        }
        if (fit.signature !== signature) {
            widths.current.clear()
            setFit({ signature, epoch: fit.epoch, hidden: new Set() })
            return undefined
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(row)
        return () => observer.disconnect()
        // The items are read through `signature`: it changes whenever any of them does.
    }, [signature, fit.signature, fit.epoch])

    useEffect(() => {
        let live = true
        void document.fonts?.ready.then(() => {
            if (!live) return
            widths.current.clear()
            setFit((current) => ({ signature: "", epoch: current.epoch + 1, hidden: new Set() }))
        })
        return () => {
            live = false
        }
    }, [])

    const inRow = items.filter((entry) => !hidden.has(entry.item.id))
    const inMenu = items.filter((entry) => hidden.has(entry.item.id))
    return (
        <div ref={rowRef} className="starci-core-top-bar-fit" data-grammar-top-bar-fit="true" data-grammar-top-bar-fit-overflow={inMenu.length === 0 ? "false" : "true"}>
            {inRow.map((entry) => (
                <span key={entry.item.id} className="starci-core-top-bar-fit-item" data-grammar-top-bar-fit-item={entry.item.id} data-grammar-top-bar-fit-kind={entry.kind}>
                    {entry.kind === "navigation" ? (
                        <Link href={entry.item.href} variant="plain" isCurrent={entry.item.isCurrent === true}>{entry.item.label}</Link>
                    ) : entry.item.href === undefined ? (
                        <Button variant={entry.item.emphasis === "primary" ? "primary" : "border"} onPress={entry.item.onPress}>{entry.item.label}</Button>
                    ) : (
                        <Button variant={entry.item.emphasis === "primary" ? "primary" : "border"} href={entry.item.href}>{entry.item.label}</Button>
                    )}
                </span>
            ))}
            {inMenu.length === 0 ? null : (
                <DropdownMenu
                    placement="bottom end"
                    entries={inMenu.map(menuEntry)}
                    trigger={<IconButton variant="border" glyph="menu" label={overflowLabel} />}
                />
            )}
        </div>
    )
}
