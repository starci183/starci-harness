"use client"

import { withRegionLoading } from "../../regionScope.js"
import { Avatar as HeroAvatar } from "@heroui/react"
import { ChatBubbleOvalLeftEllipsisIcon } from "@heroicons/react/24/outline"
import { createElement, isValidElement, useMemo, type ComponentType, type CSSProperties, type ReactNode } from "react"
import { avatarDataUri } from "./dicebear.js"
import { agentToneOf, avatarHue, avatarInitials } from "./identity.js"
import { Skeleton } from "../Skeleton/index.js"
import type { IconSource } from "../Icon/index.js"
import type { NoChildren } from "../../tier.js"

/**
 * The two round-mark sizes (owner 2026-11-22: "giữ 2 size phổ biến 40 và 24 thôi, không có 32. 24 là size icon, avatargroup lúc này như icon, còn 40 là size phổ thông"):
 * `md` 40px, the common size (a header, a detail view, a list lead, the control height of a bar), and `sm` 24px, the icon size (inline beside text, in a table cell or
 * a chip, the agents on an account row). No other size exists.
 */
export type AvatarSize = "sm" | "md"
export type AvatarKind = "person" | "agent"
export type AvatarShape = "circle" | "square" | "rounded"

/** The vendor size each step stands on; the sheet draws `sm` at 24px (`--grammar-avatar-sm-size`) and `md` at 40px (`--grammar-avatar-md-size`). */
export const vendorAvatarSize = (size: AvatarSize): "sm" | "md" => size

export type AvatarProps = NoChildren & {
    /** Free-text person or entity name; agents follow the same initials rule. */
    readonly name: string
    readonly src?: string
    /** Stable identity id that picks the plate colour; otherwise `name` does. The same seed or name always gets the same colour. */
    readonly seed?: string
    /**
     * `agent` names the avatar for assistive technology ("Name (AI)") and, with no image, draws its initials on the AGENT TONE its seed (else its name) picks
     * (`agentToneOf`, common/tones-agent.css), the same colour the agent wears everywhere; the avatar draws no badge. The visible "AI" is the Chip `AgentName` puts after the name.
     */
    readonly kind?: AvatarKind
    /** A MARK instead of initials: an icon on a brand-colour circle, for a provider or a channel. `name` still names it. */
    readonly mark?: AvatarMark
    /** Replaces the initials while an uploaded `src` loads or fails. */
    readonly fallback?: ReactNode
    /** `md` 40px (default) or `sm` 24px; see `AvatarSize`. */
    readonly size?: AvatarSize
    /** Circle by default; square keeps an uploaded brand mark un-clipped and contained. */
    readonly shape?: AvatarShape
    readonly isDecorative?: boolean
    readonly isCurrent?: boolean
    /**
     * `accent`: the initials on the accent soft pair (a shop or workspace mark that belongs to the brand) instead of a generated colour
     * from the name. `solid` (0.46.0): the initials on the solid accent plate (`--accent` with `--accent-foreground`), the brand mark. `strong` (0.46.0): the initials on the
     * neutral strong plate (`--foreground` with `--background`), the signed-in person among the others. Default `default`: the generated colour that tells people apart.
     * `danger`: the default plate (or the mark) with a ring in the danger token, for a broken account; it is drawn in the avatar's own box, never as a wider hit area.
     */
    readonly tone?: AvatarTone
    /** Unresolved identity: an unnamed Skeleton; the owner carries aria-busy (STATE-8). */
    readonly isLoading?: boolean
}

export { avatarInitials, avatarHue, avatarGroupTiles, avatarGroupSlots, AVATAR_PALETTE, AGENT_TONES, agentToneOf, isAgentTone, type AgentTone, type AvatarTile } from "./identity.js"

/**
 * The generated avatar image (DiceBear Initials, drawn locally): two letters on a solid Grammar tone, the colour from `seed` (else the name). The same image
 * is exposed as a variable so a narrow group tile can letterbox it and keep its solid background.
 */
export const AvatarInitialsImage = ({ name, seed, text }: { readonly name: string; readonly seed?: string; readonly text?: string }) => {
    const imageSrc = useMemo(() => avatarDataUri(name, seed, text), [name, seed, text])
    return <img alt="" aria-hidden="true" className="starci-core-avatar-initials" src={imageSrc} style={{ "--starci-avatar-initials-src": `url("${imageSrc}")` } as CSSProperties} />
}

/** What an avatar with no image draws: the generated image, or, on an explicit plate `tone`, the letters in CSS. */
export const AvatarInitials = ({ name, seed, tone = "default" }: { readonly name: string; readonly seed?: string; readonly tone?: AvatarTone }) => {
    const plate = plateOf(tone)
    return (
        <HeroAvatar.Fallback aria-hidden="true" data-grammar-avatar-fallback="true" {...(plate === "default" ? { "data-grammar-avatar-hue": avatarHue(seed ?? name) } : {})}>
            {plate === "default" ? <AvatarInitialsImage name={name} {...(seed === undefined ? {} : { seed })} /> : <span className="starci-core-avatar-letters">{avatarInitials(name)}</span>}
        </HeroAvatar.Fallback>
    )
}

/**
 * What a MARK draws: its icon, centred on a circle of one colour. The colour is a Grammar token by default (`--accent` with `--accent-foreground`; `tone` picks
 * `accent`, `strong`) or a brand colour the app passes in as `color` (content, like `ColorSwatch`'s), with `ink` for the icon on it.
 */
export const AvatarMarkPlate = ({ mark }: { readonly mark: AvatarMark }) => (
    <HeroAvatar.Fallback
        aria-hidden="true"
        data-grammar-avatar-fallback="true"
        data-grammar-avatar-mark={mark.color === undefined ? mark.tone ?? "solid" : "brand"}
        style={{
            ...(mark.color === undefined ? {} : { "--starci-avatar-mark-plate": mark.color }),
            ...(mark.ink === undefined ? {} : { "--starci-avatar-mark-ink": mark.ink }),
        } as CSSProperties}
    >
        <span className="starci-core-avatar-mark-icon" data-grammar-avatar-logo={mark.logo === undefined ? "generic" : "app"}>{markLogo(mark.logo)}</span>
    </HeroAvatar.Fallback>
)

/** The logo of a mark: the app's node, the app's icon source drawn as a decorative glyph, or (none passed) the generic channel glyph; never initials. */
const markLogo = (logo: AvatarMark["logo"]): ReactNode => {
    if (logo === undefined) return <ChatBubbleOvalLeftEllipsisIcon aria-hidden="true" focusable="false" />
    // An icon source is a component: a function, or a forwardRef or memo object (Heroicons), never an element.
    if (typeof logo === "function" || (typeof logo === "object" && logo !== null && !isValidElement(logo) && "$$typeof" in logo)) {
        return createElement(logo as unknown as ComponentType<{ "aria-hidden": boolean; focusable: "false" }>, { "aria-hidden": true, focusable: "false" })
    }
    return logo as ReactNode
}

/** An uploaded image wins over the initials or the mark; those stay under it while it loads or fails. A custom `fallback` replaces them. */
export const avatarParts = (name: string, src: string | undefined, fallback: ReactNode | undefined, seed?: string, tone: AvatarTone = "default", mark?: AvatarMark) => <>
    {src === undefined ? null : <HeroAvatar.Image alt="" src={src} />}
    {src !== undefined && fallback !== undefined
        ? <HeroAvatar.Fallback aria-hidden="true" data-grammar-avatar-fallback="true">{fallback}</HeroAvatar.Fallback>
        : mark !== undefined
            ? <AvatarMarkPlate mark={mark} />
            : <AvatarInitials name={name} tone={tone} {...(seed === undefined ? {} : { seed })} />}
</>

export const avatarAccessibleName = (name: string, kind: AvatarKind = "person"): string => kind === "agent" ? `${name} (AI)` : name

export const avatarA11yProps = (name: string, isDecorative: boolean, kind: AvatarKind = "person") => isDecorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": avatarAccessibleName(name, kind) }

/**
 * The plate an avatar with no image puts its initials on (0.46.0 adds `solid` and `strong`); `danger` is the default plate with a danger ring. `agent` (0.55.1) is the agent
 * tone of the seed, the soft pair of one hue; an agent avatar takes it by default.
 */
export type AvatarTone = "default" | "accent" | "solid" | "strong" | "danger" | "agent"

/** The plate of a tone: `danger` only adds the ring, the plate stays the generated one. */
const plateOf = (tone: AvatarTone): Exclude<AvatarTone, "danger"> => tone === "danger" ? "default" : tone

/**
 * A MARK (0.55.0): the round identity of a provider or a channel, its brand LOGO on a circle of one colour, shown beside people in the same `AvatarGroup`. It is
 * decorative (the avatar's `name` names it). A provider always shows its real brand logo, never initials ("ZA", "FA"): Grammar ships no brand logos, the app
 * passes its own through `logo` (owner 2026-11-22, overview-v2).
 */
export type AvatarMark = {
    /**
     * The app's brand logo (Zalo, Facebook, TikTok, Messenger, Google…), drawn at the avatar's own size share and centred: a node (an inline SVG, an image) or an
     * icon source. Omitted, the mark draws the generic channel glyph, never initials.
     */
    readonly logo?: ReactNode | IconSource
    /** A brand colour as the circle's fill, passed in as content (a CSS colour such as `#1877f2`); it wins over `tone`. Give `ink` for the icon on it. */
    readonly color?: string
    /** The icon's colour on a brand `color`; `--accent-foreground` when omitted. */
    readonly ink?: string
    /** A Grammar token plate when there is no brand `color`: `solid` (the default, `--accent`), `accent` (the soft pair) or `strong` (`--foreground`). */
    readonly tone?: Exclude<AvatarTone, "default" | "danger" | "agent">
}

const AvatarInner = ({ name, src, seed, kind = "person", mark, fallback, size = "md", shape = "circle", isDecorative = false, isCurrent = false, tone = "default", isLoading = false }: AvatarProps) => {
    const avatarClassName = "starci-core-avatar"
    // an agent wears its own tone unless the caller chose a plate: the same colour as its IconTile and every other mark of it
    const plate: AvatarTone = kind === "agent" && tone === "default" && mark === undefined ? "agent" : tone
    if (isLoading) return (
        <span aria-hidden="true" className={"starci-core-avatar starci-core-avatar-skeleton"}
            data-component="Avatar" data-contract="STATE-8" data-tier="leaf" data-grammar-avatar-size={size}
            data-grammar-avatar-shape={shape} data-grammar-current="false" data-grammar-skeleton="true">
            <Skeleton shape="circle" size={vendorAvatarSize(size)} />
        </span>
    )
    return (
        <HeroAvatar {...avatarA11yProps(name, isDecorative, kind)} className={avatarClassName}
            data-component="Avatar" data-contract="A11Y-2" data-tier="leaf" data-grammar-avatar-size={size}
            data-grammar-avatar-shape={shape} data-grammar-avatar-kind={kind} data-grammar-current={isCurrent ? "true" : "false"}
            data-grammar-avatar-tone={plate}
            {...(plate === "agent" ? { "data-grammar-agent-tone": agentToneOf(seed ?? name) } : {})}
            size={vendorAvatarSize(size)}>
            {avatarParts(name, src, fallback, seed, plate, mark)}
        </HeroAvatar>
    )
}

/**
 * An uploaded image, else two initials from DiceBear's Initials style on a colour the seed always gets (the rule and palette are in `identity.ts`), or a MARK (an
 * icon on a brand-colour circle). It carries no AI badge: an agent's "AI" is the Chip after its name (`AgentName`).
 * Contract: A11Y-2 (named once; the initials and the mark are silent).
 */
export const Avatar = withRegionLoading(AvatarInner)
