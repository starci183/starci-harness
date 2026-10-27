"use client"

import { Tag as HeroTag, TagGroup as HeroTagGroup, type Selection } from "@heroui/react"
import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react"
import { navigationClassName } from "../../navigationClassNames.js"

export type TagGroupItem = {
    readonly id: string
    readonly label: string
    readonly leading?: ReactNode
    readonly isDisabled?: boolean
    /**
     * The chip names something that is switched off (a disabled capability, a paused rule): drawn as HeroUI's
     * `surface` chip variant (its quieter ground beside the default chips), still focusable and readable - unlike `isDisabled`,
     * which takes the chip out of interaction. The ground is not the only carrier: see `offLabel`.
     */
    readonly isOff?: boolean
    /**
     * Localized state word for an off chip ("off", "paused"), appended to its accessible name as
     * visually hidden text. Omit it only when the visible `label` already says the chip is off.
     */
    readonly offLabel?: string
}

type TagGroupRemoval = {
    /** Present only for removable chips. Delete/Backspace on a focused chip also removes it. */
    readonly onRemove: (ids: ReadonlyArray<string>) => void
    /** App-owned accessible name of a chip's remove button, e.g. "Remove Design". */
    readonly removeLabel: (label: string) => string
} | {
    readonly onRemove?: undefined
    readonly removeLabel?: undefined
}

type TagGroupReorder = {
    /**
     * Makes the tags reorderable: drag a tag onto another, or hold Alt and press an arrow key (Home and End go to the
     * ends) on a focused tag. Receives every id in the new order. The app owns the order; render `items` in it.
     */
    readonly onReorder: (ids: ReadonlyArray<string>) => void
    /** App-owned instruction read with the group, e.g. "Hold Alt and press an arrow key to move a tag". */
    readonly reorderInstructions: string
    /** App-owned announcement after a move, e.g. "Design moved to position 2 of 5". */
    readonly reorderAnnouncement: (label: string, position: number, total: number) => string
} | {
    readonly onReorder?: undefined
    readonly reorderInstructions?: undefined
    readonly reorderAnnouncement?: undefined
}

export type TagGroupProps = TagGroupRemoval & TagGroupReorder & {
    /** Names the set of tags/chips, e.g. "Filters". */
    readonly label: string
    readonly items: ReadonlyArray<TagGroupItem>
    /** `none` renders static chips; `single`/`multiple` make them selectable filter chips. */
    readonly selectionMode?: "none" | "single" | "multiple"
    readonly selectedIds?: ReadonlyArray<string>
    readonly defaultSelectedIds?: ReadonlyArray<string>
    readonly onSelectionChange?: (ids: ReadonlyArray<string>) => void
    /** Shown when no items remain. */
    readonly emptyContent?: ReactNode
    readonly size?: "sm" | "md" | "lg"
    readonly className?: string
}

const toIds = (selection: Selection, items: ReadonlyArray<TagGroupItem>): ReadonlyArray<string> => selection === "all"
    ? items.map((item) => item.id)
    : [...selection].map(String)

const moveId = (ids: ReadonlyArray<string>, id: string, targetIndex: number): ReadonlyArray<string> => {
    const from = ids.indexOf(id)
    const to = Math.min(ids.length - 1, Math.max(0, targetIndex))
    if (from === -1 || from === to) return ids
    const next = ids.filter((candidate) => candidate !== id)
    next.splice(to, 0, id)
    return next
}

const tagIdOf = (target: EventTarget | null, root: HTMLElement): string | undefined => {
    if (!(target instanceof Element)) return undefined
    const tag = target.closest<HTMLElement>("[data-grammar-tag-id]")
    return tag !== null && root.contains(tag) ? tag.dataset.grammarTagId : undefined
}

/**
 * Chips/tags: static labels, selectable filters, removable tokens, or a reorderable set.
 *
 * Built on the vendor TagGroup, so arrow keys move between chips, Space/Enter toggle selection
 * and Delete/Backspace remove. Each chip exposes `data-grammar-selected`; chips wrap onto new lines
 * at narrow widths instead of overflowing.
 * Reordering (`onReorder`) is Grammar's own layer: the vendor TagGroup has no drag-and-drop collection hooks, so the group
 * wires native drag events for pointer users and Alt+arrow keys for keyboard users on top of the vendor tags, and announces
 * each move through a live region.
 * Contract: root STATE-1, list FOCUS-2, chip FOCUS-1, remove A11Y-2, empty STATE-3.
 */
export const TagGroup = ({
    label,
    items,
    selectionMode = "none",
    selectedIds,
    defaultSelectedIds,
    onSelectionChange,
    onRemove,
    removeLabel,
    onReorder,
    reorderInstructions,
    reorderAnnouncement,
    emptyContent,
    size = "md",
    className,
}: TagGroupProps) => {
    const rootRef = useRef<HTMLDivElement>(null)
    const instructionsId = useId()
    const [announcement, setAnnouncement] = useState("")
    const [draggingId, setDraggingId] = useState<string | undefined>(undefined)
    const [dropTargetId, setDropTargetId] = useState<string | undefined>(undefined)
    const ids = items.map((item) => item.id)
    const reorderable = onReorder !== undefined
    // The vendor tag does not forward `draggable`, and the vendor group drops `aria-describedby`, so the group marks each
    // enabled tag draggable and points the grid at the reorder instructions. The vendor collection renders its tags after
    // this component's effects have run, so the marking also runs whenever the tags' DOM changes.
    useEffect(() => {
        const root = rootRef.current
        if (root === null || !reorderable) return
        const mark = () => {
            root.querySelectorAll<HTMLElement>("[data-grammar-tag-id]").forEach((tag) => {
                const draggable = tag.getAttribute("aria-disabled") !== "true"
                if (tag.draggable !== draggable) tag.draggable = draggable
            })
            const grid = root.querySelector<HTMLElement>("[role='grid']")
            if (grid === null || reorderInstructions === undefined) return
            const described = (grid.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id !== "")
            if (!described.includes(instructionsId)) grid.setAttribute("aria-describedby", [...described, instructionsId].join(" "))
        }
        mark()
        const observer = new MutationObserver(mark)
        observer.observe(root, { childList: true, subtree: true, attributeFilter: ["aria-disabled", "aria-describedby"] })
        return () => observer.disconnect()
    }, [reorderable, reorderInstructions, instructionsId])
    const commit = (id: string, targetIndex: number) => {
        if (onReorder === undefined || reorderAnnouncement === undefined) return
        const next = moveId(ids, id, targetIndex)
        if (next === ids) return
        onReorder(next)
        const item = items.find((candidate) => candidate.id === id)
        setAnnouncement(reorderAnnouncement(item?.label ?? id, next.indexOf(id) + 1, next.length))
        requestAnimationFrame(() => {
            rootRef.current?.querySelector<HTMLElement>(`[data-grammar-tag-id="${CSS.escape(id)}"]`)?.focus()
        })
    }
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const root = rootRef.current
        if (!reorderable || root === null || !event.altKey || event.ctrlKey || event.metaKey) return
        const id = tagIdOf(event.target, root)
        if (id === undefined || event.target !== root.querySelector(`[data-grammar-tag-id="${CSS.escape(id)}"]`)) return
        const rtl = getComputedStyle(root).direction === "rtl"
        const index = ids.indexOf(id)
        const target = event.key === "ArrowLeft" ? index + (rtl ? 1 : -1)
            : event.key === "ArrowRight" ? index + (rtl ? -1 : 1)
            : event.key === "ArrowUp" ? index - 1
            : event.key === "ArrowDown" ? index + 1
            : event.key === "Home" ? 0
            : event.key === "End" ? ids.length - 1
            : undefined
        if (target === undefined) return
        event.preventDefault()
        event.stopPropagation()
        commit(id, target)
    }
    const onDragStart = (event: DragEvent<HTMLDivElement>) => {
        const root = rootRef.current
        const id = root === null ? undefined : tagIdOf(event.target, root)
        if (id === undefined) return
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", id)
        setDraggingId(id)
    }
    const onDragOver = (event: DragEvent<HTMLDivElement>) => {
        const root = rootRef.current
        const id = root === null ? undefined : tagIdOf(event.target, root)
        if (draggingId === undefined || id === undefined) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setDropTargetId(id)
    }
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        const root = rootRef.current
        const id = root === null ? undefined : tagIdOf(event.target, root)
        if (draggingId === undefined) return
        event.preventDefault()
        if (id !== undefined) commit(draggingId, ids.indexOf(id))
        setDraggingId(undefined)
        setDropTargetId(undefined)
    }
    const onDragEnd = () => {
        setDraggingId(undefined)
        setDropTargetId(undefined)
    }
    const tags = (
    <HeroTagGroup
        aria-label={label}
        {...(reorderable ? { "data-grammar-tag-reorderable": "true" } : {})}
        className={navigationClassName("starci-core-tag-group", className)}
        data-component="TagGroup"
        data-contract="STATE-1"
        data-tier="composite"
        data-grammar-tag-selection={selectionMode}
        data-grammar-tag-removable={onRemove === undefined ? "false" : "true"}
        selectionMode={selectionMode}
        size={size}
        {...(selectedIds === undefined ? {} : { selectedKeys: new Set(selectedIds) })}
        {...(defaultSelectedIds === undefined ? {} : { defaultSelectedKeys: new Set(defaultSelectedIds) })}
        {...(onSelectionChange === undefined ? {} : { onSelectionChange: (selection: Selection) => onSelectionChange(toIds(selection, items)) })}
        {...(onRemove === undefined ? {} : { onRemove: (keys: Set<string | number>) => onRemove([...keys].map(String)) })}
    >
        <HeroTagGroup.List
            className="starci-core-tag-list"
            data-contract="FOCUS-2"
            {...(emptyContent === undefined ? {} : { renderEmptyState: () => <span className="starci-core-tag-empty" data-contract="STATE-3" data-grammar-tag-empty="true">{emptyContent}</span> })}
        >
            {items.map((item) => (
                <HeroTag
                    key={item.id}
                    id={item.id}
                    className="starci-core-tag"
                    data-contract="FOCUS-1"
                    data-grammar-tag="true"
                    data-grammar-tag-id={item.id}
                    {...(reorderable ? { "data-grammar-tag-dragging": draggingId === item.id ? "true" : "false", "data-grammar-tag-drop-target": dropTargetId === item.id && draggingId !== item.id ? "true" : "false" } : {})}
                    textValue={item.isOff === true && item.offLabel !== undefined ? `${item.label}, ${item.offLabel}` : item.label}
                    data-grammar-tag-state={item.isOff === true ? "off" : "on"}
                    {...(item.isOff === true ? { variant: "surface" as const } : {})}
                    {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
                >
                    {({ isSelected, allowsRemoving }) => <>
                        <span className="starci-core-tag-label" data-grammar-tag-label="true" data-grammar-selected={isSelected ? "true" : "false"}>
                            {item.leading === undefined ? null : <span aria-hidden="true" className="starci-core-tag-leading" data-contract="A11Y-2">{item.leading}</span>}
                            {item.label}
                            {item.isOff === true && item.offLabel !== undefined ? <span className="starci-core-visually-hidden" data-grammar-tag-off-label="true">{`, ${item.offLabel}`}</span> : null}
                        </span>
                        {allowsRemoving ? <HeroTag.RemoveButton aria-label={removeLabel?.(item.label) ?? item.label} className="starci-core-tag-remove" data-contract="A11Y-2" data-grammar-tag-remove="true" /> : null}
                    </>}
                </HeroTag>
            ))}
        </HeroTagGroup.List>
    </HeroTagGroup>
    )
    if (!reorderable) return tags
    // The vendor group forwards neither a ref nor key-capture and drag handlers, so the reorder layer listens on a
    // wrapper of its own that lays out as if absent (`display: contents`).
    return (
        <>
            <div
                ref={rootRef}
                className="starci-core-tag-group-reorder"
                data-grammar-tag-reorder="true"
                onKeyDownCapture={onKeyDown}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
            >
                {tags}
            </div>
            <span id={instructionsId} className="starci-core-visually-hidden" hidden>{reorderInstructions}</span>
            <span aria-live="polite" role="status" className="starci-core-visually-hidden" data-grammar-tag-announcement="true">{announcement}</span>
        </>
    )
}
