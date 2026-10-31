/**
 * The universal frontend plugin: every applicable law's rules, gathered once.
 *
 * The public factory gathers every universal rule at error. A managed repository config composes
 * it with the selected Grammar-family factory instead of registering individual rules. Family
 * packages consume the public generic infrastructure exports; each rule implementation has one owner.
 *
 * Published IDs identify their owning law. Namespace migrations are explicit in the removed-vocabulary
 * catalog; compatibility aliases cannot create a second owner for a rule.
 */
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { recommended as brandValuesRecommended, rules as brandValuesRules } from "./brand-values.ts"
import { recommended as buttonIntentRecommended, rules as buttonIntentRules } from "./button-intent.ts"
import { recommended as controlHeightRecommended, rules as controlHeightRules } from "./control-height.ts"
import { recommended as clientBoundaryRecommended, rules as clientBoundaryRules } from "./client-boundary.ts"
import { recommended as commentsRecommended, rules as commentsRules } from "./comments.ts"
import { recommended as classNamesRecommended, rules as classNamesRules } from "./class-names.ts"
import { recommended as envOwnerRecommended, rules as envOwnerRules } from "./env-owner.ts"
import { recommended as feStackRecommended, rules as feStackRules } from "./fe-stack.ts"
import { recommended as fileLayoutRecommended, rules as fileLayoutRules } from "./file-layout.ts"
import { recommended as formattingRecommended, rules as formattingRules } from "./formatting.ts"
import { recommended as grammarShimRecommended, rules as grammarShimRules } from "./grammar-shim.ts"
import { recommended as hooksFolderRecommended, rules as hooksFolderRules } from "./hooks-folder.ts"
import { recommended as hygieneRecommended, rules as hygieneRules } from "./hygiene.ts"
import { recommended as landmarkRecommended, rules as landmarkRules } from "./landmark.ts"
import { recommended as listsRecommended, rules as listsRules } from "./lists.ts"
import { recommended as loadingRecommended, rules as loadingRules } from "./loading.ts"
import { recommended as lintEscapeRecommended, rules as lintEscapeRules } from "./lint-escape-hatch.ts"
import { recommended as namingRecommended, rules as namingRules } from "./naming.ts"
import { recommended as nativeControlsRecommended, rules as nativeControlsRules } from "./native-controls.ts"
import { recommended as nextConventionsRecommended, rules as nextConventionsRules } from "./next-conventions.ts"
import { recommended as propsRecommended, rules as propsRules } from "./props-and-slots.ts"
import { recommended as servedLocaleRecommended, rules as servedLocaleRules } from "./served-locale.ts"
import { recommended as shapeSlotRecommended, rules as shapeSlotRules } from "./shape-slot.ts"
import { recommended as drawingRecommended, rules as drawingRules } from "./drawing.ts"
import { recommended as sizeBudgetRecommended, rules as sizeBudgetRules } from "./size-and-state-budget.ts"
import { recommended as sizeGrowthRecommended, rules as sizeGrowthRules } from "./size-growth.ts"
import { recommended as surfaceRulesRecommended, rules as surfaceRules } from "./surface-rules.ts"
import { recommended as splitRecommended, rules as splitRules } from "./the-split.ts"
import { recommended as tokensRecommended, rules as tokensRules } from "./tokens.ts"
import { recommended as transportRecommended, rules as transportRules } from "./transport.ts"
import { recommended as translationRecommended, rules as translationRules } from "./translation.ts"
import { recommended as typeSafetyRecommended, rules as typeSafetyRules } from "./type-safety.ts"
import { recommended as projectGraphRecommended, rules as projectGraphRules } from "./project-graph.ts"
import { recommended as sonarParityRecommended, rules as sonarParityRules } from "./sonar-parity.ts"
import { recommended as spacingRecommended, rules as spacingRules } from "./spacing.ts"
import type { ESLint, Linter } from "eslint"
import { buildFeConfig, buildPlainSourceConfig, COUNTING, type CanonPlugin, type SonarPlugins } from "./lib/config.ts"
import type { Rule, Rules } from "./lib/rule.ts"
import { why } from "./lib/why.ts"
import { recommended as uiRulingsRecommended, rules as uiRulingsRules } from "./ui-rulings.ts"

/** One law's rules and the level it asks for each; the views are replaced when a later law takes a rule over. */
interface Contribution {
  readonly law: string
  rules: Rules
  recommended: Readonly<Record<string, "error" | "warn">>
}

/** A rule as declared by its law. */
interface RuleDeclaration {
  law: string
  readonly name: string
}

/** Each law's contribution, kept separate so a duplicate name is detectable rather than silent. */
const CONTRIBUTIONS: Contribution[] = [
  { law: "ui-rulings", rules: uiRulingsRules, recommended: uiRulingsRecommended },
    { law: "project-graph", rules: projectGraphRules, recommended: projectGraphRecommended },
  { law: "brand-values", rules: brandValuesRules, recommended: brandValuesRecommended },
  { law: "button-intent", rules: buttonIntentRules, recommended: buttonIntentRecommended },
  { law: "control-height", rules: controlHeightRules, recommended: controlHeightRecommended },
  { law: "client-boundary", rules: clientBoundaryRules, recommended: clientBoundaryRecommended },
  { law: "comments", rules: commentsRules, recommended: commentsRecommended },
  {
    law: "class-names",
    rules: classNamesRules,
    recommended: classNamesRecommended,
  },
  { law: "env-owner", rules: envOwnerRules, recommended: envOwnerRecommended },
  { law: "fe-stack", rules: feStackRules, recommended: feStackRecommended },
  { law: "file-layout", rules: fileLayoutRules, recommended: fileLayoutRecommended },
  { law: "formatting", rules: formattingRules, recommended: formattingRecommended },
  { law: "grammar-shim", rules: grammarShimRules, recommended: grammarShimRecommended },
  { law: "hooks-folder", rules: hooksFolderRules, recommended: hooksFolderRecommended },
  { law: "hygiene", rules: hygieneRules, recommended: hygieneRecommended },
  { law: "landmark", rules: landmarkRules, recommended: landmarkRecommended },
  { law: "lists", rules: listsRules, recommended: listsRecommended },
  { law: "loading", rules: loadingRules, recommended: loadingRecommended },
  { law: "lint-escape-hatch", rules: lintEscapeRules, recommended: lintEscapeRecommended },
  { law: "naming", rules: namingRules, recommended: namingRecommended },
  { law: "native-controls", rules: nativeControlsRules, recommended: nativeControlsRecommended },
  { law: "next-conventions", rules: nextConventionsRules, recommended: nextConventionsRecommended },
  { law: "props-and-slots", rules: propsRules, recommended: propsRecommended },
  { law: "served-locale", rules: servedLocaleRules, recommended: servedLocaleRecommended },
  { law: "shape-slot", rules: shapeSlotRules, recommended: shapeSlotRecommended },
  { law: "drawing", rules: drawingRules, recommended: drawingRecommended },
  { law: "size-and-state-budget", rules: sizeBudgetRules, recommended: sizeBudgetRecommended },
  { law: "size-growth", rules: sizeGrowthRules, recommended: sizeGrowthRecommended },
  { law: "surface-rules", rules: surfaceRules, recommended: surfaceRulesRecommended },
  { law: "the-split", rules: splitRules, recommended: splitRecommended },
  { law: "tokens", rules: tokensRules, recommended: tokensRecommended },
  { law: "translation", rules: translationRules, recommended: translationRecommended },
  { law: "transport", rules: transportRules, recommended: transportRecommended },
  { law: "type-safety", rules: typeSafetyRules, recommended: typeSafetyRecommended },
  { law: "sonar-parity", rules: sonarParityRules, recommended: sonarParityRecommended },
  { law: "spacing", rules: spacingRules, recommended: spacingRecommended },
]

/** Every gathered law. */
export const lawOwners: string[] = CONTRIBUTIONS.map((entry) => entry.law)

/**
 * Which law declares each rule.
 *
 * Exported because a failing rule is a question about a LAW, and the shortest path from a build log
 * to the document that explains it is this map. It is also what the twin test walks to prove no two
 * laws claim one name.
 */
export const ruleOwners: Record<string, string> = Object.fromEntries(
  CONTRIBUTIONS.flatMap((entry) => Object.keys(entry.rules).map((name) => [name, entry.law])),
)

/**
 * Every (law, rule name) pair as DECLARED, before any collapsing.
 *
 * `ruleOwners` above and `rules` below are both built with `Object.fromEntries`, which silently
 * keeps the last writer when two laws declare one name. A guard that walks either of them cannot
 * see a collision - the duplicate is gone before it looks, so every name appears exactly once BY
 * CONSTRUCTION and the check passes forever while being blind.
 *
 * That is not hypothetical. The back-end twin had this exact shape, three rules were declared by two
 * laws each, one copy was discarded on import, and its guard reported green throughout. This axis
 * has no collision today; publishing the raw declarations is what keeps that a FACT rather than an
 * assumption nobody can test.
 */
export const ruleDeclarations: RuleDeclaration[] = CONTRIBUTIONS.flatMap((entry) =>
  Object.keys(entry.rules).map((name) => ({ law: entry.law, name })),
)

/** Every rule this canon publishes, keyed by its published name. */
export const rules: Record<string, Rule> = Object.fromEntries(
  CONTRIBUTIONS.flatMap((entry) => Object.entries(entry.rules)),
)

/**
 * The levels this canon asks for, as the plugin's own opinion.
 *
 * Every FE canon rule is an error. Existing debt is fixed before adoption; lowering architecture
 * to warn teaches every later author that the boundary is optional and is not a supported rollout. The one
 * exception is the closed counting cohort of lib/config.ts (`COUNTING`), an owner-ruled warn for one release.
 */
export const recommended: Record<string, "error" | "warn"> = Object.fromEntries(
  CONTRIBUTIONS.flatMap((entry) => Object.entries(entry.recommended)),
)

/** Flat-config options that make inline directives ineffective rather than merely forbidden. */
export { linterOptions } from "./lib/config.ts"
export { loadHfs } from "./lib/hfs.ts"

/**
 * The Vietnamese why of each rule that carries a catalogue code: `{ code, vi, fixVi }`.
 *
 * Read by the harness, which quotes `vi` to the owner and files the finding under `code`.
 */
export { why }

/** The plugin object, shaped the way a flat config expects it. */
const plugin: CanonPlugin = {
  meta: { name: "eslint-plugin-starci-fe" },
  rules,
}

export default plugin

/**
 * The React Hooks plugin, from wherever the consuming repository installed it.
 *
 * A peer dependency is resolved from the package that asks for it, and a package linked by path
 * (`file:`) is resolved from its REAL location - which has no `node_modules` of the repository that
 * linked it. So the plugin is looked up from this package first and from the working directory
 * second; a repository that installed `eslint-plugin-react-hooks` beside its `eslint.config.mjs`
 * is found either way, and one that did not gets a message naming the install rather than a
 * resolver stack trace.
 */
/** A property of a value, read as `value?.[key]` reads it. */
const field = (value: unknown, key: string): unknown =>
  value === null || value === undefined ? undefined : Reflect.get(Object(value), key)

/** A loaded plugin module: any object is a plugin to ESLint's flat config, which reads only the fields it knows. */
const asPlugin = (loaded: unknown, name: string): ESLint.Plugin => {
  if ((typeof loaded !== "object" && typeof loaded !== "function") || loaded === null) throw new TypeError(`${name} did not load as a plugin object`)
  return loaded
}

const loadReactHooks = (): ESLint.Plugin => {
  for (const base of [import.meta.url, pathToFileURL(join(process.cwd(), "noop.js")).href]) {
    let loaded: unknown
    try {
      loaded = createRequire(base)("eslint-plugin-react-hooks")
    } catch {
      // try the next place
      continue
    }
    return asPlugin(loaded, "eslint-plugin-react-hooks")
  }
  throw new Error("starciFeConfig needs eslint-plugin-react-hooks 7 or newer: npm i -D eslint-plugin-react-hooks")
}

/** The typescript-eslint plugin whose type-aware rules the factory borrows (Sonar S1874, S6551 and S7503); a dependency of this package. */
const loadTsPlugin = (): ESLint.Plugin => asPlugin(createRequire(import.meta.url)("@typescript-eslint/eslint-plugin"), "@typescript-eslint/eslint-plugin")

/** The Sonar way plugins (scripts/lib/sonar-way.mjs); dependencies of this package, pinned exactly. */
const loadSonarPlugins = (): SonarPlugins => {
  const require = createRequire(import.meta.url)
  const unicorn: unknown = require("eslint-plugin-unicorn")
  return { sonarjs: asPlugin(require("eslint-plugin-sonarjs"), "eslint-plugin-sonarjs"), unicorn: asPlugin(field(unicorn, "default") ?? unicorn, "eslint-plugin-unicorn") }
}

/**
 * The React Hooks rules of a plugin, all at error.
 *
 * The plugin's own recommended set is the definition of "the hooks rules" - it carries the classic
 * pair and the compiler-derived ones (`set-state-in-effect`, `refs`, `purity`, `immutability`) - and
 * it ships several of them at `warn`. A warning is the level a team learns to scroll past, so the
 * canon states every one as `error`. Four rules are named on purpose: a plugin too old to carry them
 * would otherwise be adopted silently with the rules that catch effect-driven state and ref reads
 * during render missing.
 *
 * @param reactHooks - The plugin object.
 * @returns Every recommended hooks rule at error.
 */
export const reactHooksRules = (reactHooks: unknown): Record<string, "error"> => {
  if (reactHooks === null || reactHooks === undefined) throw new TypeError(`Cannot read properties of ${String(reactHooks)} (reading 'configs')`)
  const configured = field(field(field(field(reactHooks, "configs"), "flat"), "recommended"), "rules") ?? {}
  if ((typeof configured !== "object" && typeof configured !== "function") || configured === null) {
    throw new TypeError("Cannot use 'in' operator to search in the React Hooks recommended rules")
  }
  for (const required of [
    "react-hooks/set-state-in-effect",
    "react-hooks/refs",
    "react-hooks/rules-of-hooks",
    "react-hooks/exhaustive-deps",
  ]) {
    if (!(required in configured)) {
      throw new Error(`eslint-plugin-react-hooks does not carry ${required}; install version 7 or newer`)
    }
  }
  return Object.fromEntries(Object.keys(configured).map((name) => [name, "error"]))
}

/**
 * The universal portion of a frontend's flat config, composed with its selected Grammar-family factory.
 *
 * It owns nothing the repository could choose: which files are linted comes from the HFS profile (every app's and every
 * workspace package's `src/`), not which rules are on, not their level, not whether an inline comment may
 * switch one off. NO RULE IS OFF - the factory throws rather than emit a block in which a published rule is missing or
 * below error, so a rule added to this package reaches every repository or the build of this package fails.
 *
 * @param input - The HFS view of the repository (`loadHfs(import.meta.url)`).
 * @returns The flat config: ignores and the typed source block.
 */
export const starciFeConfig = ({ hfs }: { readonly hfs?: unknown } = {}): Linter.Config[] => {
  const published = Object.keys(rules).map((name) => `starci-fe/${name}`)
  const notRequested = published.filter((name) => recommended[name] !== (name in COUNTING ? "warn" : "error"))
  if (notRequested.length > 0) {
    throw new Error(`starciFeConfig: these published rules are not requested at error: ${notRequested.join(", ")}`)
  }
  const reactHooks = loadReactHooks()
  return buildFeConfig({
    hfs,
    plugin,
    reactHooks,
    tsPlugin: loadTsPlugin(),
    sonar: loadSonarPlugins(),
    source: { ...recommended, ...reactHooksRules(reactHooks) },
  })
}

/**
 * The flat config of a TypeScript front-end tree that is no HFS app (a runtime package, the harness UI):
 * `export default starciPlainSourceConfig({ root: import.meta.dirname })`. It lints the tree's `src/` with types, with the inline-directive fence, the
 * React Hooks rules, the type-aware rules and the Sonar way rules, and with every canon rule that needs no slot view, all at `error`.
 *
 * @param input - The absolute directory holding the tree's `tsconfig.json` and `src/`.
 * @returns The flat config: ignores, the typed source block and the Sonar way block.
 */
export const starciPlainSourceConfig = ({ root }: { readonly root?: unknown } = {}): Linter.Config[] => {
  const reactHooks = loadReactHooks()
  return buildPlainSourceConfig({ root, plugin, hooks: reactHooksRules(reactHooks), reactHooks, tsPlugin: loadTsPlugin(), sonar: loadSonarPlugins() })
}

/**
 * The flat config of a TypeScript front-end tree that adopts the typed half of the canon first: the inline-directive fence, typed linting, the
 * React Hooks rules, the type-aware typescript-eslint rules and the Sonar way rules over the tree's `src/`, all at `error`. It is
 * `starciPlainSourceConfig` without the canon's own product-structure rules (`SLOT_FREE_RULES`: jsdoc on exports, arrow exports, English-only
 * source, grammar controls, ...), for a tree that has not been brought to them yet; a tree that has uses `starciPlainSourceConfig`.
 *
 * @param input - The absolute directory holding the tree's `tsconfig.json` and `src/`.
 * @returns The flat config: ignores, the typed source block and the Sonar way block.
 */
export const starciTypedSourceConfig = ({ root }: { readonly root?: unknown } = {}): Linter.Config[] => {
  const reactHooks = loadReactHooks()
  return buildPlainSourceConfig({ root, plugin, hooks: reactHooksRules(reactHooks), reactHooks, tsPlugin: loadTsPlugin(), sonar: loadSonarPlugins(), canon: false })
}

// A21 append-only registration: keep the already exported plugin and recommendation live.
import { recommended as functionBudgetRecommended, rules as functionBudgetRules } from "./function-budget.ts"
CONTRIBUTIONS.push({ law: "function-budget", rules: functionBudgetRules, recommended: functionBudgetRecommended })
lawOwners.push("function-budget")
ruleDeclarations.push(...Object.keys(functionBudgetRules).map((name) => ({ law: "function-budget", name })))
Object.assign(ruleOwners, Object.fromEntries(Object.keys(functionBudgetRules).map((name) => [name, "function-budget"])))
Object.assign(rules, functionBudgetRules)
Object.assign(recommended, functionBudgetRecommended)
// A14 modules are also forwarded by the existing hooks-folder and transport contributions so
// source-only catalog discovery can find them. The appended registration gives each module
// ownership of those same rule instances without declaring either rule twice.
import { recommended as swrFamilyRecommended, rules as swrFamilyRules } from "./swr-family.ts"

const A14_CONTRIBUTIONS: Contribution[] = [
  { law: "swr-family", rules: swrFamilyRules, recommended: swrFamilyRecommended },
]

for (const addition of A14_CONTRIBUTIONS) {
  const names = new Set(Object.keys(addition.rules))
  for (const contribution of CONTRIBUTIONS) {
    for (const name of names) {
      if (name in contribution.rules && contribution.rules[name] !== addition.rules[name]) {
        throw new Error("A14 registration: two laws publish different rules named " + name)
      }
    }
    // Replace contribution views only; the law module's exported maps retain their forwarding
    // entries for the source-only catalog reader.
    contribution.rules = Object.fromEntries(Object.entries(contribution.rules).filter(([name]) => !names.has(name)))
    contribution.recommended = Object.fromEntries(
      Object.entries(contribution.recommended).filter(([name]) => !names.has(name.replace(/^starci-fe\//, ""))),
    )
  }
  CONTRIBUTIONS.push(addition)
  lawOwners.push(addition.law)
  for (const name of names) {
    const declarations = ruleDeclarations.filter((entry) => entry.name === name)
    if (declarations.length > 1) throw new Error("A14 registration: duplicate declarations for " + name)
    const [declared] = declarations
    if (declared !== undefined) declared.law = addition.law
    else ruleDeclarations.push({ law: addition.law, name })
    ruleOwners[name] = addition.law
  }
  Object.assign(rules, addition.rules)
  Object.assign(recommended, addition.recommended)
}

// The result cache of `starci app lint` (contexts/project/check-cache.md) reads these two declarations of the installed canon.
export { crossFileInputs } from "./lib/cross-file-inputs.ts"
export type { CrossFileInput } from "./lib/cross-file-inputs.ts"
export { projectGraph } from "./project-graph.ts"
export type { ProjectGraphFinding, ProjectGraphSnapshot } from "./project-graph.ts"
