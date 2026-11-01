import type { ReactNode } from "react"
import { ButtonPlacementProvider } from "../../buttonIntent.js"

export type ItemActionsProps = {
    /** Commands belonging to one collection item. */
    readonly children: ReactNode
}

/** Supplies item placement when only a custom row's action slot needs a boundary. */
export const ItemActions = ({ children }: ItemActionsProps) => (
    <ButtonPlacementProvider placement="item">{children}</ButtonPlacementProvider>
)
