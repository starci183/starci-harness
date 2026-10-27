/**
 * The blocks of a brand layer, read the way `starci/brand-layer-shape` accepts them: each top-level rule whose
 * selectors are all light or dark scopes (a compound `:root, .light, .dark` names both), and each rule of the
 * `@media (prefers-color-scheme: dark)` block. A block that is not one of those is left out: the shape rule reports it.
 */
import type { Declaration, Root, Rule } from "postcss"
import { isAlwaysSelector, isDarkMedia, isSystemSelector, themeOfSelector } from "./scope.ts"

/** One of the two themes of the brand layer. */
export type Theme = "light" | "dark"

/**
 * One block of the brand layer, in source order.
 * `always` is true when a selector of the block matches the root whatever the theme is (`:root`, `html`), so the dark
 * theme inherits its tokens too.
 */
export interface BrandBlock {
  node: Rule
  themes: Set<Theme>
  always: boolean
}

export function readBrandBlocks(root: Root): BrandBlock[] {
  const blocks: BrandBlock[] = []
  root.each((node) => {
    if (node.type === "rule") {
      const themes: Theme[] = []
      for (const selector of node.selectors) {
        const theme = themeOfSelector(selector)
        if (theme === null) return
        themes.push(theme)
      }
      blocks.push({ node, themes: new Set(themes), always: node.selectors.some(isAlwaysSelector) })
    } else if (node.type === "atrule" && node.name.toLowerCase() === "media" && isDarkMedia(node.params)) {
      node.each((child) => {
        if (child.type === "rule" && child.selectors.every(isSystemSelector)) blocks.push({ node: child, themes: new Set<Theme>(["dark"]), always: false })
      })
    }
  })
  return blocks
}

/**
 * The declarations of the brand layer for one theme, in cascade order: the blocks that name the theme, and (for the
 * dark theme) the blocks that match the root in every theme, since `html.dark` matches `:root` as well.
 * Returns custom property to the declaration that wins.
 */
export function declarationsFor(blocks: readonly BrandBlock[], theme: Theme): Map<string, Declaration> {
  const winning = new Map<string, Declaration>()
  for (const block of blocks) {
    if (!block.themes.has(theme) && !(theme === "dark" && block.always)) continue
    block.node.each((child) => {
      if (child.type === "decl" && child.prop.startsWith("--")) winning.set(child.prop, child)
    })
  }
  return winning
}

/** The custom properties a theme declares itself (not through `:root` inheritance): what "has a value in this theme" means. */
export function declaredIn(blocks: readonly BrandBlock[], theme: Theme): Set<string> {
  const names = new Set<string>()
  for (const block of blocks) {
    if (!block.themes.has(theme)) continue
    block.node.each((child) => {
      if (child.type === "decl" && child.prop.startsWith("--")) names.add(child.prop)
    })
  }
  return names
}
