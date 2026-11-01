/**
 * `starci/theme-layer-shape` (HFS R61 `FE_STYLE_TOKEN_ONLY`): `modules/brand/brand.css` is the app's theme, and it has
 * one shape.
 *
 * It is the only stylesheet where a raw colour or pixel value may be written, so it may hold nothing else: token
 * declarations, on HeroUI's tokens (and the few the grammar adds), in light blocks (`:root`, `.light`,
 * `[data-theme="light"]`) and dark blocks (`.dark`, `[data-theme="dark"]`, or `:root` inside
 * `@media (prefers-color-scheme: dark)`), with `color-scheme` allowed beside them.
 *
 * THE APP SETS WHAT IT CHOOSES. A token written in one block only keeps the family's or HeroUI's default in the other
 * mode, and a token written in none keeps both. The rule judges the shape of the file and never a colour: no
 * contrast, no pairing of light and dark, no palette.
 *
 * A COMPOUND SELECTOR IS BOTH THEMES. `:root, .light, .dark { --success-soft: ... }` is one block that sets its tokens
 * for the light theme and for the dark theme; each selector of the list must be a light or a dark scope.
 *
 * THE GRAMMAR ROOT IS NOT A SCOPE. The grammar declares no HeroUI token on its root, so a value written on `:root`
 * reaches every part; a selector on `.grammar-common-root` or a family attribute is refused.
 */
import type { Rule } from "postcss"
import { makeRule } from "./lib/make-rule.ts"
import { fileKind, fileOf, isDarkMedia, isSystemSelector, themeOfSelector } from "./lib/scope.ts"
import { isThemeToken } from "./lib/vocabulary.ts"

export const themeLayerShape = makeRule(
  "theme-layer-shape",
  {
    selector: (selector: string) =>
      `\`${selector}\` in brand.css. The brand layer has light blocks (\`:root\`, \`.light\`) and dark blocks (\`.dark\`, \`[data-theme="dark"]\` or \`@media (prefers-color-scheme: dark)\`) and nothing else. The grammar root and its family attribute are not scopes: set HeroUI's tokens on \`:root\`.`,
    atRule: (name: string) => `\`@${name}\` in brand.css. The only at-rule the brand layer has is \`@media (prefers-color-scheme: dark)\`.`,
    property: (prop: string) => `\`${prop}\` in brand.css is not a token. The brand layer only declares tokens (and \`color-scheme\`).`,
    foreign: (name: string) => `\`${name}\` in brand.css is not a token HeroUI or the grammar publishes. The brand is set only on HeroUI's tokens.`,
  },
  ({ root, report }) => {
    if (fileKind(fileOf(root)) !== "brand") return

    const checkBlock = (block: Rule): void => {
      block.each((child) => {
        if (child.type === "comment") return
        if (child.type !== "decl") return report(child, "property", [child.type === "rule" ? child.selector : `@${child.name}`])
        if (child.prop === "color-scheme") return
        if (!child.prop.startsWith("--")) return report(child, "property", [child.prop], { word: child.prop })
        if (!isThemeToken(child.prop)) report(child, "foreign", [child.prop], { word: child.prop })
      })
    }

    const checkRule = (rule: Rule): void => {
      for (const selector of rule.selectors) {
        if (themeOfSelector(selector) === null) return report(rule, "selector", [rule.selector], { word: rule.selector })
      }
      checkBlock(rule)
    }

    root.each((node) => {
      if (node.type === "comment") return
      if (node.type === "rule") return checkRule(node)
      if (node.type === "atrule" && node.name.toLowerCase() === "media" && isDarkMedia(node.params)) {
        return node.each((child) => {
          if (child.type === "comment") return
          if (child.type !== "rule" || !child.selectors.every(isSystemSelector)) {
            return report(child, "selector", [child.type === "rule" ? child.selector : `@${child.type === "atrule" ? child.name : child.prop}`])
          }
          checkBlock(child)
        })
      }
      if (node.type === "atrule") return report(node, "atRule", [node.name], { word: `@${node.name}` })
      report(node, "property", [node.prop], { word: node.prop })
    })
  },
)
