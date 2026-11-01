"use client"

import type { DragEventHandler, ReactNode } from "react"

export type DragItemTone = "neutral" | "accent" | "success" | "warning" | "danger"

export type DragItemProps = {
    /** Include a published control that provides the same operation without dragging. */
    readonly children: ReactNode
    readonly isDisabled?: boolean
    readonly onDragStart?: DragEventHandler<HTMLDivElement>
    readonly onDragEnd?: DragEventHandler<HTMLDivElement>
    /** Stamps `data-grammar-selected` on the item. HeroUI has no draggable selected state, so Grammar draws nothing for it: the caller marks selection. */
    readonly isSelected?: boolean
    readonly isInvalid?: boolean
    readonly isDashed?: boolean
    /** The category tone drawn on the leading edge; never the only indication of category or validity. */
    readonly tone?: DragItemTone
}

/** A native drag source with Grammar-owned state hooks; its child control supplies keyboard operation. */
export const DragItem = ({ children, isDisabled = false, onDragStart, onDragEnd, isSelected = false, isInvalid = false, isDashed = false, tone }: DragItemProps) => (
    <div
        className="starci-core-drag-item"
        data-component="DragItem"
        data-tier="branch"
        data-grammar-selected={isSelected ? "true" : "false"}
        data-grammar-invalid={isInvalid ? "true" : "false"}
        data-grammar-dashed={isDashed ? "true" : "false"}
        draggable={!isDisabled}
        {...(tone === undefined ? {} : { "data-grammar-drag-tone": tone })}
        {...(isDisabled || onDragStart === undefined ? {} : { onDragStart })}
        {...(isDisabled || onDragEnd === undefined ? {} : { onDragEnd })}
    >
        {children}
    </div>
)
