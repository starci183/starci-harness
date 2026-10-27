import type { ReactNode } from "react"

/** `narrow` shows the bar below 48rem only (the page header carries the command at wider widths); `always` at every width. */
export type PinnedActionBarVisibility = "narrow" | "always"

type PinnedActionBarBase = {
    /** Accessible name of the bar (`role="group"`), e.g. the command's purpose. */
    readonly label: string
    /** Default `narrow`. */
    readonly visibility?: PinnedActionBarVisibility
}

/** The one page command: a single `Button` (normally `variant="primary"`, `width="fill"`). */
type SingleCommandBar = PinnedActionBarBase & {
    readonly children: ReactNode
    readonly summary?: never
    readonly dismiss?: never
    readonly commit?: never
}

/**
 * A summary with up to two actions. `summary` is text or a node (a selection count, a total, unsaved changes);
 * `dismiss` is the secondary action (a `Button` with `intent="dismiss"`) and `commit` the primary one
 * (a `Button` with `intent="commit"`). The dismiss action sits before the commit action.
 */
type SummaryBar = PinnedActionBarBase & {
    readonly children?: never
    readonly summary: ReactNode
    readonly dismiss?: ReactNode
    readonly commit?: ReactNode
}

export type PinnedActionBarProps = SingleCommandBar | SummaryBar

/**
 * The page's primary command pinned to the bottom edge on a narrow screen, in thumb reach (UX-9 case-1):
 * sticky at the bottom of its scroll container, on `--surface` behind a 1px `--separator` top hairline
 * (BOUNDARY-1), inset 0.75rem above and 1rem at the sides and below - plus the device's bottom safe-area
 * inset. It holds one Button, or a summary beside up to two Buttons (dismiss, then commit); it is not
 * navigation (that is `BottomNav`). Hidden at 48rem and wider unless `visibility="always"`, so the same
 * command is shown once per viewport (LAYOUT-4 case-2).
 */
export const PinnedActionBar = (props: PinnedActionBarProps) => {
    const { label, visibility = "narrow" } = props
    const hasSummary = props.summary !== undefined
    return (
        <div
            aria-label={label}
            className="starci-core-pinned-action-bar"
            data-component="PinnedActionBar"
            data-grammar-bottom-chrome="true"
            data-contract="BOUNDARY-1"
            data-grammar-pinned-visibility={visibility}
            data-grammar-pinned-layout={hasSummary ? "summary" : "command"}
            data-tier="atom"
            role="group"
        >
            {hasSummary ? (
                <>
                    <div className="starci-core-pinned-action-bar-summary" data-grammar-pinned-summary="true">{props.summary}</div>
                    <div className="starci-core-pinned-action-bar-actions" data-grammar-pinned-actions="true">
                        {props.dismiss}
                        {props.commit}
                    </div>
                </>
            ) : props.children}
        </div>
    )
}
