/**
 * Reads the grammar's own token VALUES out of its CSS, the way `extract-vocabulary.ts` reads the token names, so the
 * contrast rule judges a brand against what the grammar really derives (`--success-soft-foreground` is a mix of the
 * brand's `--success` and `--foreground`) and never against a hand-typed table. `grammar-values.generated.ts` is this
 * function's output; the twin test recomputes it and fails when the two differ. Development only: it needs postcss.
 *
 * A value is kept where the grammar declares it on the element that carries the theme: `.grammar-common-root` (the
 * common root) or `.grammar-common-root[data-grammar-family="<family>"]`, each with or without
 * `[data-grammar-theme="dark"]`. Rules inside `@supports`, `@media` and any other at-rule than `@layer` are skipped:
 * they are progressive enhancements or another mode, not the theme's values.
 */
import fs from "node:fs"
import path from "node:path"
import postcss from "postcss"
import type { AtRule, Root } from "postcss"

/** The stylesheets that declare the theme roots, relative to the grammar package. */
const VALUE_CSS = ["common/styles.css", "core/styles.css", "offset-pop/styles.css"]

const ROOT = /^\.grammar-common-root(?:\[data-grammar-family="([a-z][a-z0-9-]*)"\])?(\[data-grammar-theme="dark"\])?$/

/** The values of one theme: per family (`common` or a family name), the custom properties its root declares. */
export type ThemeValues = Record<string, Record<string, string>>

/** The grammar values per theme. */
export interface GrammarValues {
  light: ThemeValues
  dark: ThemeValues
}

/** `{ light: { common: {--x: value}, core: {...} }, dark: {...} }`. */
export function extractValues(grammarSrcDir: string): GrammarValues {
  const table: GrammarValues = { light: {}, dark: {} }
  const visit = (node: Root | AtRule): void => {
    node.each((child) => {
      if (child.type === "atrule") {
        if (child.name === "layer" && child.nodes) visit(child)
        return
      }
      if (child.type !== "rule") return
      const roots: RegExpExecArray[] = []
      for (const selector of child.selectors) {
        const found = ROOT.exec(selector.trim())
        if (found === null) return
        roots.push(found)
      }
      for (const [, family, dark] of roots) {
        const theme = table[dark ? "dark" : "light"]
        const bucket = (theme[family ?? "common"] ??= {})
        child.each((decl) => {
          if (decl.type === "decl" && decl.prop.startsWith("--")) bucket[decl.prop] = decl.value.trim().replace(/\s+/g, " ")
        })
      }
    })
  }
  for (const file of VALUE_CSS) visit(postcss.parse(fs.readFileSync(path.join(grammarSrcDir, file), "utf8")))
  for (const theme of [table.light, table.dark]) {
    for (const [family, tokens] of Object.entries(theme)) theme[family] = Object.fromEntries(Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b)))
  }
  return table
}
