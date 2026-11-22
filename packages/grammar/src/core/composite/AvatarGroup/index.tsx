"use client"

import { withRegionGeometry } from "../../regionScope.js"
import { Avatar as HeroAvatar, AvatarGroup as HeroAvatarGroup } from "@heroui/react"
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { Popover as AriaPopover } from "react-aria-components"
import { AgentName } from "../../leaf/AgentName/index.js"
import { useOverlayContainer } from "../../overlayScope.js"
import { Avatar, avatarA11yProps, avatarGroupSlots, avatarGroupTiles, avatarParts, vendorAvatarSize, type AvatarKind, type AvatarMark, type AvatarSize } from "../../leaf/Avatar/index.js"
import type { NoChildren } from "../../tier.js"

/**
 * One round item of a group: a PERSON (`name`, with an optional `seed`, drawn as initials) or a MARK (`mark`: an icon on a brand-colour circle, the provider or
 * the channel). Both are round, share the overlap and the "+N" tile, and are named by `name`.
 */
export type AvatarGroupItem = {
    readonly id: string
    /** Names the item (and gives a person's initials). A mark's name is the provider or channel. */
    readonly name: string
    readonly src?: string
    /** Stable identity id that picks the member's plate colour; otherwise `name` does. */
    readonly seed?: string
    /** `agent` names the item "Name (AI)" for assistive technology; no badge is drawn on the avatar. */
    readonly kind?: AvatarKind
    /** A provider or channel instead of a person: an icon on a brand-colour circle (a Grammar token or a brand colour passed in). */
    readonly mark?: AvatarMark
    /** Replaces the initials while the uploaded image loads or fails. */
    readonly fallback?: ReactNode
    /** `danger`: a ring in the danger token around this item, for a broken account. Default `default`. */
    readonly tone?: "default" | "danger"
}

export type AvatarGroupProps = NoChildren & {
    /** Names the group, e.g. who is in a space, and its member list. It is the group's accessible name unless `describe` builds one from the members. */
    readonly label: string
    readonly items: ReadonlyArray<AvatarGroupItem>
    /**
     * `row` (default) overlaps the items in a line, for providers and channels beside a name; `grid` makes one round group identity, the size of a single Avatar,
     * Zalo style (up to four tiles in a 2 by 2). Both follow the same overflow rule.
     */
    readonly layout?: "row" | "grid"
    /**
     * The slots the group may use, "+N" included (default 4): up to `max - 1` items show and the last slot is "+N" for the rest; when every item fits, all show.
     * 4 gives three items and "+N" in the 2 by 2. The grid never holds more than four; for five providers in a row with "+2", pass 6 with seven items.
     */
    readonly max?: number
    /**
     * `md` 40px (default), the common size: a header, a detail view, a list lead. `sm` 24px, the icon size: inline beside text, in a table cell or a chip, the agents on
     * an account row. There is no other size (owner 2026-11-22: "giữ 2 size phổ biến 40 và 24 thôi, không có 32").
     */
    readonly size?: AvatarSize
    /** App-owned accessible text for hidden members in either layout, e.g. "3 more people". The tile shows "+N" for the same N. */
    readonly overflowLabel: (hiddenCount: number) => string
    /**
     * App-owned copy that lists the members in the group's accessible name from the names shown and the count left out, e.g. "A, B và 3 người khác"
     * (the copy is the app's i18n; Grammar writes no sentence). When given it replaces `label` as the name of the group.
     */
    readonly describe?: (shownNames: ReadonlyArray<string>, hiddenCount: number) => string
    /** The word of the small Chip after an agent's name in the member list, in the app's language; "AI" when omitted. */
    readonly agentLabel?: string
    /**
     * Default `true`: hover, focus or a tap opens the member list. `false` only where the group stands inside another press target (a whole-card link such as
     * `EntitySummaryCard`), which may hold no control of its own; the group is then named by its label and is not focusable.
     */
    readonly hasMemberList?: boolean
}

const itemTone = (item: AvatarGroupItem) => item.tone ?? "default"

/** The "+N" mark: always the NEUTRAL muted pair (the default plate, the muted ink), never a hashed or accent colour (owner 2026-11-22: "+2 màu muted chớ"). */
const OverflowCount = ({ count }: { readonly count: number }) => (
    <span aria-hidden="true" className="starci-core-avatar-overflow" data-grammar-avatar-overflow-mark="muted">{`+${count}`}</span>
)

/** How long the member list stays after the pointer leaves the group or the list, so the pointer can cross the gap between them. */
const HOVER_CLOSE_MS = 150

/**
 * The member list (owner 2026-11-22): hover, focus or a tap on the group opens a list of EVERY member, shown and hidden, each row its avatar (`sm`), its name and,
 * for an agent, the small "AI" Chip (`AgentName`). It is a non-modal popover: it takes no focus; Escape, a blur, the pointer leaving or a press outside closes it.
 */
const useMemberList = () => {
    const [isOpen, setOpen] = useState(false)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const triggerRef = useRef<HTMLSpanElement>(null)
    // A press focuses the group too: that focus is the press's, so it does not open the list a second time.
    const pressing = useRef(false)
    const popoverRef = useRef<HTMLElement>(null)
    const cancelClose = useCallback(() => {
        if (closeTimer.current !== undefined) clearTimeout(closeTimer.current)
        closeTimer.current = undefined
    }, [])
    const open = useCallback(() => { cancelClose(); setOpen(true) }, [cancelClose])
    const close = useCallback(() => { cancelClose(); setOpen(false) }, [cancelClose])
    const closeSoon = useCallback(() => {
        cancelClose()
        closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
    }, [cancelClose])
    useEffect(() => cancelClose, [cancelClose])
    useEffect(() => {
        if (!isOpen) return undefined
        const outside = (event: Event) => {
            const target = event.target as Node | null
            if (target !== null && (triggerRef.current?.contains(target) === true || popoverRef.current?.contains(target) === true)) return
            close()
        }
        document.addEventListener("pointerdown", outside, true)
        return () => document.removeEventListener("pointerdown", outside, true)
    }, [isOpen, close])
    const triggerProps = {
        ref: triggerRef,
        tabIndex: 0,
        "aria-expanded": isOpen,
        onPointerEnter: (event: PointerEvent) => { if (event.pointerType === "mouse") open() },
        onPointerLeave: (event: PointerEvent) => { if (event.pointerType === "mouse") closeSoon() },
        // A tap (touch, pen) toggles; a mouse click keeps the list its hover opened.
        onPointerDown: () => { pressing.current = true },
        onPointerUp: (event: PointerEvent) => {
            if (event.pointerType === "mouse") open()
            else if (isOpen) close()
            else open()
        },
        // The click ends the press, after the focus a touch emulates.
        onClick: () => { pressing.current = false },
        onFocus: (event: FocusEvent) => { if (event.target === event.currentTarget && !pressing.current) open() },
        onBlur: (event: FocusEvent) => { if (event.target === event.currentTarget) close() },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key === "Escape" && isOpen) { event.stopPropagation(); close(); return }
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (isOpen) close(); else open() }
        },
    }
    const popoverProps = {
        ref: popoverRef,
        onPointerEnter: (event: PointerEvent) => { if (event.pointerType === "mouse") cancelClose() },
        onPointerLeave: (event: PointerEvent) => { if (event.pointerType === "mouse") closeSoon() },
    }
    // The list owns its closing (React Aria's non-modal popover would close on the scroll a keyboard focus makes).
    return { isOpen, triggerRef, triggerProps, popoverProps } as const
}

/** The member list's rows: every member, its `sm` avatar, its name and an agent's Chip. */
const MemberList = ({ id, label, items, agentLabel }: { readonly id: string; readonly label: string; readonly items: ReadonlyArray<AvatarGroupItem>; readonly agentLabel: string | undefined }) => (
    <ul id={id} aria-label={label} className="starci-core-avatar-group-members" data-grammar-avatar-members="true">
        {items.map((item) => (
            <li key={item.id} className="starci-core-avatar-group-members-row" data-grammar-avatar-member={item.id}>
                <Avatar
                    name={item.name}
                    size="sm"
                    isDecorative
                    tone={itemTone(item)}
                    {...(item.src === undefined ? {} : { src: item.src })}
                    {...(item.seed === undefined ? {} : { seed: item.seed })}
                    {...(item.kind === undefined ? {} : { kind: item.kind })}
                    {...(item.mark === undefined ? {} : { mark: item.mark })}
                    {...(item.fallback === undefined ? {} : { fallback: item.fallback })}
                />
                <span className="starci-core-avatar-group-members-name">
                    <AgentName name={item.name} isAgent={item.kind === "agent"} {...(agentLabel === undefined ? {} : { agentLabel })} />
                </span>
            </li>
        ))}
    </ul>
)

/**
 * A group of round items, people and marks together: an overlapping `row` or one Zalo-style `grid` identity. Items past `max - 1` collapse into one "+N" tile.
 * The group shows alone (no member names beside it); hover, focus or a tap opens the member list.
 * Contract: each item and the count A11Y-2 (named once; initials, marks and "+N" silent); the group is named by `label` or `describe`, and it controls the member
 * list (`aria-expanded`, `aria-controls`).
 */
const AvatarGroupInner = ({ label, items, layout = "row", max = 4, size = "md", overflowLabel, describe, agentLabel, hasMemberList = true }: AvatarGroupProps) => {
    const { shown, hidden } = avatarGroupSlots(items.length, layout === "grid" ? Math.min(max, 4) : max)
    const tiles = layout === "grid" ? avatarGroupTiles(items.length, max) : []
    const visible = items.slice(0, shown)
    const groupName = describe !== undefined ? describe(visible.map((item) => item.name), hidden) : label
    const listId = useId()
    const members = useMemberList()
    const { anchor, container } = useOverlayContainer("AvatarGroup")
    const hasMembers = hasMemberList && items.length > 0
    const group = layout === "grid" ? (
        <HeroAvatar
            className="starci-core-avatar starci-core-avatar-group"
            data-component="AvatarGroup"
            data-contract="COLLECTION-3 A11Y-2"
            data-tier="composite"
            data-grammar-avatar-size={size}
            data-grammar-avatar-layout="grid"
            data-grammar-avatar-cells={tiles.length}
            data-grammar-avatar-overflow={hidden > 0 ? "true" : "false"}
            size={vendorAvatarSize(size)}
        >
            {items.length === 0 ? avatarParts(label, undefined, undefined) : (
                <span className="starci-core-avatar-group-grid">
                    {tiles.map((tile) => {
                        if (tile.kind === "more") return (
                            <span aria-label={overflowLabel(tile.count)} className="starci-core-avatar-group-count" data-contract="A11Y-2" data-grammar-avatar-count="true" key="more" role="img">
                                <OverflowCount count={tile.count} />
                            </span>
                        )
                        const item = items[tile.index]
                        if (item === undefined) return null
                        return (
                            <HeroAvatar
                                key={item.id}
                                {...avatarA11yProps(item.name, false, item.kind)}
                                className="starci-core-avatar-group-member"
                                data-component="Avatar"
                                data-contract="A11Y-2"
                                data-grammar-avatar-kind={item.kind ?? "person"}
                                data-grammar-avatar-tone={itemTone(item)}
                                size={vendorAvatarSize(size)}
                            >
                                {avatarParts(item.name, item.src, item.fallback, item.seed, "default", item.mark)}
                            </HeroAvatar>
                        )
                    })}
                </span>
            )}
        </HeroAvatar>
    ) : (
        <HeroAvatarGroup
            className="starci-core-avatar-group"
            data-component="AvatarGroup"
            data-tier="composite"
            data-grammar-avatar-size={size}
            data-grammar-avatar-layout="row"
            data-grammar-avatar-overflow={hidden > 0 ? "true" : "false"}
            overlap="ring"
            size={vendorAvatarSize(size)}
        >
            {visible.map((item) => (
                <Avatar
                    key={item.id}
                    name={item.name}
                    size={size}
                    tone={itemTone(item)}
                    {...(item.src === undefined ? {} : { src: item.src })}
                    {...(item.seed === undefined ? {} : { seed: item.seed })}
                    {...(item.kind === undefined ? {} : { kind: item.kind })}
                    {...(item.mark === undefined ? {} : { mark: item.mark })}
                    {...(item.fallback === undefined ? {} : { fallback: item.fallback })}
                />
            ))}
            {hidden > 0 ? (
                <HeroAvatarGroup.Count aria-label={overflowLabel(hidden)} className="starci-core-avatar" data-contract="A11Y-2" data-grammar-avatar-size={size} data-grammar-avatar-count="true" role="img">
                    <OverflowCount count={hidden} />
                </HeroAvatarGroup.Count>
            ) : null}
        </HeroAvatarGroup>
    )
    return (
        <span
            role="group"
            aria-label={groupName}
            className="starci-core-avatar-group-trigger"
            data-grammar-avatar-group-trigger={layout}
            data-grammar-avatar-size={size}
            {...(hasMembers ? { ...members.triggerProps, "aria-controls": listId } : {})}
        >
            {group}
            {anchor}
            {hasMembers && container !== null ? (
                <AriaPopover
                    {...members.popoverProps}
                    triggerRef={members.triggerRef}
                    isOpen={members.isOpen}
                    isNonModal
                    placement="bottom start"
                    offset={8}
                    UNSTABLE_portalContainer={container}
                    className="popover starci-core-popover starci-core-avatar-group-popover"
                    data-size="sm"
                    data-grammar-overlay-surface="popover"
                    data-grammar-avatar-popover="true"
                >
                    <MemberList id={listId} label={label} items={items} agentLabel={agentLabel} />
                </AriaPopover>
            ) : null}
        </span>
    )
}

/**
 * A group of round items, people and marks together, in two sizes (`md` 40px, `sm` 24px); hover, focus or a tap opens the list of every member.
 * Contract: each item and the count A11Y-2; the group is named by `label` or `describe` and controls its member list.
 */
export const AvatarGroup = withRegionGeometry(AvatarGroupInner)
