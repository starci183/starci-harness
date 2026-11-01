import type { ReactNode } from "react"
import { ButtonPlacementProvider } from "../../buttonIntent.js"

export type ToolbarActionsProps = {
    /** Persistent toolbar commands, inside the toolbar's existing semantic element. */
    readonly children: ReactNode
}

/** Supplies chrome placement for a custom toolbar without adding a DOM wrapper. */
export const ToolbarActions = ({ children }: ToolbarActionsProps) => (
    <ButtonPlacementProvider placement="chrome">{children}</ButtonPlacementProvider>
)
