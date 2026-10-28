/** Core Grammar API rules, versioned with the Grammar family that owns their concrete vocabulary. */
import type { ESLint, Linter, Rule } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { SOURCE_FILES, linterOptions as canonLinterOptions } from "@starci/eslint-canon-fe/lib/config.mjs"
import { rules as appShellRules } from "./app-shell.ts"
import { rules as chipLabelRules } from "./chip-label.ts"
import { rules as drawingRules } from "./drawing.ts"
import { rules as grammarBoundaryRules } from "./grammar-boundary.ts"
import { rules as iconRules } from "./icon.ts"
import { rules as menuEntriesRules } from "./menu-entries.ts"
import { rules as pageHeaderRules } from "./page-header.ts"
import { rules as statusColorsRules } from "./status-colors.ts"
import { rules as tokensRules } from "./tokens.ts"
import { rules as typographyRules } from "./typography.ts"
import { rules as vendorRules } from "./vendor-boundary.ts"
import { why as familyWhy } from "./lib/why.ts"

/** The Grammar families: `core`, and `offset-pop` through its own package entry. */
export type GrammarFamilyId = "core" | "offset-pop"

/** The FE slot view `loadHfs(import.meta.url)` gives, as the factory reads it. */
export type GrammarHfsView = {
  readonly repoRoot: string
  readonly profile: "fe"
  /** The selected family id: `core` or `offset-pop`. */
  readonly grammar: GrammarFamilyId
  readonly slotOf: (file: string) => string | null
}

const CONTRIBUTIONS: readonly { readonly law: string; readonly rules: Readonly<Record<string, Rule.RuleModule>> }[] = [
  { law: "app-shell", rules: appShellRules },
  { law: "chip-label", rules: chipLabelRules },
  { law: "drawing", rules: drawingRules },
  { law: "grammar-boundary", rules: grammarBoundaryRules },
  { law: "icon", rules: iconRules },
  { law: "menu-entries", rules: menuEntriesRules },
  { law: "page-header", rules: pageHeaderRules },
  { law: "status-colors", rules: statusColorsRules },
  { law: "tokens", rules: tokensRules },
  { law: "typography", rules: typographyRules },
  { law: "vendor-boundary", rules: vendorRules },
]

/** Each concrete Grammar law has one gathered owner. */
export const lawOwners: readonly string[] = CONTRIBUTIONS.map(({ law }) => law)

/** Preserve declarations before gathering so duplicate rule names remain observable. */
export const ruleDeclarations: readonly { readonly law: string; readonly name: string }[] = CONTRIBUTIONS.flatMap(({ law, rules }) => Object.keys(rules).map((name) => ({ law, name })))

/** The law that owns each published rule ID. */
export const ruleOwners: Readonly<Record<string, string>> = Object.fromEntries(ruleDeclarations.map(({ law, name }): [string, string] => [name, law]))

/** Every rule of the selected family contract. */
export const rules: Readonly<Record<string, Rule.RuleModule>> = Object.fromEntries(CONTRIBUTIONS.flatMap(({ rules }) => Object.entries(rules)))

/** Every family rule runs at error, with no consumer override surface. */
export const recommended: Readonly<Record<string, "error">> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))

/** The failure-code guidance of every rule. */
export const why: Readonly<Record<string, { readonly code: string; readonly en: string; readonly fix: string }>> = familyWhy

/** The linter options of the universal canon: no inline configuration, no unused disable directive. */
export const linterOptions: Readonly<Linter.LinterOptions> = canonLinterOptions

const plugin: ESLint.Plugin = { meta: { name: "@starci/eslint-grammar-core" }, rules }
export default plugin

/** The families this factory serves: core, and offset-pop through its own package entry. */
const SERVED_FAMILIES: readonly string[] = Object.freeze(["core", "offset-pop"])

/**
 * Add the complete selected-family contract to the universal front-end flat config.
 * Offset Pop uses the inherited Common renderer contract through its own package entry.
 * @param input - The selected FE slot view and family.
 * @returns A typed source block with every family rule at error.
 */
export const coreGrammarConfig: (input: {
  readonly hfs: GrammarHfsView
  readonly family?: GrammarFamilyId
}) => Linter.Config[] = ({ hfs, family = "core" }: { readonly hfs?: GrammarHfsView; readonly family?: GrammarFamilyId } = {}) => {
  if (!hfs || typeof hfs.slotOf !== "function" || typeof hfs.repoRoot !== "string" || hfs.profile !== "fe") {
    throw new Error("coreGrammarConfig needs the FE view from loadHfs(import.meta.url)")
  }
  if (!SERVED_FAMILIES.includes(family) || hfs.grammar !== family) {
    throw new Error(`coreGrammarConfig family ${family} does not match the selected Grammar ${hfs.grammar}`)
  }
  const missing = Object.keys(rules).filter((name) => recommended[`starci-grammar/${name}`] !== "error")
  if (missing.length) throw new Error(`coreGrammarConfig requires every family rule at error: ${missing.join(", ")}`)
  return [{
    files: [...SOURCE_FILES],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { projectService: true, tsconfigRootDir: hfs.repoRoot, ecmaFeatures: { jsx: true } },
    },
    linterOptions: { ...linterOptions },
    plugins: { "starci-grammar": plugin },
    settings: { starci: { hfs } },
    rules: { ...recommended },
  }]
}
