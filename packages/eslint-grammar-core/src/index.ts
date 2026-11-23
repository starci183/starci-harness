/** Core Grammar API rules, versioned with the Grammar family that owns their concrete vocabulary. */
import type { ESLint, Linter, Rule } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { SOURCE_FILES, linterOptions as canonLinterOptions, scopeToPackages } from "@starci/eslint-canon-fe/lib/config.mjs"
import { rules as appShellRules } from "./app-shell.ts"
import { rules as avatarRowUsesGroupRules } from "./avatar-row-uses-group.ts"
import { rules as buttonArrowRules } from "./button-arrow.ts"
import { rules as cardContentRules } from "./card-content.ts"
import { rules as cardIsObjectRules } from "./card-is-object.ts"
import { rules as choiceControlsRules } from "./choice-controls.ts"
import { rules as fragmentRules } from "./fragment.ts"
import { rules as drawingRules } from "./drawing.ts"
import { rules as fieldLabelRules } from "./field-label.ts"
import { rules as freestyleRules } from "./freestyle.ts"
import { rules as gapProximityRules } from "./gap-proximity.ts"
import { rules as grammarBoundaryRules } from "./grammar-boundary.ts"
import { rules as iconRules } from "./icon.ts"
import { rules as layoutTwoAxisRules } from "./layout-two-axis.ts"
import { rules as linkLookRules } from "./link-look.ts"
import { rules as mascotRules } from "./mascot.ts"
import { rules as mediaRules } from "./media.ts"
import { rules as menuEntriesRules } from "./menu-entries.ts"
import { rules as noRawScrollRules } from "./no-raw-scroll.ts"
import { rules as noRawSpacingStyleRules } from "./no-raw-spacing-style.ts"
import { rules as noRawTypeSizeRules } from "./no-raw-type-size.ts"
import { rules as outlineIconsRules } from "./outline-icons.ts"
import { rules as pageRules } from "./page.ts"
import { rules as pageBreadcrumbsRules } from "./page-breadcrumbs.ts"
import { rules as pageHeaderRules } from "./page-header.ts"
import { rules as paneRules } from "./pane.ts"
import { rules as rowTitleLinkRules } from "./row-title-link.ts"
import { rules as rowsInCardRules } from "./rows-in-card.ts"
import { rules as noCardLeadDescriptionRules } from "./no-card-lead-description.ts"
import { rules as noNestedLabelRules } from "./no-nested-label.ts"
import { rules as sectionHeadActionRules } from "./section-head-action.ts"
import { rules as siteTypeRoleRules } from "./site-type-role.ts"
import { rules as sameLineSizeRules } from "./same-line-size.ts"
import { rules as surfaceCardRules } from "./surface-card.ts"
import { rules as surfaceDepthRules } from "./surface-depth.ts"
import { rules as surfaceInSurfaceRules } from "./surface-in-surface.ts"
import { rules as tabsRules } from "./tabs.ts"
import { rules as tableCellTypeRules } from "./table-cell-type.ts"
import { rules as textRules } from "./text-rules.ts"
import { rules as tokensRules } from "./tokens.ts"
import { rules as vendorRules } from "./vendor-boundary.ts"
import { fragmentContext } from "@starci/eslint-canon-fe/lib/fragment.mjs"
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

/** A rule that leaves the code of a `<Fragment>` region alone (`fragmentContext` of the universal canon). */
const WRAPPED = new WeakSet<Rule.RuleModule>()
const exemptFragment = (rule: Rule.RuleModule): Rule.RuleModule => {
  if (WRAPPED.has(rule)) return rule
  WRAPPED.add(rule)
  const create = rule.create
  rule.create = (context) => create.call(rule, fragmentContext(context))
  return rule
}

/** The laws that judge the `<Fragment>` element itself and so are not wrapped: they would otherwise be silenced by the region they guard. */
const JUDGES_FRAGMENT_ITSELF: ReadonlySet<string> = new Set(["fragment"])

const DECLARED: readonly { readonly law: string; readonly rules: Readonly<Record<string, Rule.RuleModule>> }[] = [
  { law: "fragment", rules: fragmentRules },
  { law: "app-shell", rules: appShellRules },
  { law: "avatar-row-uses-group", rules: avatarRowUsesGroupRules },
  { law: "button-arrow", rules: buttonArrowRules },
  { law: "card-content", rules: cardContentRules },
  { law: "card-is-object", rules: cardIsObjectRules },
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
  { law: "media", rules: mediaRules },
  { law: "menu-entries", rules: menuEntriesRules },
  { law: "no-raw-scroll", rules: noRawScrollRules },
  { law: "no-raw-spacing-style", rules: noRawSpacingStyleRules },
  { law: "no-raw-type-size", rules: noRawTypeSizeRules },
  { law: "outline-icons", rules: outlineIconsRules },
  { law: "page", rules: pageRules },
  { law: "page-breadcrumbs", rules: pageBreadcrumbsRules },
  { law: "page-header", rules: pageHeaderRules },
  { law: "pane", rules: paneRules },
  { law: "row-title-link", rules: rowTitleLinkRules },
  { law: "same-line-size", rules: sameLineSizeRules },
  { law: "rows-in-card", rules: rowsInCardRules },
  { law: "no-card-lead-description", rules: noCardLeadDescriptionRules },
  { law: "no-nested-label", rules: noNestedLabelRules },
  { law: "section-head-action", rules: sectionHeadActionRules },
  { law: "site-type-role", rules: siteTypeRoleRules },
  { law: "surface-card", rules: surfaceCardRules },
  { law: "surface-depth", rules: surfaceDepthRules },
  { law: "surface-in-surface", rules: surfaceInSurfaceRules },
  { law: "tabs", rules: tabsRules },
  { law: "table-cell-type", rules: tableCellTypeRules },
  { law: "text-rules", rules: textRules },
  { law: "tokens", rules: tokensRules },
  { law: "vendor-boundary", rules: vendorRules },
]

/**
 * Each law's rules as published: every rule but the Fragment law leaves the code of a `<Fragment>` region alone, and an import whose
 * every use is inside one (`fragment.mjs` of the universal canon). Code outside a region is judged as before.
 */
const CONTRIBUTIONS: readonly { readonly law: string; readonly rules: Readonly<Record<string, Rule.RuleModule>> }[] = DECLARED.map(({ law, rules }) => ({
  law,
  rules: JUDGES_FRAGMENT_ITSELF.has(law) ? rules : Object.fromEntries(Object.entries(rules).map(([name, rule]): [string, Rule.RuleModule] => [name, exemptFragment(rule)])),
}))

/** Each concrete Grammar law has one gathered owner. */
export const lawOwners: readonly string[] = CONTRIBUTIONS.map(({ law }) => law)

/** Preserve declarations before gathering so duplicate rule names remain observable. */
export const ruleDeclarations: readonly { readonly law: string; readonly name: string }[] = CONTRIBUTIONS.flatMap(({ law, rules }) => Object.keys(rules).map((name) => ({ law, name })))

/** The law that owns each published rule ID. */
export const ruleOwners: Readonly<Record<string, string>> = Object.fromEntries(ruleDeclarations.map(({ law, name }): [string, string] => [name, law]))

/** Every rule of the selected family contract. */
export const rules: Readonly<Record<string, Rule.RuleModule>> = Object.fromEntries(CONTRIBUTIONS.flatMap(({ rules }) => Object.entries(rules)))

/**
 * THE COUNTING COHORT: a family rule that ships at `warn` while the apps migrate onto the API it asks for, with the law it
 * enforces and what ends it. `starci app check --gate lint` reports and counts its findings and never fails on them. THE SWITCH
 * to blocking is deleting the rule's entry here (a family minor): the rule then runs at error like every other. No other rule
 * may be below error, and there is no consumer override (the app's eslint.config.mjs is the managed one-liner, R17).
 */
export const COUNTING: Readonly<Record<string, { readonly law: string; readonly until: string }>> = Object.freeze({
  "starci-grammar/no-raw-type-size": { law: "TYPE-ROLES", until: "both apps have moved their raw type sizes onto the type roles" },
  "starci-grammar/no-raw-spacing-style": { law: "SPACING-ROLES", until: "both apps have moved their raw style spacing onto the spacing roles" },
})

/** The level of one published rule: warn in the counting cohort, error otherwise. */
const levelOf = (name: string): "error" | "warn" => (`starci-grammar/${name}` in COUNTING ? "warn" : "error")

/** Every family rule runs at error, the counting cohort at warn, with no consumer override surface. */
export const recommended: Readonly<Record<string, "error" | "warn">> = Object.fromEntries(Object.keys(rules).map((name): [string, "error" | "warn"] => [`starci-grammar/${name}`, levelOf(name)]))

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
 * @returns A typed source block with every family rule at error (the counting cohort, `COUNTING`, at warn).
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
  const missing = Object.keys(rules).filter((name) => recommended[`starci-grammar/${name}`] !== levelOf(name))
  if (missing.length) throw new Error(`coreGrammarConfig requires every family rule at error (the counting cohort at warn): ${missing.join(", ")}`)
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
 * The Grammar family's rules for the front-end files of an app's root workspace packages (every `.tsx` file and the slots the project declares `lint: "fe"`, ext/manifest.json packages):
 * the config of `coreGrammarConfig` over the package view (`loadPackagesHfs` of the universal canon), narrowed to those files, so a root
 * package draws with the Grammar's components alone under the very laws of the front end (FE-PACKAGES-2).
 * @param input - The package view of the app root and the family.
 * @returns A typed source block with every family rule at error over the package files.
 */
export const coreGrammarPackagesConfig: typeof coreGrammarConfig = (input) => scopeToPackages(coreGrammarConfig(input), input.hfs)

// The result cache of `starci app check --gate lint` (contexts/project/check-cache.md) reads the disk inputs the family rules declare.
export { crossFileInputs } from "./lib/cross-file-inputs.ts"
export type { CrossFileInput } from "./lib/cross-file-inputs.ts"

// The audit inventory of every `<Fragment reason="...">` region: a report, never a finding (the fragment inventory script prints it).
export { fragmentInventory, fragmentUsesOf, formatFragmentInventory } from "./lib/fragment-inventory.ts"
export type { FragmentUse } from "./lib/fragment-inventory.ts"
