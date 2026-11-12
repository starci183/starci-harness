"use client"

import { Button as HeroButton } from "@heroui/react"
import { createContext, useContext, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from "react"
import { SurfaceNesting } from "../../surfaceContext.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { glyphSource, type GlyphName } from "../../leaf/Icon/glyphs.js"
import type { DropdownMenuItem } from "../../branch/DropdownMenu/index.js"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import type { NoChildren } from "../../tier.js"

export type TopBarMenu = {
    readonly icon: ReactNode
    readonly openLabel: string
    readonly closeLabel: string
    readonly isOpen: boolean
    readonly onOpenChange: (isOpen: boolean) => void
    /** Id of the drawer/menu region the trigger opens (`aria-controls`). */
    readonly controls?: string
    /** `compact` shows the trigger only below 48rem, where `navigation` leaves the bar. */
    readonly visibility?: "compact" | "always"
}

/**
 * An app-owned command in the bar's end cluster (0.37.15), before the app's fixed cluster (language, theme, account): a round outline icon button of the same kind as the
 * language button. `label` is its accessible name; `badge` draws the attention dot when work is waiting. Exactly one of `onPress` (a command) or `href` (a destination).
 * At phone width only the FIRST stays in the bar; the rest are offered by `useTopBarOverflowEntries()` for the account menu.
 */
export type TopBarCustomButton = {
    readonly id: string
    readonly glyph: GlyphName
    readonly label: string
    readonly badge?: boolean
} & (
    | { readonly onPress: () => void; readonly href?: never }
    | { readonly href: string; readonly onPress?: never }
)

const PHONE_MAX_PX = 767.68
const PHONE_QUERY = `(max-width: ${PHONE_MAX_PX}px)`
const subscribePhone = (notify: () => void) => {
    if (typeof window === "undefined") return () => undefined
    const query = window.matchMedia(PHONE_QUERY)
    query.addEventListener("change", notify)
    return () => query.removeEventListener("change", notify)
}
const isPhone = () => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches

const TopBarOverflowContext = createContext<readonly TopBarCustomButton[]>([])

/**
 * The entries (glyph + label) of the custom buttons that left the bar at phone width (0.37.15: all but the first), for the account menu to append to its own entries. Empty above
 * 48rem and outside a `TopBar`. The app's account `DropdownMenu` spreads it: `entries={[...accountEntries, ...useTopBarOverflowEntries()]}`.
 */
export const useTopBarOverflowEntries = (): readonly DropdownMenuItem[] => {
    const buttons = useContext(TopBarOverflowContext)
    const phone = useSyncExternalStore(subscribePhone, isPhone, () => false)
    if (!phone) return []
    return buttons.slice(1).map((button): DropdownMenuItem => ({
        id: `top-bar-custom-${button.id}`,
        label: button.label,
        iconSource: glyphSource(button.glyph),
        ...(button.href === undefined ? { onAction: button.onPress } : { href: button.href }),
    }))
}

const CustomButtons = ({ buttons }: { readonly buttons: readonly TopBarCustomButton[] }) => (
    <div className="starci-core-top-bar-custom" data-grammar-top-bar-custom="true">
        {buttons.map((button) => (
            <span key={button.id} className="starci-core-top-bar-custom-item" data-grammar-top-bar-custom-item={button.id} data-grammar-attention={button.badge === true ? "true" : undefined}>
                {button.href === undefined
                    ? <IconButton intent="dismiss" source={glyphSource(button.glyph)} label={button.label} onPress={button.onPress} />
                    : <IconButton intent="dismiss" source={glyphSource(button.glyph)} label={button.label} href={button.href} />}
                {button.badge === true ? <span aria-hidden="true" className="starci-core-top-bar-custom-dot" data-grammar-top-bar-dot="true" /> : null}
            </span>
        ))}
    </div>
)

/**
 * The bar's second and last layer: the page tabs of an app section, under the row. A layer is a named region, so its
 * content and its label travel together; a bar with no second layer carries neither.
 */
type WithSubnavigation = { readonly subnavigation: ReactNode; readonly subnavigationLabel: string }
type WithoutSubnavigation = { readonly subnavigation?: undefined; readonly subnavigationLabel?: never }

export type TopBarProps = NoChildren & Omit<ComponentPropsWithoutRef<"header">, "children" | "className" | "title"> & (WithSubnavigation | WithoutSubnavigation) & {
    /** App-owned identity (logo, product name) - usually a link home. */
    readonly brand: ReactNode
    /** Primary destinations shown inline at wide widths (e.g. a `<nav>` of `Link`s). */
    readonly navigation?: ReactNode
    /** Trailing actions: search, notifications, account. They stay visible at every width. */
    readonly actions?: ReactNode
    /** App-owned round icon buttons (a bell, a help) in the end cluster BEFORE `actions` (0.37.15); at phone width only the first stays, the rest go to `useTopBarOverflowEntries()`. */
    readonly customButtons?: readonly TopBarCustomButton[]
    /** The mobile menu trigger. */
    readonly menu?: TopBarMenu
    readonly position?: "static" | "sticky"
    /** `compact`: a 56px bar (a public page under the brand); `default`: 64px, the app's bar. */
    readonly density?: "default" | "compact"
}

/**
 * The application bar (`<header>`, the banner landmark at page level): brand, inline navigation,
 * actions and a menu trigger that replaces the inline navigation below 48rem, and at most one more layer (`subnavigation`). The trigger reports
 * `aria-expanded`; the drawer it opens stays app/overlay-owned.
 *
 * Landmark rule: a page has ONE banner, and the app bar owns it. Hosted in `WorkspaceShell`'s
 * `header` slot, the shell yields (its wrapper becomes a plain `div`) so the banner is never nested.
 * Contract: menu trigger A11Y-2 STATE-7 (named glyph button, app-owned aria-expanded).
 */
export const TopBar = ({ brand, navigation, actions, customButtons, menu, subnavigation, subnavigationLabel, position = "sticky", density = "default", ...headerProps }: TopBarProps) => (
    <ButtonPlacementProvider placement="chrome" navbar>
    <TopBarOverflowContext.Provider value={customButtons ?? []}>
    <SurfaceNesting>
    <header
        {...headerProps}
        className={"starci-core-top-bar"}
        data-component="TopBar"
        data-tier="composite"
        data-grammar-top-bar-position={position}
        data-grammar-top-bar-density={density}
        data-grammar-top-bar-menu={menu === undefined ? "none" : menu.visibility ?? "compact"}
        data-grammar-top-bar-subnavigation={subnavigation === undefined ? "false" : "true"}
    >
        <div className="starci-core-top-bar-main" data-grammar-top-bar-main="true">
        {menu === undefined ? null : (
            <HeroButton
                aria-expanded={menu.isOpen}
                aria-label={menu.isOpen ? menu.closeLabel : menu.openLabel}
                className="starci-core-top-bar-menu-trigger"
                data-contract="A11Y-2 STATE-7"
                data-grammar-top-bar-trigger="true"
                isIconOnly
                onPress={() => menu.onOpenChange(!menu.isOpen)}
                type="button"
                variant="tertiary"
                {...(menu.controls === undefined ? {} : { "aria-controls": menu.controls })}
            >
                {menu.icon}
            </HeroButton>
        )}
        <div className="starci-core-top-bar-brand" data-grammar-top-bar-brand="true">{brand}</div>
        {navigation === undefined ? null : <div className="starci-core-top-bar-navigation" data-grammar-top-bar-navigation="true">{navigation}</div>}
        {actions === undefined && (customButtons === undefined || customButtons.length === 0) ? null : (
            <div className="starci-core-top-bar-actions" data-grammar-top-bar-actions="true">
                {customButtons === undefined || customButtons.length === 0 ? null : <CustomButtons buttons={customButtons} />}
                {actions}
            </div>
        )}
        </div>
        {subnavigation === undefined ? null : (
            <div
                aria-label={subnavigationLabel}
                className="starci-core-top-bar-subnavigation"
                data-grammar-top-bar-subnavigation-row="true"
                role="region"
            >
                {subnavigation}
            </div>
        )}
    </header>
    </SurfaceNesting>
    </TopBarOverflowContext.Provider>
    </ButtonPlacementProvider>
)
