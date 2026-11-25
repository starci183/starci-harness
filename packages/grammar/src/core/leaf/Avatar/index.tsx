"use client"

import { withRegionLoading } from "../../regionScope.js"
import { Avatar as HeroAvatar } from "@heroui/react"
import { createElement, isValidElement, useMemo, type ComponentType, type CSSProperties, type ReactNode } from "react"
import { avatarDataUri } from "./dicebear.js"
import { avatarHue, avatarInitials } from "./identity.js"
import { Skeleton } from "../Skeleton/index.js"
import type { IconSource } from "../Icon/index.js"
import type { NoChildren } from "../../tier.js"
import { isToneSlot, toneSlotStyle, type ToneSlot } from "../../toneSlot.js"
import { TablerMessageDots } from "../Icon/tabler.js"
import { CHANNEL_LOGOS } from "./channelLogos.js"

/**
 * The two round-mark sizes (owner 2026-11-22: "giữ 2 size phổ biến 40 và 24 thôi, không có 32. 24 là size icon, avatargroup lúc này như icon, còn 40 là size phổ thông"):
 * `md` 40px, the common size (a header, a detail view, a list lead, the control height of a bar), and `sm` 24px, the icon size (inline beside text, in a table cell or
 * a chip, the agents on an account row). No other size exists.
 */
export type AvatarSize = "sm" | "md"
/**
 * `person` and `agent` are people; `logo` is a brand or channel logo image (Google, Facebook, Zalo…, the app's `src`) on a white surface whatever the
 * theme, so its brand colours stay true in dark mode, fitted whole inside the circle with a hairline edge. A logo row is an `AvatarGroup` of them, and a
 * lone logo is an `Avatar` of the same `size` (owner 2026-11-23: sized by the `size` prop only, never by hand).
 */
export type AvatarKind = "person" | "agent" | "logo"
export type AvatarShape = "circle" | "square" | "rounded"

/**
 * The channel a customer writes from, drawn as a small round badge on the avatar's corner (`Avatar channel`): the brand logos of `CHANNEL_LOGOS` (simple-icons:
 * Messenger, Instagram, Facebook, Zalo, WhatsApp, Telegram, TikTok, Gmail, LINE, Viber, WeChat, X, YouTube, Discord, Google Chat) and Grammar's own `email` envelope for a
 * mailbox no brand names.
 */
export type AvatarChannel = keyof typeof CHANNEL_LOGOS | "email"

/** The vendor size each step stands on; the sheet draws `sm` at 24px (`--grammar-avatar-sm-size`) and `md` at 40px (`--grammar-avatar-md-size`). */
export const vendorAvatarSize = (size: AvatarSize): "sm" | "md" => size

export type AvatarProps = NoChildren & {
    /** Free-text person or entity name; agents follow the same initials rule. */
    readonly name: string
    readonly src?: string
    /** Stable identity id that picks the plate colour; otherwise `name` does. The same seed or name always gets the same colour. */
    readonly seed?: string
    /** `agent` only names the avatar for assistive technology ("Name (AI)"); the avatar draws no badge. The visible "AI" is the Chip `AgentName` puts after the name. */
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
     * A `ToneSlot` (`{ soft, ink }`, 0.55.1): the initials on the app's own soft pair, for an identity palette the app owns (which colour a team or an agent wears).
     */
    readonly tone?: AvatarTone | ToneSlot
    /**
     * The channel this person writes from (0.60.0, owner 2026-11-26): a small round badge with the channel's logo on the avatar's bottom end corner, on a white plate
     * ringed in the surface so it reads on a photo and on initials alike. It is outside the avatar's round clip, never inside it. The badge is named by `channelLabel`
     * (the brand's own name when omitted) so the avatar and its channel are one image for assistive technology.
     */
    readonly channel?: AvatarChannel
    /** The channel's name in the app's language ("Email", "Tin nhắn Zalo"); the brand's name when omitted. Only with `channel`. */
    readonly channelLabel?: string
    /** Unresolved identity: an unnamed Skeleton; the owner carries aria-busy (STATE-8). */
    readonly isLoading?: boolean
}

export { avatarInitials, avatarHue, avatarGroupTiles, avatarGroupSlots, avatarClusterCells, AVATAR_PALETTE, type AvatarTile, type AvatarClusterCell, type AvatarClusterSlot } from "./identity.js"
export { CHANNEL_LOGOS } from "./channelLogos.js"

/**
 * The generated avatar image (DiceBear Initials, drawn locally): two letters on a solid Grammar tone, the colour from `seed` (else the name). The same image
 * is exposed as a variable so a narrow group tile can letterbox it and keep its solid background.
 */
export const AvatarInitialsImage = ({ name, seed, text }: { readonly name: string; readonly seed?: string; readonly text?: string }) => {
    const imageSrc = useMemo(() => avatarDataUri(name, seed, text), [name, seed, text])
    return <img alt="" aria-hidden="true" className="starci-core-avatar-initials" src={imageSrc} style={{ "--starci-avatar-initials-src": `url("${imageSrc}")` } as CSSProperties} />
}

/** What an avatar with no image draws: the generated image, or, on an explicit plate `tone` (a named plate or the app's `slot`), the letters in CSS. */
export const AvatarInitials = ({ name, seed, tone = "default" }: { readonly name: string; readonly seed?: string; readonly tone?: AvatarPlate }) => {
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
    if (logo === undefined) return <TablerMessageDots aria-hidden="true" focusable="false" />
    // An icon source is a component: a function, or a forwardRef or memo object (Heroicons), never an element.
    if (typeof logo === "function" || (typeof logo === "object" && logo !== null && !isValidElement(logo) && "$$typeof" in logo)) {
        return createElement(logo as unknown as ComponentType<{ "aria-hidden": boolean; focusable: "false" }>, { "aria-hidden": true, focusable: "false" })
    }
    return logo as ReactNode
}

/** An uploaded image wins over the initials or the mark; those stay under it while it loads or fails. A custom `fallback` replaces them. */
export const avatarParts = (name: string, src: string | undefined, fallback: ReactNode | undefined, seed?: string, tone: AvatarPlate = "default", mark?: AvatarMark) => <>
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

/** The plate an avatar with no image puts its initials on (0.46.0 adds `solid` and `strong`); `danger` is the default plate with a danger ring. */
export type AvatarTone = "default" | "accent" | "solid" | "strong" | "danger"

/** What the avatar's `data-grammar-avatar-tone` says: a named tone, or `slot` for an app's `ToneSlot` (its pair rides on two variables). */
export type AvatarPlate = AvatarTone | "slot"

/** The attribute value of a tone prop and, for a slot, the variables that carry its pair. */
export const avatarToneProps = (tone: AvatarTone | ToneSlot): { readonly plate: AvatarPlate; readonly style?: CSSProperties } =>
    isToneSlot(tone) ? { plate: "slot", style: toneSlotStyle(tone) } : { plate: tone }

/** The plate of a tone: `danger` only adds the ring, the plate stays the generated one. */
const plateOf = (tone: AvatarPlate): Exclude<AvatarPlate, "danger"> => tone === "danger" ? "default" : tone

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
    readonly tone?: Exclude<AvatarTone, "default" | "danger">
}

/** The badge: one logo on a round plate. The brand colour is a token of ramps.css chosen by the channel attribute; the envelope is Grammar's own outline mark. */
export const AvatarChannelBadge = ({ channel, label }: { readonly channel: AvatarChannel; readonly label?: string }) => {
    const brand = channel === "email" ? undefined : CHANNEL_LOGOS[channel]
    const name = label ?? brand?.label ?? "Email"
    return (
        <span
            role="img"
            aria-label={name}
            className="starci-core-avatar-channel"
            data-component="AvatarChannel"
            data-grammar-avatar-channel={channel}
        >
            {brand === undefined ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <rect x={3} y={5} width={18} height={14} rx={2.5} />
                    <path d="m3.5 7.5 8.5 6 8.5-6" />
                </svg>
            ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d={brand.path} /></svg>
            )}
        </span>
    )
}

const AvatarInner = ({ name, src, seed, kind = "person", mark, fallback, size = "md", shape = "circle", isDecorative = false, isCurrent = false, tone = "default", channel, channelLabel, isLoading = false }: AvatarProps) => {
    const avatarClassName = "starci-core-avatar"
    const { plate, style } = avatarToneProps(tone)
    if (isLoading) return (
        <span aria-hidden="true" className={"starci-core-avatar starci-core-avatar-skeleton"}
            data-component="Avatar" data-contract="STATE-8" data-tier="leaf" data-grammar-avatar-size={size}
            data-grammar-avatar-shape={shape} data-grammar-current="false" data-grammar-skeleton="true">
            <Skeleton shape="circle" size={vendorAvatarSize(size)} />
        </span>
    )
    const avatar = (
        <HeroAvatar {...avatarA11yProps(name, isDecorative, kind)} className={avatarClassName}
            data-component="Avatar" data-contract="A11Y-2" data-tier="leaf" data-grammar-avatar-size={size}
            data-grammar-avatar-shape={shape} data-grammar-avatar-kind={kind} data-grammar-current={isCurrent ? "true" : "false"}
            data-grammar-avatar-tone={plate}
            {...(style === undefined ? {} : { style })}
            size={vendorAvatarSize(size)}>
            {avatarParts(name, src, fallback, seed, plate, mark)}
        </HeroAvatar>
    )
    if (channel === undefined) return avatar
    return (
        <span className="starci-core-avatar-badged" data-grammar-avatar-size={size} data-grammar-avatar-badged="true">
            {avatar}
            <AvatarChannelBadge channel={channel} {...(channelLabel === undefined ? {} : { label: channelLabel })} />
        </span>
    )
}

/**
 * An uploaded image, else two initials from DiceBear's Initials style on a colour the seed always gets (the rule and palette are in `identity.ts`), or a MARK (an
 * icon on a brand-colour circle). It carries no AI badge: an agent's "AI" is the Chip after its name (`AgentName`).
 * Contract: A11Y-2 (named once; the initials and the mark are silent).
 */
export const Avatar = withRegionLoading(AvatarInner)
