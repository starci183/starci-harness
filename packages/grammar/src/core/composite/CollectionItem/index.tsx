import type { ReactNode } from "react"
import { ButtonPlacementProvider } from "../../buttonIntent.js"

export type CollectionItemProps = {
    /** One repeated card or custom collection row, with its existing markup preserved. */
    readonly children: ReactNode
}

/** Supplies item placement for custom card lists without adding a DOM wrapper. */
export const CollectionItem = ({ children }: CollectionItemProps) => (
    <ButtonPlacementProvider placement="item">{children}</ButtonPlacementProvider>
)
