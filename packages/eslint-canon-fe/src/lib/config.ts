/**
 * The one flat config of a StarCi front end.
 *
 * A repository's `eslint.config.mjs` is managed by `starci app sync` (R05/R16/R17). Its template composes this universal
 * factory with the explicitly selected Grammar family's factory, passing the same HFS view to both.
 *
 * The factory owns everything else: which files are linted (the source of every app and every workspace package), typed linting on the source (`parserOptions.projectService`, so a rule asks what a node IS rather than what
 * it is called), the ignores, the linter options that make a disable comment impossible, every canon rule at `error`,
 * the React Hooks rules at `error`, and `settings.starci.hfs` - the slot view each path-scoped rule asks instead of a path
 * pattern. It takes no rule overrides, globs or ignores: there is no parameter through which a repository could weaken
 * the canon.
 */
import tsParser from "@typescript-eslint/parser"
import type { ESLint, Linter } from "eslint"
import { OUTSIDE_THE_SCAN_FILES } from "#runtime/scripts/lib/sonar-syntax-rules.mjs"
import { sonarWayRules, sonarWayTestRules } from "#runtime/scripts/lib/sonar-way.mjs"
import { eslintPlugin } from "./eslint-boundary.ts"
import { isHfsView } from "./hfs.ts"
import type { Rules } from "./rule.ts"

/** The canon plugin as this package builds it: its name and its rules. */
export interface CanonPlugin {
  readonly meta: { readonly name: string }
  readonly rules: Rules
}

/** The plugins of the Sonar way rules (scripts/lib/sonar-way.mjs). */
export interface SonarPlugins {
  readonly sonarjs: ESLint.Plugin
  readonly unicorn: ESLint.Plugin
}

/** The name of the test-scope Sonar way block, which the package scoping narrows to the specs of the package subpaths. */
export const TEST_SCOPE_BLOCK = "starci-fe/sonar-way-tests"

/** A disable directive is a weakening of lint, and one that suppresses nothing is dead weight. */
export const linterOptions: Readonly<{ noInlineConfig: true; reportUnusedDisableDirectives: "error" }> = Object.freeze({ noInlineConfig: true, reportUnusedDisableDirectives: "error" })

/** The product source of a front end: every app's `src/` and every workspace package's `src/` (slots fe.* and repo.packages). */
export const SOURCE_FILES = Object.freeze(["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"])
/** The specs of that source, the positive `files` of the block that judges the specs alone (no negated selector: the lint scope of the harness proves a scope from plain globs only). */
export const SPEC_FILES = Object.freeze(["apps/*/src/**/*.{spec,e2e-spec}.{ts,tsx}", "packages/*/src/**/*.{spec,e2e-spec}.{ts,tsx}"])

/** Build output, installed packages, generated wire types and the harness's report directory are never linted. */
export const IGNORED = Object.freeze(["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/__generated__/**", ".starci/**"])

/**
 * The type-aware typescript-eslint rules the canon borrows, all `error` and the same set the back-end canon borrows for the type-aware laws: a promise is awaited or
 * handled (`no-floating-promises`, `no-misused-promises`), a `switch` over a union names every member, nothing flows out of an `any` (the `no-unsafe-*` family),
 * and the Sonar rules that need the checker: S1874 (a deprecated API), S6551 (an object turned into text) and S7503 (an `async` function that never awaits).
 */
export const BORROWED: Readonly<Record<string, "error">> = Object.freeze({
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-deprecated": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/require-await": "error",
})

const levelOf = (setting: Linter.RuleEntry | undefined): Linter.RuleEntry | undefined => (Array.isArray(setting) ? setting[0] : setting)

/**
 * The counting cohort: a rule that ships at `warn` for one release while a codemod moves apps onto the API
 * it asks for, each with the HFS rule id it enforces. `starci app check --gate lint` reports and counts its findings and never fails
 * on them; the next cohort moves the rule to error and deletes its entry. No other rule may be below error.
 */
export const COUNTING: Readonly<Record<string, { readonly rule: string }>> = Object.freeze({
  "starci-fe/no-spacing-utility": { rule: "R350" },
})

/**
 * The flat config of one front-end repository.
 *
 * @param input - Attachment options.
 * @param input.hfs - The HFS view of the repository (`loadHfs(import.meta.url)`).
 * @param input.plugin - The canon plugin.
 * @param input.source - The source-tree levels (canon rules plus the React Hooks rules).
 * @param input.reactHooks - The React Hooks plugin.
 * @param input.tsPlugin - The typescript-eslint plugin.
 * @param input.sonar - The plugins of the Sonar way rules (scripts/lib/sonar-way.mjs).
 * @returns The flat config: one ignore block, one typed source block and the Sonar way block.
 */
export const buildFeConfig = ({ hfs, plugin, source, reactHooks, tsPlugin, sonar }: {
  readonly hfs: unknown
  readonly plugin: CanonPlugin
  readonly source: Linter.RulesRecord
  readonly reactHooks: ESLint.Plugin
  readonly tsPlugin: ESLint.Plugin
  readonly sonar: SonarPlugins
}): Linter.Config[] => {
  if (!isHfsView(hfs) || typeof hfs.repoRoot !== "string") {
    throw new Error("starciFeConfig needs { hfs: loadHfs(import.meta.url) } - the rules read the repository's slots through it")
  }
  if (hfs.profile !== "fe") throw new Error(`starciFeConfig lints the fe side of an app (its eslint.config.mjs lives in fe/); this view is ${hfs.side ? `the ${hfs.side} side` : "the app root"}`)
  if (Object.keys(source).length === 0) throw new Error("starciFeConfig received an empty source recommendation - a config with no rules is not adoption")
  const weak = Object.entries(source).filter(([name, setting]) => levelOf(setting) !== (name in COUNTING ? "warn" : "error")).map(([name]) => name)
  if (weak.length > 0) throw new Error(`starciFeConfig refuses source rules not at error (or not at warn in the counting cohort): ${weak.join(", ")}`)
  const settings = { starci: { hfs } }
  return [
    { ignores: [...IGNORED] },
    {
      files: [...SOURCE_FILES],
      languageOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { projectService: true, tsconfigRootDir: hfs.repoRoot, ecmaFeatures: { jsx: true } },
      },
      linterOptions: { ...linterOptions },
      plugins: { "starci-fe": eslintPlugin(plugin), "react-hooks": reactHooks, "@typescript-eslint": tsPlugin },
      settings,
      rules: { ...source, ...BORROWED },
    },
    // Sonar way: what the scan raises is refused while the code is written; a spec is outside the scan, so outside this block.
    { files: [...SOURCE_FILES], ignores: [...OUTSIDE_THE_SCAN_FILES], plugins: { sonarjs: sonar.sonarjs, unicorn: sonar.unicorn }, rules: sonarWayRules(sonar.sonarjs, "fe").rules },
    // Sonar way, test scope: the scan reads the specs with the rules of the tests (sonar.tests), so the specs of the source are judged by those and by no other.
    { name: TEST_SCOPE_BLOCK, files: [...SPEC_FILES], plugins: { sonarjs: sonar.sonarjs }, rules: sonarWayTestRules(sonar.sonarjs) },
  ]
}

/**
 * The canon rules that need no slot view: they judge a node and its types, never where the file sits in an app. A tree that is no HFS front end (a
 * runtime package, the harness UI) is linted by exactly these plus the type-aware, React Hooks and Sonar way rules. The set is closed by
 * config.spec.mjs: every other rule of the plugin refuses to run without `settings.starci.hfs`, so a rule added to the plugin is either listed here
 * or proven slot-bound there.
 */
export const SLOT_FREE_RULES = Object.freeze([
  "client-no-server-import", "no-server-action", "no-dangerous-html", "response-cookie-attributes", "require-export-jsdoc", "no-vietnamese-in-source",
  "no-hardcoded-endpoint-fallback", "no-runtime-namespace", "list-item-has-key", "no-index-key", "no-inline-literal-prop-in-list", "prefer-arrow-export",
  "handler-on-prefix", "no-native-form-control", "no-native-img", "image-has-size", "no-second-i18n-stack", "html-lang-from-locale", "no-null-suspense-fallback",
  "no-native-anchor", "no-inline-parameter-type", "no-hand-rolled-polling", "no-copy-in-call", "no-alert", "no-failure-collapse",
  "outcome-kinds-exhaustive", "no-await-in-loop", "prefer-code-point", "prefer-string-raw", "no-nested-conditional", "no-void-operator", "no-unused-import",
  "prefer-export-from", "no-unused-prop-types", "media-has-caption", "max-params", "no-line-separator-literal",
  "no-bidirectional-character", "todo-tag", "no-duplicate-import", "no-useless-fragment", "no-nested-component", "no-children-prop", "use-state-destructured", "prefer-tag-over-role",
  "no-list-panel-padding", "no-hand-built-panes", "no-table-in-card", "no-heading-above-card", "no-selectable-tag-group", "no-fill-command-in-header", "no-app-surface-paint", "divider-full-bleed", "control-height", "selection-fill-no-check", "no-grammar-shim",
  "no-swr-default-array", "no-foreign-slot-status", "no-validating-as-loading", "no-placeholder-object", "no-hand-skeleton", "explicit-export-surface", "directive-first", "renderer-presentation-only",
  "button-intent-required", "destructive-confirm-in-dialog", "single-commit-per-render", "no-commit-in-collection-item",
])

/** The source of a plain front-end tree: its `src/`. */
export const PLAIN_SOURCE_FILES = Object.freeze(["src/**/*.{ts,tsx}"])
const PLAIN_SPEC_FILES = Object.freeze(["src/**/*.{spec,e2e-spec}.{ts,tsx}"])

/**
 * The flat config of a TypeScript front-end tree that is no HFS app: the same fences as an app (typed linting, no inline directive, every rule at
 * `error`) over the rules that need no slot view. It takes the root of the tree and nothing else.
 *
 * @param input - Attachment options.
 * @param input.root - The absolute directory holding the tree's `tsconfig.json` and `src/`.
 * @param input.plugin - The canon plugin.
 * @param input.hooks - The React Hooks rules at error.
 * @param input.reactHooks - The React Hooks plugin.
 * @param input.tsPlugin - The typescript-eslint plugin.
 * @param input.sonar - The plugins of the Sonar way rules.
 * @param input.canon - Whether the slot-free canon rules are on.
 * @returns The flat config: one ignore block, one typed source block and the Sonar way block.
 */
export const buildPlainSourceConfig = ({ root, plugin, hooks, reactHooks, tsPlugin, sonar, canon = true }: {
  readonly root: unknown
  readonly plugin: CanonPlugin
  readonly hooks: Linter.RulesRecord
  readonly reactHooks: ESLint.Plugin
  readonly tsPlugin: ESLint.Plugin
  readonly sonar: SonarPlugins
  readonly canon?: boolean
}): Linter.Config[] => {
  if (typeof root !== "string" || root === "") throw new Error("starciPlainSourceConfig needs { root } - the directory of the tree's tsconfig.json and src/")
  const canonRules: Linter.RulesRecord = canon ? Object.fromEntries(SLOT_FREE_RULES.map((name) => [`starci-fe/${name}`, "error"])) : {}
  const missing = SLOT_FREE_RULES.filter((name) => !(name in plugin.rules))
  if (missing.length > 0) throw new Error(`starciPlainSourceConfig lists rules the canon plugin does not publish: ${missing.join(", ")}`)
  return [
    { ignores: [...IGNORED] },
    {
      files: [...PLAIN_SOURCE_FILES],
      languageOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { projectService: true, tsconfigRootDir: root, ecmaFeatures: { jsx: true } },
      },
      linterOptions: { ...linterOptions },
      plugins: { "starci-fe": eslintPlugin(plugin), "react-hooks": reactHooks, "@typescript-eslint": tsPlugin },
      rules: { ...canonRules, ...hooks, ...BORROWED },
    },
    { files: [...PLAIN_SOURCE_FILES], ignores: [...OUTSIDE_THE_SCAN_FILES], plugins: { sonarjs: sonar.sonarjs, unicorn: sonar.unicorn }, rules: sonarWayRules(sonar.sonarjs, "fe").rules },
    { name: TEST_SCOPE_BLOCK, files: [...PLAIN_SPEC_FILES], plugins: { sonarjs: sonar.sonarjs }, rules: sonarWayTestRules(sonar.sonarjs) },
  ]
}

/** The front-end files of a root workspace package every app has: each `.tsx` file of the package source wherever it sits (FE-PACKAGES-2). The slots a project declares `lint: "fe"` join them (`scopeToPackages`). */
export const PACKAGE_SOURCE_FILES = Object.freeze(["packages/*/src/**/*.tsx"])
export const PACKAGE_SPEC_FILES = Object.freeze(["packages/*/src/**/*.{spec,e2e-spec}.tsx"])
const SCRIPT = "**/*.{ts,tsx}"
const SCRIPT_SPEC = "**/*.{spec,e2e-spec}.{ts,tsx}"

/** One lint scope of a declared package, as the package view carries it: an app-relative glob and the globs an earlier back-end slot holds. */
interface PackageLintScope { readonly files: string; readonly ignores: readonly string[] }

/**
 * The front-end scopes of the packages the project declares (`hfs.packageLint.fe` of the package view), read from a view of unknown shape:
 * a view without them (a package the project does not declare, a view of a side) names none.
 *
 * @param hfs - The package view of the app root.
 * @returns One scope per `lint: fe` slot.
 */
const frontEndScopes = (hfs: unknown): readonly PackageLintScope[] => {
  if (typeof hfs !== "object" || hfs === null || !("packageLint" in hfs)) return []
  const lint = hfs.packageLint
  if (typeof lint !== "object" || lint === null || !("fe" in lint) || !Array.isArray(lint.fe)) return []
  return lint.fe.filter((scope: unknown): scope is PackageLintScope =>
    typeof scope === "object" && scope !== null && "files" in scope && typeof scope.files === "string" && "ignores" in scope && Array.isArray(scope.ignores) && scope.ignores.every((glob: unknown) => typeof glob === "string"))
}
/** What a package folder never lints: installed packages, build output, generated wire types. */
export const PACKAGE_IGNORED = Object.freeze(["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/__generated__/**"])

/**
 * A front-end flat config (the canon's or a Grammar family's) narrowed to the front-end files of the root workspace packages of an app: the
 * very rules of the fe side over every `.tsx` file of a package and over the slots the project declares `lint: "fe"` (`ext/manifest.json`
 * `packages`, PROJECT-LINT-3). No folder name of a package is known here: the first slot that holds a file decides, so a back-end slot
 * declared before a front-end slot it lies in is left to the back-end canon. The global ignore block becomes the package one. The config is
 * read, never changed.
 *
 * @param config - The flat config of a front end built over the package view.
 * @param hfs - The package view of the app root, whose `packageLint` names the declared front-end slots.
 * @returns The same blocks with `files` narrowed to the package files.
 */
export const scopeToPackages = (config: readonly Linter.Config[], hfs?: unknown): Linter.Config[] => {
  const scopes = frontEndScopes(hfs)
  const whole = scopes.filter((scope) => scope.ignores.length === 0)
  const carved = scopes.filter((scope) => scope.ignores.length > 0)
  return config.flatMap((block): Linter.Config[] => {
    if (block.files === undefined) return [{ ...block, ignores: [...PACKAGE_IGNORED] }]
    const tests = block.name === TEST_SCOPE_BLOCK
    const script = tests ? SCRIPT_SPEC : SCRIPT
    return [
      { ...block, files: [...(tests ? PACKAGE_SPEC_FILES : PACKAGE_SOURCE_FILES), ...whole.map((scope) => [scope.files, script])] },
      ...carved.map((scope) => ({ ...block, files: [[scope.files, script]], ignores: [...(block.ignores ?? []), ...scope.ignores] })),
    ]
  })
}
