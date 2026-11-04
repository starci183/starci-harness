"use client"

import { Button as HeroButton } from "@heroui/react"
import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { SurfaceNesting } from "../../surfaceContext.js"
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
export const TopBar = ({ brand, navigation, actions, menu, subnavigation, subnavigationLabel, position = "sticky", density = "default", ...headerProps }: TopBarProps) => (
    <ButtonPlacementProvider placement="chrome" navbar>
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
        {actions === undefined ? null : <div className="starci-core-top-bar-actions" data-grammar-top-bar-actions="true">{actions}</div>}
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
    </ButtonPlacementProvider>
)
