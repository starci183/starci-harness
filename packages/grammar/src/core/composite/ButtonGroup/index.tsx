"use client"

import { ButtonGroup as HeroButtonGroup, type ButtonGroupProps as HeroButtonGroupProps } from "@heroui/react"
import type { ButtonIntent } from "../../buttonIntent.js"
import { Button } from "../../leaf/Button/index.js"
import type { IconSource } from "../../leaf/Icon/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { useIsLoading } from "../../loadingState.js"
import type { NoChildren } from "../../tier.js"

/** One member of the group: a `Button` with its label, or an `IconButton` when it has a `source`. */
export type ButtonGroupAction = {
    readonly id: string
    /** The visible label, or the accessible name of an icon-only member. */
    readonly label: string
    /** The glyph of an icon-only member. */
    readonly source?: IconSource
    /** Peers on one object are never destructive: the members share a decision, so none is a confirmation. */
    readonly intent?: Exclude<ButtonIntent, "destructive" | "dismiss">
    readonly onPress?: () => void
    readonly isDisabled?: boolean
    /** Only the member that started this work is pending; its peers remain available. */
    readonly isPending?: boolean
}

export type ButtonGroupProps = NoChildren & {
    /** Names the group (`role="group"`) for assistive technology. */
    readonly label: string
    /** The members as data. They join visually and keep their own names and tab stops. */
    readonly actions: ReadonlyArray<ButtonGroupAction>
    readonly orientation?: "horizontal" | "vertical"
    /** Disables every member. */
    readonly isDisabled?: boolean
    /** Initial unresolved members keep their ready boxes as inert skeletons. */
    readonly isLoading?: boolean
    /** The vendor group's native member size, forwarded through the Grammar leaves. */
    readonly size?: HeroButtonGroupProps["size"]
    readonly width?: "content" | "fill"
}

/** Related actions joined into one visual unit. Each button stays its own tab stop. */
export const ButtonGroup = ({ label, actions, orientation = "horizontal", isDisabled = false, isLoading: ownLoading, size = "md", width = "content" }: ButtonGroupProps) => {
    const isLoading = useIsLoading(ownLoading)
    return (
        <HeroButtonGroup
            data-tier="composite"
            data-component="ButtonGroup"
            data-contract="FOCUS-2 TRUTH-2"
            data-grammar-orientation={orientation}
            data-grammar-disabled={isDisabled ? "true" : "false"}
            data-loading={isLoading ? "true" : "false"}
            data-width={width}
            aria-label={label}
            aria-busy={isLoading || undefined}
            orientation={orientation}
            isDisabled={isDisabled}
            size={size}
            fullWidth={width === "fill"}
            className="starci-core-button-group"
        >
            {actions.map((action) => {
                const unavailable = isDisabled || action.isDisabled === true
                const common = {
                    ...(action.intent === undefined ? {} : { intent: action.intent }),
                    ...(action.onPress === undefined ? {} : { onPress: action.onPress }),
                    isDisabled: unavailable,
                    isPending: action.isPending === true,
                    isLoading,
                    size,
                }
                return action.source === undefined
                    ? <Button key={action.id} {...common}>{action.label}</Button>
                    : <IconButton key={action.id} source={action.source} label={action.label} {...common} />
            })}
        </HeroButtonGroup>
    )
}
