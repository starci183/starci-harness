import { cn } from "@heroui/react"

/** Owns the full-width peer-tab region without allowing intrinsic content to widen the page. */
export const tabsFrameClassName = cn("starci-core-tabs-frame")
/** Constrains HeroUI's list container so its scroller can measure overflow. */
export const tabsClassName = cn("starci-core-tabs")
/** Keeps icon and stable label aligned as one tab identity. */
export const tabContentClassName = cn("starci-core-tab-content")
/** Core hides labels only while the accessible name and icon remain available. */
export const tabLabelClassName = cn("starci-core-tab-label")
