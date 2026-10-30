import { cn } from "@heroui/react"

/**
 * Pane-layout geometry is SHIPPED.
 *
 * The bounded height chain, the rail track, the composer boundary and the compact drawer are all
 * drawn by `.starci-core-pane-layout*` in `src/common/styles.css`. The names below are hooks;
 * the rail-less layout keeps its own class because it is a structural variant, not a utility.
 */

/** Bounded height chain for a workbench supplied with height by its host. */
export const paneLayoutClassName = cn("starci-core-pane-layout") ?? "starci-core-pane-layout"

/** Header remains outside every workspace-owned scroll region. */
export const paneLayoutHeaderClassName = cn("starci-core-pane-layout-header") ?? "starci-core-pane-layout-header"

/** Compact rail disclosure has its own non-scrolling action boundary. */
export const paneLayoutRailTriggerBoundaryClassName = cn("starci-core-pane-layout-rail-trigger-boundary") ?? "starci-core-pane-layout-rail-trigger-boundary"

/** Visible, keyboard-sized trigger for the compact supporting overlay. */
export const paneLayoutRailTriggerClassName = cn("starci-core-pane-layout-rail-trigger") ?? "starci-core-pane-layout-rail-trigger"

/** Primary work region and the persistent rail share the remaining bounded height. */
export const paneLayoutLayoutClassName = cn("starci-core-pane-layout-layout") ?? "starci-core-pane-layout-layout"

/** Bind the layout column to the same authored widths as Core Rail. */
export const getPaneLayoutLayoutClassName = (
    _railWidth: "compact" | "standard" | "wide",
    hasRail: boolean,
) => cn(paneLayoutLayoutClassName, !hasRail && "starci-core-pane-layout-layout-without-rail")

/** Main task owner: only its conversation child scrolls. */
export const paneLayoutPrimaryClassName = cn("starci-core-pane-layout-primary") ?? "starci-core-pane-layout-primary"

/** The conversation is the single primary bounded scroll owner. */
export const paneLayoutConversationClassName = cn("starci-core-pane-layout-conversation") ?? "starci-core-pane-layout-conversation"

/** Composer remains reachable at the terminal edge without duplicating scroll padding. */
export const paneLayoutComposerClassName = cn("starci-core-pane-layout-composer") ?? "starci-core-pane-layout-composer"

/** Persistent supporting rail fills the same bounded layout track as the task owner. */
export const paneLayoutInlineRailClassName = cn("starci-core-pane-layout-inline-rail") ?? "starci-core-pane-layout-inline-rail"

/** Keep the compact vendor drawer on one safe viewport width. */
export const paneLayoutDrawerContentClassName = cn("starci-core-pane-layout-drawer-content") ?? "starci-core-pane-layout-drawer-content"

/** The dialog and its body extend the bounded height chain into the overlay. */
export const paneLayoutDrawerDialogClassName = cn("starci-core-pane-layout-drawer-dialog") ?? "starci-core-pane-layout-drawer-dialog"
export const paneLayoutDrawerBodyClassName = cn("starci-core-pane-layout-drawer-body") ?? "starci-core-pane-layout-drawer-body"

/** Scroll owner inside the compact supporting overlay. */
export const paneLayoutOverlayRailClassName = cn("starci-core-pane-layout-overlay-rail") ?? "starci-core-pane-layout-overlay-rail"

/** Make the vendor-provided overlay exit easy to target in every input mode. */
export const paneLayoutDrawerCloseClassName = cn("starci-core-pane-layout-drawer-close") ?? "starci-core-pane-layout-drawer-close"
