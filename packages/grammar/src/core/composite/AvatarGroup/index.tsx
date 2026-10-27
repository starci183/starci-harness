"use client"

import { Avatar as HeroAvatar, AvatarGroup as HeroAvatarGroup } from "@heroui/react"
import type { ReactNode } from "react"
import { Avatar, AvatarAgentBadge, AvatarInitialsImage, avatarA11yProps, avatarParts, vendorAvatarSize, type AvatarKind, type AvatarSize } from "../../primitive/Avatar/index.js"
import { navigationClassName } from "../../navigationClassNames.js"

export type AvatarGroupItem = {
    readonly id: string
    readonly name: string
    readonly src?: string
    /** Stable identity id determines the local DiceBear initials background; otherwise `name` does. */
    readonly seed?: string
    readonly kind?: AvatarKind
    /** Custom uploaded-image fallback; otherwise the same DiceBear initials image remains. */
    readonly fallback?: ReactNode
}

export type AvatarGroupProps = {
    /** Names the group, e.g. who is in a space. */
    readonly label: string
    readonly items: ReadonlyArray<AvatarGroupItem>
    /** `row` stacks members; `grid` makes one round group identity, the size of a single Avatar. */
    readonly layout?: "row" | "grid"
    /** Visible avatars in `row` before the rest collapse into an overflow count. The grid always has at most four cells. */
    readonly max?: number
    readonly size?: AvatarSize
    /** App-owned accessible text for hidden members in either layout, e.g. "3 more people". Grid digits show the total. */
    readonly overflowLabel: (hiddenCount: number) => string
    readonly className?: string
}

/**
 * A stacked member row or one round composite group identity with an accessible overflow count.
 * Grid layout splits two members, places one above two for three members, and uses a 2-by-2 grid for four.
 * With five or more members, the fourth grid cell shows the total member count beside three avatars.
 * Contract: each avatar and count A11Y-2 (named once, fallback initials and overflow digits silent).
 */
export const AvatarGroup = ({ label, items, layout = "row", max = 4, size = "md", overflowLabel, className }: AvatarGroupProps) => {
    const capacity = layout === "grid" ? (items.length > 4 ? 3 : 4) : Math.max(0, max)
    const visible = items.slice(0, capacity)
    const hidden = items.length - visible.length
    if (layout === "grid") return (
        <AvatarAgentBadge kind={visible.some((item) => item.kind === "agent") ? "agent" : "person"} size={size} renderedScale={visible.length > 1 || hidden > 0 ? 0.5 : 1}>
        <HeroAvatar
            aria-label={label}
            className={navigationClassName("starci-core-avatar starci-core-avatar-group", className)}
            data-component="AvatarGroup"
            data-contract="COLLECTION-3 A11Y-2"
            data-tier="composite"
            data-grammar-avatar-size={size}
            data-grammar-avatar-layout="grid"
            data-grammar-avatar-cells={visible.length + (hidden > 0 ? 1 : 0)}
            data-grammar-avatar-overflow={hidden > 0 ? "true" : "false"}
            role="group"
            size={vendorAvatarSize(size)}
        >
            {items.length === 0 ? avatarParts(label, undefined, undefined) : (
                <span className="starci-core-avatar-group-grid">
                    {visible.map((item) => (
                        <HeroAvatar
                            key={item.id}
                            {...avatarA11yProps(item.name, false, item.kind)}
                            className="starci-core-avatar-group-member"
                            data-component="Avatar"
                            data-contract="A11Y-2"
                            data-grammar-avatar-kind={item.kind ?? "person"}
                            data-grammar-agent-badge={visible.length > 1 || hidden > 0 ? "below-size-floor" : undefined}
                            size={vendorAvatarSize(size)}
                        >
                            {avatarParts(item.name, item.src, item.fallback, item.seed)}
                        </HeroAvatar>
                    ))}
                    {hidden > 0 ? (
                        <span aria-label={overflowLabel(hidden)} className="starci-core-avatar-group-count" data-contract="A11Y-2" data-grammar-avatar-count="true" role="img">
                            <AvatarInitialsImage name={label} text={String(items.length)} />
                        </span>
                    ) : null}
                </span>
            )}
        </HeroAvatar>
        </AvatarAgentBadge>
    )
    return (
        <HeroAvatarGroup
            aria-label={label}
            className={navigationClassName("starci-core-avatar-group", className)}
            data-component="AvatarGroup"
            data-tier="composite"
            data-grammar-avatar-layout="row"
            data-grammar-avatar-overflow={hidden > 0 ? "true" : "false"}
            overlap="ring"
            role="group"
            size={vendorAvatarSize(size)}
        >
            {visible.map((item) => (
                <Avatar
                    key={item.id}
                    name={item.name}
                    size={size}
                    {...(item.src === undefined ? {} : { src: item.src })}
                    {...(item.seed === undefined ? {} : { seed: item.seed })}
                    {...(item.kind === undefined ? {} : { kind: item.kind })}
                    {...(item.fallback === undefined ? {} : { fallback: item.fallback })}
                />
            ))}
            {hidden > 0 ? (
                <HeroAvatarGroup.Count aria-label={overflowLabel(hidden)} className="starci-core-avatar" data-contract="A11Y-2" data-grammar-avatar-size={size} data-grammar-avatar-count="true" role="img">
                    <AvatarInitialsImage name={label} text={`+${hidden}`} />
                </HeroAvatarGroup.Count>
            ) : null}
        </HeroAvatarGroup>
    )
}
