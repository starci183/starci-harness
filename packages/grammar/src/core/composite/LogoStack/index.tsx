"use client"

import { withRegionGeometry } from "../../regionScope.js"
import { avatarInitials } from "../../leaf/Avatar/index.js"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { PlainPressable } from "../../PlainPressable.js"
import type { NoChildren } from "../../tier.js"

export type LogoStackItem = {
    readonly id: string
    /** Names the logo for assistive technology, e.g. the provider ("Gmail"). */
    readonly label: string
    /** A provider logo image. Wins over `iconSource`. */
    readonly src?: string
    /** An app icon glyph, drawn at the 20px icon step. Used when there is no `src`. */
    readonly iconSource?: IconSource
}

export type LogoStackProps = NoChildren & {
    /** Names the whole group, e.g. "Connections used by this agent". Names the pressable when the group is one. */
    readonly label: string
    readonly items: ReadonlyArray<LogoStackItem>
    /** Round logos shown before the rest collapse into one "+N" pill. Default 3. */
    readonly max?: number
    /** A muted xs line below the logos, e.g. "3 kết nối". */
    readonly caption?: string
    /** Makes the whole group one plain pressable. Without it (and without `isTrigger`) the group is static. */
    readonly onPress?: () => void
    /** Set when the group is the `trigger` of a `DropdownMenu` or `Popover`: it renders as the plain pressable the menu needs. */
    readonly isTrigger?: boolean
    readonly isDisabled?: boolean
    /** Lays the real group out unseen under a shimmer; a loading region does the same. */
    readonly isLoading?: boolean
}

const LogoMark = ({ item, isDecorative }: { readonly item: LogoStackItem; readonly isDecorative: boolean }) => {
    const a11y = isDecorative ? { "aria-hidden": true } : { role: "img", "aria-label": item.label }
    return (
        <span className="starci-core-logo-stack-logo" data-grammar-logo-stack-part="logo" {...a11y}>
            {item.src !== undefined ? (
                <img className="starci-core-logo-stack-image" src={item.src} alt="" draggable={false} />
            ) : item.iconSource !== undefined ? (
                <Icon source={item.iconSource} usage="leading" />
            ) : (
                <span className="starci-core-logo-stack-initial" aria-hidden>{avatarInitials(item.label).slice(0, 1)}</span>
            )}
        </span>
    )
}

/**
 * The connections an agent uses, as a row of round logos with no plate: at most `max`, then a "+N" pill, and an optional muted caption.
 * The logos stand one identity gap (4) apart, not overlapped: with no plate or ring, an overlap would cut one brand mark with the next.
 * Static by default; with `onPress`, or as `isTrigger` of a DropdownMenu, the whole group is one PlainPressable (no button fill, a focus ring).
 * Contract: A11Y-2 (the group is named once by `label`; inside a pressable the logos are decorative), FOCUS-1 (the pressable ring).
 */
const LogoStackInner = ({ label, items, max = 3, caption, onPress, isTrigger = false, isDisabled }: LogoStackProps) => {
    const capacity = Math.max(0, max)
    const visible = items.slice(0, capacity)
    const hidden = items.length - visible.length
    const isPressable = onPress !== undefined || isTrigger
    const body = (
        <span className="starci-core-logo-stack" data-tier="composite" data-component="LogoStack" data-contract="A11Y-2" data-grammar-logo-stack-overflow={hidden > 0 ? "true" : "false"}>
            <span className="starci-core-logo-stack-logos" data-grammar-logo-stack-part="logos">
                {visible.map((item) => <LogoMark key={item.id} item={item} isDecorative={isPressable} />)}
                {hidden > 0 ? <span className="starci-core-logo-stack-count" data-grammar-logo-stack-part="count" aria-hidden>{`+${hidden}`}</span> : null}
            </span>
            {caption === undefined ? null : <span className="starci-core-logo-stack-caption" data-grammar-logo-stack-part="caption">{caption}</span>}
        </span>
    )
    if (isPressable) {
        return (
            <PlainPressable aria-label={label} {...(onPress === undefined ? {} : { onPress })} {...(isDisabled === undefined ? {} : { isDisabled })}>
                {body}
            </PlainPressable>
        )
    }
    return <span className="starci-core-logo-stack-group" role="group" aria-label={label}>{body}</span>
}

/**
 * The connections an agent uses, as a row of round logos with no plate: at most `max`, then a "+N" pill, and an optional muted caption.
 * Static by default; with `onPress`, or as `isTrigger` of a DropdownMenu, the whole group is one PlainPressable.
 * Contract: A11Y-2, FOCUS-1.
 */
export const LogoStack = withRegionGeometry(LogoStackInner)
