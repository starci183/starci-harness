// The compact-width and global chrome of an app shell added to the Common contract (0.46.0): the bottom bar of places and the command palette.
// A renderer lives in the folder of its tier under src/core.
import { BottomNav } from "../core/frame/BottomNav/index.js"
import { CommandPalette } from "../core/frame/CommandPalette/index.js"

export { BottomNav, type BottomNavProps } from "../core/frame/BottomNav/index.js"
export { BOTTOM_NAV_MAX_PLACES, type BottomNavItem, type BottomNavMore } from "../core/frame/BottomNav/data.js"
export { CommandPalette, useCommandPaletteShortcut, type CommandPaletteProps } from "../core/frame/CommandPalette/index.js"
export type { CommandPaletteGroup, CommandPaletteItem } from "../core/frame/CommandPalette/data.js"
export type { NavigationBadgeTone } from "../core/navigationBadgeTone.js"

/** Every shell-chrome renderer, spread into `COMMON_GRAMMAR_COMPONENTS`. */
export const COMMON_SHELL_COMPONENTS = Object.freeze({ BottomNav, CommandPalette } as const)
