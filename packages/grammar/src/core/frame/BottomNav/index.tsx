"use client"

import { Button as AriaButton, Link as AriaLink } from "react-aria-components"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { iconButtonBadgeText } from "../../leaf/IconButton/index.js"
import { Sidebar, type SidebarGroup } from "../../composite/Sidebar/index.js"
import type { NavigationBadgeTone } from "../../navigationBadgeTone.js"
import type { NoChildren } from "../../tier.js"
import { Drawer } from "../Drawer/index.js"
import { BOTTOM_NAV_MAX_PLACES, type BottomNavItem, type BottomNavMore } from "./data.js"

export type BottomNavProps = NoChildren & {
    /** The places of the bar, in order: two to four with a `more`, two to five without. */
    readonly items: ReadonlyArray<BottomNavItem>
    /** A place of `items` or of `more.items`; the bar marks it (`aria-current="page"`), and the "more" place when it is in the sheet. */
    readonly selectedKey?: string
    readonly more?: BottomNavMore
    /** A place was chosen (a link's press too); a sheet place closes the sheet. */
    readonly onAction?: (id: string) => void
}

type Place = {
    readonly label: string
    readonly source: IconSource
    readonly badge?: number | string
    readonly badgeLabel?: string
    readonly badgeMax?: number
    readonly badgeTone?: NavigationBadgeTone
}

/** The glyph, its count and the name: one place's content, the same for a link, a command and the "more" place. */
const PlaceContent = ({ label, source, badge, badgeMax, badgeTone }: Place) => {
    const badgeText = iconButtonBadgeText(badge, badgeMax)
    return (
        <>
            <span className="starci-core-bottom-nav-glyph" data-grammar-bottom-nav-glyph="true">
                <Icon source={source} usage="control" />
                {badgeText === null ? null : <span aria-hidden="true" className="starci-core-icon-button-badge starci-core-bottom-nav-badge" data-grammar-badge-tone={badgeTone ?? "neutral"}>{badgeText}</span>}
            </span>
            <span className="starci-core-bottom-nav-label">{label}</span>
        </>
    )
}

const nameProps = ({ label, badge, badgeLabel, badgeMax }: Place): { readonly "aria-label"?: string } => {
    const badgeText = iconButtonBadgeText(badge, badgeMax)
    return badgeText === null ? {} : { "aria-label": `${label}, ${badgeLabel ?? badgeText}` }
}

/**
 * FRAME - `BottomNav` (0.46.0): the compact width's bar of the places used every day, drawn at the foot of the phone: a glyph, its name and
 * an optional count each, one of them current, and an optional last place, "more", that opens a bottom sheet of the rest. It stands only in
 * `WorkspaceShell` `compactNavigation`, whose `<nav aria-label>` (`compactNavigationLabel`) is the landmark and which shows it below the wide
 * breakpoint, so the bar draws its own list and no second landmark. The bar keeps the device's bottom safe area (`env(safe-area-inset-bottom)`,
 * with the page's `viewport-fit=cover`).
 *
 * The sheet is a bottom `Drawer` holding a `Sidebar presentation="drawer"` of the places, so a place has one look in the drawer, the rail
 * and the sheet, and its count takes the same tones.
 * Contract: FE-APP-SHELL-4 (compact navigation), A11Y-2 (every place has a name), `aria-current` on the current place.
 */
export const BottomNav = ({ items, selectedKey, more, onAction }: BottomNavProps) => {
    const places = items.length + (more === undefined ? 0 : 1)
    if (process.env.NODE_ENV !== "production" && (places < 2 || places > BOTTOM_NAV_MAX_PLACES)) {
        throw new Error(`BottomNav draws two to ${BOTTOM_NAV_MAX_PLACES} places, the "more" place included; it was given ${places}. Put the rest in \`more.items\` or \`more.groups\`.`)
    }
    if (process.env.NODE_ENV !== "production" && more !== undefined && (more.items === undefined) === (more.groups === undefined)) {
        throw new Error("BottomNav `more` takes `items` (flat) or `groups` (under headings), one of them.")
    }
    const moreGroups: ReadonlyArray<SidebarGroup> = more === undefined ? [] : (more.groups ?? [{ id: "more", items: more.items ?? [] }])
    const moreIsCurrent = selectedKey !== undefined && moreGroups.some((group) => group.items.some((item) => item.id === selectedKey))
    return (
        <div data-tier="frame" data-component="BottomNav" data-contract="FE-APP-SHELL-4 A11Y-2 BOUNDARY-1" className="starci-core-bottom-nav">
            <ul className="starci-core-bottom-nav-list" data-grammar-bottom-nav-places={places}>
                {items.map((item) => {
                    const isCurrent = selectedKey === item.id
                    const common = {
                        className: "starci-core-bottom-nav-item",
                        "data-grammar-bottom-nav-item": "true",
                        "data-grammar-current": isCurrent ? "true" : "false",
                        onPress: () => onAction?.(item.id),
                    } as const
                    return (
                        <li key={item.id} className="starci-core-bottom-nav-place">
                            {item.href === undefined
                                ? <AriaButton {...common} {...nameProps(item)} type="button" {...(isCurrent ? { "aria-current": "page" as const } : {})}><PlaceContent {...item} /></AriaButton>
                                : <AriaLink {...common} {...nameProps(item)} href={item.href} {...(isCurrent ? { "aria-current": "page" as const } : {})}><PlaceContent {...item} /></AriaLink>}
                        </li>
                    )
                })}
                {more === undefined ? null : (
                    <li className="starci-core-bottom-nav-place">
                        <Drawer
                            title={more.label}
                            closeLabel={more.closeLabel}
                            placement="bottom"
                            bodyInset="none"
                            trigger={(
                                <AriaButton
                                    className="starci-core-bottom-nav-item"
                                    data-grammar-bottom-nav-item="true"
                                    data-grammar-bottom-nav-more="true"
                                    data-grammar-current={moreIsCurrent ? "true" : "false"}
                                    {...nameProps(more)}
                                    type="button"
                                >
                                    <PlaceContent {...more} />
                                </AriaButton>
                            )}
                        >
                            <Sidebar
                                presentation="drawer"
                                label={more.label}
                                groups={moreGroups}
                                {...(selectedKey === undefined ? {} : { selectedKey })}
                                {...(onAction === undefined ? {} : { onAction })}
                            />
                        </Drawer>
                    </li>
                )}
            </ul>
        </div>
    )
}
