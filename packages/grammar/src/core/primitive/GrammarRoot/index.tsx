"use client"

import { cn } from "@heroui/react"
import type { ComponentPropsWithoutRef } from "react"
import { RouterProvider } from "react-aria-components"
import { ButtonIntentFamilyProvider } from "../../buttonIntent.js"
import { CollectionItemFamilyProvider } from "../../collectionItem.js"

export type GrammarRootProps = Omit<ComponentPropsWithoutRef<"div">, "color"> & {
    /** `system` follows the reader unless an explicit light or dark scope is requested. */
    readonly theme?: "system" | "light" | "dark"
    /** Visual families install their scoped material contract on this neutral root. */
    readonly "data-grammar-family"?: string
    /**
     * Client-side navigation. Pass the router's `navigate` (with `useHref`) once here and every Grammar `Link`,
     * `Button href`, `Breadcrumbs` item and `ListBox`/`Menu` item `href` navigates inside the app without a reload.
     */
    readonly navigate?: (path: string) => void
    /** Maps a router path to the href a link renders, e.g. react-router's `useHref`. Defaults to the identity. */
    readonly useHref?: (href: string) => string
}

/**
 * Neutral Common boundary. Select a visual family with its `scopeProps`.
 *
 * Contract: COLOR-5 - the root publishes the theme scope (`data-grammar-theme`) every family keys its
 * light, dark and system token blocks on.
 */
export const GrammarRoot = ({ className, theme = "system", navigate, useHref, ...props }: GrammarRootProps) => {
    const root = (
    <ButtonIntentFamilyProvider family={props["data-grammar-family"]}>
    <CollectionItemFamilyProvider family={props["data-grammar-family"]}>
    <div
        {...props}
        className={cn("grammar-common-root", className)}
        data-contract="COLOR-5"
        data-grammar="common"
        data-component="GrammarRoot"
        data-tier="atom"
        data-grammar-theme={theme}
    />
    </CollectionItemFamilyProvider>
    </ButtonIntentFamilyProvider>
    )
    return navigate === undefined ? root : <RouterProvider navigate={navigate} {...(useHref === undefined ? {} : { useHref })}>{root}</RouterProvider>
}
