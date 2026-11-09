/** Core Grammar API rules, versioned with the Grammar family that owns their concrete vocabulary. */
import type { ESLint, Linter, Rule } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { SOURCE_FILES, linterOptions as canonLinterOptions, scopeToPackages } from "@starci/eslint-canon-fe/lib/config.mjs"
import { rules as appShellRules } from "./app-shell.ts"
import { rules as buttonArrowRules } from "./button-arrow.ts"
import { rules as cardContentRules } from "./card-content.ts"
import { rules as chipLabelRules } from "./chip-label.ts"
import { rules as choiceControlsRules } from "./choice-controls.ts"
import { rules as drawingRules } from "./drawing.ts"
import { rules as fieldLabelRules } from "./field-label.ts"
import { rules as freestyleRules } from "./freestyle.ts"
import { rules as gapProximityRules } from "./gap-proximity.ts"
import { rules as grammarBoundaryRules } from "./grammar-boundary.ts"
import { rules as iconRules } from "./icon.ts"
import { rules as layoutTwoAxisRules } from "./layout-two-axis.ts"
import { rules as linkLookRules } from "./link-look.ts"
import { rules as mascotRules } from "./mascot.ts"
import { rules as menuEntriesRules } from "./menu-entries.ts"
import { rules as noRawScrollRules } from "./no-raw-scroll.ts"
import { rules as outlineIconsRules } from "./outline-icons.ts"
import { rules as pageRules } from "./page.ts"
import { rules as pageBreadcrumbsRules } from "./page-breadcrumbs.ts"
import { rules as pageHeaderRules } from "./page-header.ts"
import { rules as paneRules } from "./pane.ts"
import { rules as rowTitleLinkRules } from "./row-title-link.ts"
import { rules as sectionHeadActionRules } from "./section-head-action.ts"
import { rules as sameLineSizeRules } from "./same-line-size.ts"
import { rules as statusColorsRules } from "./status-colors.ts"
import { rules as surfaceCardRules } from "./surface-card.ts"
import { rules as surfaceDepthRules } from "./surface-depth.ts"
import { rules as singleChildCardRules } from "./single-child-card.ts"
import { rules as surfaceInSurfaceRules } from "./surface-in-surface.ts"
import { rules as suggestionButtonsRules } from "./suggestion-buttons.ts"
import { rules as tabCountChipRules } from "./tab-count-chip.ts"
import { rules as tabsRules } from "./tabs.ts"
import { rules as tableCellTypeRules } from "./table-cell-type.ts"
import { rules as textRules } from "./text-rules.ts"
import { rules as tokensRules } from "./tokens.ts"
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
  { law: "button-arrow", rules: buttonArrowRules },
  { law: "card-content", rules: cardContentRules },
  { law: "chip-label", rules: chipLabelRules },
  { law: "choice-controls", rules: choiceControlsRules },
  { law: "drawing", rules: drawingRules },
  { law: "field-label", rules: fieldLabelRules },
  { law: "freestyle", rules: freestyleRules },
  { law: "gap-proximity", rules: gapProximityRules },
  { law: "grammar-boundary", rules: grammarBoundaryRules },
  { law: "icon", rules: iconRules },
  { law: "layout-two-axis", rules: layoutTwoAxisRules },
  { law: "link-look", rules: linkLookRules },
  { law: "mascot", rules: mascotRules },
  { law: "menu-entries", rules: menuEntriesRules },
  { law: "no-raw-scroll", rules: noRawScrollRules },
  { law: "outline-icons", rules: outlineIconsRules },
  { law: "page", rules: pageRules },
  { law: "page-breadcrumbs", rules: pageBreadcrumbsRules },
  { law: "page-header", rules: pageHeaderRules },
  { law: "pane", rules: paneRules },
  { law: "row-title-link", rules: rowTitleLinkRules },
  { law: "same-line-size", rules: sameLineSizeRules },
  { law: "section-head-action", rules: sectionHeadActionRules },
  { law: "single-child-card", rules: singleChildCardRules },
  { law: "status-colors", rules: statusColorsRules },
  { law: "surface-card", rules: surfaceCardRules },
  { law: "surface-depth", rules: surfaceDepthRules },
  { law: "suggestion-buttons", rules: suggestionButtonsRules },
  { law: "surface-in-surface", rules: surfaceInSurfaceRules },
  { law: "tab-count-chip", rules: tabCountChipRules },
  { law: "tabs", rules: tabsRules },
  { law: "table-cell-type", rules: tableCellTypeRules },
  { law: "text-rules", rules: textRules },
  { law: "tokens", rules: tokensRules },
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

/**
 * The Grammar family's rules for the front-end subpaths of an app's root workspace packages (`packages/<pkg>/src/workbench/**` and `src/public/**`):
 * the config of `coreGrammarConfig` over the package view (`loadPackagesHfs` of the universal canon), narrowed to those subpaths, so a module
 * package draws with the Grammar's components alone under the very laws of the front end (FE-PACKAGES-2).
 * @param input - The package view of the app root and the family.
 * @returns A typed source block with every family rule at error over the package subpaths.
 */
export const coreGrammarPackagesConfig: typeof coreGrammarConfig = (input) => scopeToPackages(coreGrammarConfig(input))

// The result cache of `starci app check --gate lint` (contexts/project/check-cache.md) reads the disk inputs the family rules declare.
export { crossFileInputs } from "./lib/cross-file-inputs.ts"
export type { CrossFileInput } from "./lib/cross-file-inputs.ts"
