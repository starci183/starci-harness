"use client"

import { Avatar as HeroAvatar, Badge as HeroBadge } from "@heroui/react"
import { CpuChipIcon } from "@heroicons/react/16/solid"
import { Avatar as DiceAvatar, Style } from "@dicebear/core"
import initials from "@dicebear/styles/initials.json" with { type: "json" }
import { useMemo, type CSSProperties, type ReactNode } from "react"
import { STARCI_CORE_DNA } from "../../dna.js"
import { navigationClassName } from "../../navigationClassNames.js"
import { Skeleton } from "../Skeleton/index.js"

/** `control` follows the shared 2.5rem (40px) control height. */
export type AvatarSize = "sm" | "md" | "lg" | "control"
export type AvatarKind = "person" | "agent"
export type AvatarShape = "circle" | "square" | "rounded"

/** The control size is drawn by the sheet over vendor `lg`. */
export const vendorAvatarSize = (size: AvatarSize): "sm" | "md" | "lg" => size === "control" ? "lg" : size

export type AvatarProps = {
    /** Free-text person or entity name; agents follow the same initials rule. */
    readonly name: string
    readonly src?: string
    /** Stable identity id determines the DiceBear initials background; otherwise `name` does. */
    readonly seed?: string
    readonly kind?: AvatarKind
    /** Custom uploaded-image fallback; otherwise the same DiceBear initials image remains. */
    readonly fallback?: ReactNode
    readonly size?: AvatarSize
    /** Circle by default; square keeps an uploaded brand mark un-clipped and contained. */
    readonly shape?: AvatarShape
    readonly isDecorative?: boolean
    readonly isCurrent?: boolean
    readonly className?: string
    /** Unresolved identity: an unnamed Skeleton; the owner carries aria-busy (STATE-8). */
    readonly isSkeleton?: boolean
}

/** First and last whitespace-delimited word; a one-word name contributes one initial. */
export const avatarInitials = (name: string): string => {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const edges = words.length < 2 ? words : [words[0] ?? "", words[words.length - 1] ?? ""]
    return edges.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase()
}

const avatarStyles = { initials }
const avatarStyleDefinition = avatarStyles[STARCI_CORE_DNA.avatar.style]

/** Replace DiceBear's seed-derived text with name-derived text, preserving its style and contrast resolver. */
export const avatarDataUri = (name: string, seed?: string, text = avatarInitials(name)): string => {
    const style = new Style({
        ...avatarStyleDefinition,
        components: {
            ...avatarStyleDefinition.components,
            letters: {
                ...avatarStyleDefinition.components.letters,
                variants: {
                    literal: {
                        elements: [{
                            ...avatarStyleDefinition.components.letters.variants.double.elements[0],
                            children: [{ type: "text", value: text }],
                        }],
                    },
                },
            },
        },
    })
    return new DiceAvatar(style, {
        seed: seed ?? name,
        borderRadius: STARCI_CORE_DNA.avatar.borderRadius,
        idRandomization: STARCI_CORE_DNA.avatar.idRandomization,
        initialsVariant: "alt",
        lettersVariant: "literal",
    }).toDataUri()
}

/** The generated image also fills the loading/error fallback; its contrast is independent of page theme. */
export const AvatarInitialsImage = ({ name, seed, text }: { readonly name: string; readonly seed?: string; readonly text?: string }) => {
    const imageSrc = useMemo(() => avatarDataUri(name, seed, text), [name, seed, text])
    // The same generated image is exposed as a variable so a narrow group cell can letterbox it and keep its solid background.
    return <img alt="" aria-hidden="true" className="starci-core-avatar-initials" src={imageSrc} style={{ "--starci-avatar-initials-src": `url("${imageSrc}")` } as CSSProperties} />
}

/** All entry points use the same local initials generator; an uploaded src wins. */
export const avatarParts = (name: string, src: string | undefined, fallback: ReactNode | undefined, seed?: string) => <>
    {src === undefined ? null : <HeroAvatar.Image alt="" src={src} />}
    <HeroAvatar.Fallback aria-hidden="true" data-grammar-avatar-fallback="true">
        {src !== undefined && fallback !== undefined ? fallback : <AvatarInitialsImage name={name} {...(seed === undefined ? {} : { seed })} />}
    </HeroAvatar.Fallback>
</>

export const avatarAccessibleName = (name: string, kind: AvatarKind = "person"): string => kind === "agent" ? `${name} (AI)` : name

export const avatarA11yProps = (name: string, isDecorative: boolean, kind: AvatarKind = "person") => isDecorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": avatarAccessibleName(name, kind) }

const avatarPixels: Readonly<Record<AvatarSize, number>> = { sm: 32, md: 40, lg: 48, control: 40 }

/** Multicolumn group cells pass their half-size scale; badges disappear below the DNA floor. */
export const AvatarAgentBadge = ({ children, kind, size, renderedScale = 1, className }: {
    readonly children: ReactNode; readonly kind: AvatarKind; readonly size: AvatarSize
    readonly renderedScale?: number; readonly className?: string
}) => kind !== "agent" || avatarPixels[size] * renderedScale < STARCI_CORE_DNA.avatar.agentBadgeMinSize ? children : (
    <HeroBadge.Anchor className={navigationClassName(`avatar avatar--${vendorAvatarSize(size)} starci-core-avatar-agent-anchor`, className)} data-grammar-avatar-size={size}>
        {children}
        <HeroBadge aria-hidden="true" className="starci-core-avatar-agent-badge" placement="bottom-right" size="sm">
            <HeroBadge.Label><CpuChipIcon aria-hidden="true" className="starci-core-avatar-agent-glyph" /></HeroBadge.Label>
        </HeroBadge>
    </HeroBadge.Anchor>
)

/** Uploaded image or local DiceBear initials, with the same person name rule for an AI agent (A11Y-2). */
export const Avatar = ({ name, src, seed, kind = "person", fallback, size = "md", shape = "circle", isDecorative = false, isCurrent = false, className, isSkeleton = false }: AvatarProps) => {
    const avatarClassName = navigationClassName("starci-core-avatar", kind === "agent" ? undefined : className)
    if (isSkeleton) return (
        <span aria-hidden="true" className={navigationClassName("starci-core-avatar starci-core-avatar-skeleton", className)}
            data-component="Avatar" data-contract="STATE-8" data-tier="atom" data-grammar-avatar-size={size}
            data-grammar-avatar-shape={shape} data-grammar-current="false" data-grammar-skeleton="true">
            <Skeleton shape="circle" size={vendorAvatarSize(size)} />
        </span>
    )
    return (
        <AvatarAgentBadge kind={kind} size={size} {...(className === undefined ? {} : { className })}>
            <HeroAvatar {...avatarA11yProps(name, isDecorative, kind)} className={avatarClassName}
                data-component="Avatar" data-contract="A11Y-2" data-tier="atom" data-grammar-avatar-size={size}
                data-grammar-avatar-shape={shape} data-grammar-avatar-kind={kind} data-grammar-current={isCurrent ? "true" : "false"}
                size={vendorAvatarSize(size)}>
                {avatarParts(name, src, fallback, seed)}
            </HeroAvatar>
        </AvatarAgentBadge>
    )
}
