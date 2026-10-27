"use client"

import { Description as HeroDescription, Header, Label as HeroLabel, ListBox, Separator } from "@heroui/react"
import { useContext, useId, useRef, useState, type ReactNode } from "react"
import { OverlayTriggerStateContext } from "react-aria-components/Dialog"
import { useCollectionItemPresentation, type ItemDescriptionLines } from "../../collectionItem.js"
import { AnchoredTooltip } from "../../branch/Tooltip/index.js"
import { SurfaceNesting } from "../../surfaceContext.js"
import { Icon, type IconSource } from "../../primitive/Icon/index.js"
import { IconButton, iconButtonBadgeText } from "../../primitive/IconButton/index.js"
import {
    sidebarClassName,
    sidebarFooterClassName,
    sidebarHeaderClassName,
    sidebarItemClassName,
    sidebarItemLabelClassName,
    sidebarItemTrailingClassName,
    sidebarListClassName,
    sidebarSectionClassName,
    sidebarSectionLabelClassName,
    sidebarToggleClassName,
} from "./classNames.js"

export type SidebarItem = {
    readonly id: string
    readonly label: string
    readonly description?: ReactNode
    /** Visible description lines in the expanded sidebar (default one). */
    readonly descriptionLines?: ItemDescriptionLines
    readonly source?: IconSource
    readonly trailing?: ReactNode
    /** Unread or pending count, visible in both the expanded sidebar and the icon rail. */
    readonly badge?: number | string
    /** Count announcement, e.g. "3 unread conversations". */
    readonly badgeLabel?: string
    readonly badgeMax?: number
    readonly isDisabled?: boolean
}

export type SidebarGroup = {
    readonly id: string
    readonly label?: string
    /** Settings-type groups stay at the end, preserving their authored order. */
    readonly placement?: "start" | "end"
    readonly items: ReadonlyArray<SidebarItem>
}

export type SidebarProps = {
    readonly label: string
    readonly groups: ReadonlyArray<SidebarGroup>
    readonly selectedKey?: string
    readonly presentation?: "rail" | "drawer"
    readonly isCollapsed?: boolean
    readonly collapseLabel?: string
    readonly expandLabel?: string
    readonly toggleSource?: IconSource
    readonly header?: ReactNode
    readonly footer?: ReactNode
    readonly onAction?: (id: string) => void
    readonly onCollapsedChange?: (collapsed: boolean) => void
}

/** Namespacing section keys lets a group and its destination share an app-owned id. */
const sectionKey = (id: string) => `sidebar-section:${id}`

type SidebarTooltipItem = { readonly target: Element; readonly id: string; readonly label: string }

/**
 * Shared grouped sidebar renderer; apps own route, permission, copy and persistence policy.
 *
 * Geometry is owned by `.starci-core-sidebar*` in the packaged stylesheet, and the collapsed and
 * drawer projections are read from `data-collapsed` and `data-presentation` on this root. Items keep HeroUI's padding. Nothing
 * here depends on a consumer's Tailwind build scanning the package.
 */
export const Sidebar = ({
    label,
    groups,
    selectedKey,
    presentation = "rail",
    isCollapsed = false,
    collapseLabel,
    expandLabel,
    toggleSource,
    header,
    footer,
    onAction,
    onCollapsedChange,
}: SidebarProps) => {
    const itemPresentation = useCollectionItemPresentation()
    const overlayState = useContext(OverlayTriggerStateContext)
    const collapsed = presentation === "rail" && isCollapsed
    const listId = useId()
    const tooltipId = useId()
    const hoveredItem = useRef<SidebarTooltipItem | null>(null)
    const focusedItem = useRef<SidebarTooltipItem | null>(null)
    const [tooltip, setTooltip] = useState<SidebarTooltipItem | null>(null)
    const orderedGroups = [...groups.filter((group) => group.placement !== "end"), ...groups.filter((group) => group.placement === "end")]
    const updateTooltip = () => {
        const item = hoveredItem.current ?? focusedItem.current
        setTooltip(item)
    }
    const showTooltip = (target: Element, item: SidebarItem, kind: "hover" | "focus") => {
        if (!collapsed) return
        const ref = kind === "hover" ? hoveredItem : focusedItem
        ref.current = { target, id: item.id, label: item.label }
        updateTooltip()
    }
    const hideTooltip = (kind?: "hover" | "focus") => {
        if (kind !== "focus") hoveredItem.current = null
        if (kind !== "hover") focusedItem.current = null
        updateTooltip()
    }
    const toggleLabel = collapsed ? expandLabel : collapseLabel
    const canToggle = presentation === "rail" && toggleSource !== undefined && toggleLabel !== undefined && onCollapsedChange !== undefined

    const content = (
        <>
        <div
            data-tier="composition"
            data-component="Sidebar"
            data-grammar-nesting="surface"
            data-presentation={presentation}
            data-collapsed={collapsed ? "true" : "false"}
            className={sidebarClassName}
            data-contract={["FE-APP-SHELL-6", "OVERFLOW-2", presentation === "drawer" ? "MEASURE-2" : "MEASURE-6"].join(" ")}
        >
            {canToggle ? (
                <div className={sidebarToggleClassName} data-contract="PADDING-2">
                    <IconButton
                        source={toggleSource}
                        label={toggleLabel}
                        size="control"
                        isActive={collapsed}
                        aria-expanded={!collapsed}
                        aria-controls={listId}
                        onPress={() => { hideTooltip(); onCollapsedChange(!collapsed) }}
                    />
                </div>
            ) : null}
            {collapsed || header == null ? null : <div className={sidebarHeaderClassName} data-contract="PADDING-3">{header}</div>}
            <ListBox
                id={listId}
                aria-label={label}
                selectionMode="none"
                onAction={(key) => {
                    hideTooltip()
                    onAction?.(String(key))
                    if (presentation === "drawer") overlayState?.close()
                }}
                className={sidebarListClassName}
                data-contract={collapsed ? "GAP-1 PADDING-2" : "GAP-1 PADDING-3"}
            >
                {orderedGroups.flatMap((group, groupIndex) => [
                    // HeroUI divides adjacent sections with its own `Separator`, so a group never forgets one.
                    ...(groupIndex === 0 ? [] : [<Separator key={`separator-${group.id}`} />]),
                    <ListBox.Section
                        key={group.id}
                        id={sectionKey(group.id)}
                        className={sidebarSectionClassName}
                        data-grammar-sidebar-group-placement={group.placement ?? "start"}
                        data-grammar-sidebar-end-start={group.placement === "end" && orderedGroups[groupIndex - 1]?.placement !== "end" ? "true" : undefined}
                        data-contract="GAP-1"
                    >
                        {group.label === undefined ? null : (
                            <Header
                                className={sidebarSectionLabelClassName}
                                {...(collapsed ? {} : { "data-contract": "PADDING-2 PADDING-1 PADDING-3 FONT-1 TONE-2" })}
                            >
                                {group.label}
                            </Header>
                        )}
                        {group.items.map((item) => {
                            const badgeText = iconButtonBadgeText(item.badge, item.badgeMax)
                            const accessibleLabel = badgeText === null ? item.label : `${item.label}, ${item.badgeLabel ?? badgeText}`
                            return (
                            <ListBox.Item
                                key={item.id}
                                id={item.id}
                                textValue={item.label}
                                className={sidebarItemClassName}
                                data-grammar-current={selectedKey === item.id ? "true" : "false"}
                                aria-current={selectedKey === item.id ? "page" : undefined}
                                data-contract={collapsed ? "TONE-1 SURFACE-4" : "GAP-3 TONE-1 SURFACE-4"}
                                aria-label={accessibleLabel}
                                render={(props) => {
                                    const describedBy = [props["aria-describedby"], collapsed && tooltip?.id === item.id ? tooltipId : undefined].filter(Boolean).join(" ") || undefined
                                    return "href" in props ? <a {...props} aria-describedby={describedBy} /> : <div {...props} aria-describedby={describedBy} />
                                }}
                                onHoverStart={(event) => showTooltip(event.target, item, "hover")}
                                onHoverEnd={() => hideTooltip("hover")}
                                onFocus={(event) => showTooltip(event.target, item, "focus")}
                                onBlur={() => hideTooltip("focus")}
                                onKeyDown={(event) => { if (event.key === "Escape") hideTooltip() }}
                                {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
                            >
                                {item.source === undefined ? null : <Icon source={item.source} usage="leading" />}
                                {collapsed ? null : item.description === undefined ? <span className={sidebarItemLabelClassName} data-contract="FLOW-4 FONT-2">{item.label}</span> : (
                                    <div data-grammar-sidebar-copy="true">
                                        <HeroLabel className={sidebarItemLabelClassName} data-grammar-item-label="true" data-contract="FLOW-4 FONT-2">{item.label}</HeroLabel>
                                        <HeroDescription data-grammar-item-description="true" data-grammar-description-lines={item.descriptionLines ?? itemPresentation.descriptionLines}>{item.description}</HeroDescription>
                                    </div>
                                )}
                                {badgeText === null ? null : <span aria-hidden className="starci-core-icon-button-badge starci-core-sidebar-item-badge" data-grammar-sidebar-badge="true">{badgeText}</span>}
                                {collapsed || item.trailing == null ? null : <span className={sidebarItemTrailingClassName}>{item.trailing}</span>}
                            </ListBox.Item>
                        )})}
                    </ListBox.Section>,
                ])}
            </ListBox>
            {collapsed || footer == null ? null : <div className={sidebarFooterClassName} data-contract="PADDING-3 PADDING-0">{footer}</div>}
        </div>
        <AnchoredTooltip id={tooltipId} target={tooltip?.target ?? null} content={tooltip?.label} isOpen={collapsed && tooltip !== null} />
        </>
    )
    return <SurfaceNesting>{content}</SurfaceNesting>
}
