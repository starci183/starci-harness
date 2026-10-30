/**
 * Twin tests for the `starciFeConfig` factory and the why map.
 *
 *   node --test src/config.spec.ts
 *
 * The failure this file exists to catch is the silent one: a factory that returns a block with a
 * rule missing, or at `warn`, or `off`, lints clean and is indistinguishable from adoption.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { ESLint, Linter } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { join } from "node:path"
import plugin, {
  linterOptions,
  reactHooksRules,
  recommended,
  ruleOwners,
  rules,
  starciFeConfig,
  starciPlainSourceConfig,
  starciTypedSourceConfig,
  why,
} from "./index.ts"
import { BORROWED, PLAIN_SOURCE_FILES, SLOT_FREE_RULES } from "./lib/config.ts"
import { eslintPlugin } from "./lib/eslint-boundary.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { PACKAGE_ROOT, RUNTIME_ROOT } from "./lib/package-root.ts"
import { declaredHfsView } from "#runtime/scripts/hfs/view.mjs"
import { hasSecondLanguage } from "#runtime/scripts/lib/language.mjs"
import { appDeclaration } from "../../eslint-canon-be/fixtures/app.ts"

const ROOT = join(PACKAGE_ROOT, "fixtures", "typed")

/** A value the config must carry; a missing one fails the test that reads it. */
const present = <T>(value: T | null | undefined, what: string): T => {
  if (value === undefined || value === null) throw new assert.AssertionError({ message: `${what} is missing` })
  return value
}

/** Block `index` of a flat config. */
const blockOf = (blocks: readonly Linter.Config[], index: number): Linter.Config => present(blocks[index], `config block ${index}`)

/** The rules of a block. */
const rulesOf = (block: Linter.Config | undefined): NonNullable<Linter.Config["rules"]> => present(present(block, "config block").rules, "the rules of the block")

/** The plugins of a block. */
const pluginsOf = (block: Linter.Config): Record<string, ESLint.Plugin> => present(block.plugins, "the plugins of the block")

/** The file globs of a block. */
const filesOf = (block: Linter.Config | undefined): Linter.Config["files"] => present(block, "config block").files

/** The globs of a block, flat. */
const globsOf = (block: Linter.Config | undefined): string[] => (present(filesOf(block), "the files of the block")).flat()

/** The parser options of a block. */
const parserOptionsOf = (block: Linter.Config | undefined): Readonly<Record<string, unknown>> => {
  const options: unknown = present(present(block, "config block").languageOptions, "the languageOptions of the block")["parserOptions"]
  if (typeof options !== "object" || options === null) throw new assert.AssertionError({ message: "the block has no parserOptions" })
  return { ...options }
}

/** `setting?.[0]`: the first element of a rule setting, as indexing it reads. */
const firstOf = (setting: Linter.RuleEntry | undefined): unknown => (setting === undefined ? undefined : Reflect.get(Object(setting), 0))

/** The level of a rule setting. */
const levelOf = (setting: Linter.RuleEntry | undefined): unknown => (Array.isArray(setting) ? setting[0] : setting)

/** The slot view the settings of a block carry. */
const settingsHfsOf = (block: Linter.Config | undefined): unknown => {
  const starci: unknown = present(present(block, "config block").settings, "the settings of the block")["starci"]
  return typeof starci === "object" && starci !== null && "hfs" in starci ? starci.hfs : undefined
}

/** The why of each rule, read by any name. */
const whyOf: Readonly<Record<string, { readonly code: string; readonly en?: string; readonly fix?: string } | undefined>> = why
/** The files the typed fixture lints without listing them in its tsconfig; one list for every test, the project service is shared by root. */
const ALLOW_DEFAULT_PROJECT = ["apps/*/src/components/*/*/*.tsx", "src/*.ts", "src/*.tsx"]
const FE = appDeclaration("fe", { apps: [{ name: "web", kind: "next" }], optionalSlots: ["repo.packages", "fe.package.ui"] })
const hfs = hfsFromDeclaration(FE, ROOT)
const config = starciFeConfig({ hfs })
const [ignores, ...single] = config
/** The typed source block. */
const source = blockOf(single, 0)

test("the factory returns an ignore block, a typed source block and the Sonar way block, all from the HFS profile", () => {
  assert.equal(config.length, 3)
  assert.deepEqual(filesOf(config[2]), filesOf(source), "the Sonar way block lints the same source")
  assert.ok(present(present(ignores, "the ignore block").ignores, "the ignores").includes("**/__generated__/**"))
  assert.deepEqual(filesOf(source), ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"])
  assert.ok(!globsOf(source).some((glob) => glob.startsWith("packages/ui/")), "no package is named literally")
  assert.equal(parserOptionsOf(source)["projectService"], true, "the source is linted with types")
  assert.equal(parserOptionsOf(source)["tsconfigRootDir"], ROOT)
  assert.equal(settingsHfsOf(source), hfs, "every rule reads the slot view")
  assert.throws(() => starciFeConfig({}), /loadHfs/)
  assert.throws(() => starciFeConfig(), /loadHfs/)
  const be = declaredHfsView({ runtimeRoot: RUNTIME_ROOT, declaration: FE, repoRoot: ROOT, side: "be" })
  assert.throws(() => starciFeConfig({ hfs: be }), /this view is the be side/)
})

test("every published rule is enabled at error - no rule is off, none is a warning", () => {
  const enabled = rulesOf(source)
  for (const name of Object.keys(rules)) {
    assert.equal(enabled[`starci-fe/${name}`], "error", `starci-fe/${name} is not an error in the factory's blocks`)
  }
})

test("no rule in either block is off, warn or a numeric level below error", () => {
  for (const block of single) {
    for (const [name, setting] of Object.entries(rulesOf(block))) {
      const level = levelOf(setting)
      assert.equal(level, "error", `${name} is ${JSON.stringify(setting)}`)
    }
  }
})

test("the source block carries every published rule and the hooks rules", () => {
  for (const name of Object.keys(recommended)) assert.equal(rulesOf(source)[name], "error")
  assert.deepEqual(Object.keys(recommended).sort(), Object.keys(rulesOf(source)).filter((name) => name.startsWith("starci-fe/")).sort(), "the block holds the canon rules and nothing else of the plugin")
})

test("the React Hooks rules are on, including the effect and ref rules, all at error", () => {
  for (const name of [
    "react-hooks/rules-of-hooks",
    "react-hooks/exhaustive-deps",
    "react-hooks/set-state-in-effect",
    "react-hooks/refs",
    "react-hooks/purity",
    "react-hooks/immutability",
  ]) {
    assert.equal(rulesOf(source)[name], "error", `${name} is not an error`)
  }
  const hooks = Object.entries(rulesOf(source)).filter(([name]) => name.startsWith("react-hooks/"))
  assert.ok(hooks.length >= 10, "the recommended hooks set was not carried over")
  assert.deepEqual(hooks.filter(([, level]) => level !== "error"), [])
  assert.ok(pluginsOf(source)["react-hooks"], "the block does not register the react-hooks plugin")
})

test("a hooks plugin too old to carry the effect and ref rules is refused, not adopted", () => {
  const old = { configs: { flat: { recommended: { rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } } } } }
  assert.throws(() => reactHooksRules(old), /set-state-in-effect/)
  assert.throws(() => reactHooksRules({}), /set-state-in-effect/)
})

test("the source block refuses inline directives and registers the canon plugin", () => {
  for (const block of single.slice(0, 1)) {
    assert.deepEqual(block.linterOptions, { noInlineConfig: true, reportUnusedDisableDirectives: "error" })
    assert.equal(pluginsOf(block)["starci-fe"], plugin)
  }
  assert.notEqual(source.linterOptions, linterOptions, "the block copies the frozen options rather than sharing them")
})

test("the factory's config lints a real file: a hardcoded copy string is an error", async () => {
  // The factory's own block and the rule's own entry in it, linted from its tsconfigRootDir (the fixture side). The file need not
  // exist: the project service types it with the fixture's tsconfig.json as the default project, as the typed rule tester does.
  // The machine-backed rules of the block read the side from disk and are proven by the project-graph specs, not here.
  const block = source
  const RULE = "starci-fe/no-hardcoded-copy"
  const parserOptions = {
    ...parserOptionsOf(block),
    projectService: { allowDefaultProject: ALLOW_DEFAULT_PROJECT, defaultProject: "tsconfig.json" },
  }
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [{ ...block, rules: { [RULE]: present(rulesOf(block)[RULE], RULE) }, languageOptions: { ...block.languageOptions, parserOptions } }],
  })
  const [linted] = await eslint.lintText("export const E = () => <p>Nothing to show yet</p>\n", {
    filePath: join(ROOT, "apps", "web", "src", "components", "blocks", "Feed", "index.tsx"),
  })
  const result = present(linted, "the lint result")
  assert.deepEqual(result.messages.filter((message) => message.fatal), [], "the file parses with types")
  const rule = result.messages.find((message) => message.ruleId === RULE)
  assert.ok(rule, `no-hardcoded-copy did not report: ${JSON.stringify(result.messages.map((m) => m.ruleId))}`)
  assert.equal(rule.severity, 2)
})

const TYPE_AWARE = [
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/switch-exhaustiveness-check",
  "@typescript-eslint/no-unsafe-assignment",
  "@typescript-eslint/no-unsafe-member-access",
  "@typescript-eslint/no-unsafe-call",
  "@typescript-eslint/no-unsafe-return",
  "@typescript-eslint/no-unsafe-argument",
]

test("the front end borrows the same type-aware promise, exhaustiveness and no-unsafe rules the back end does, all at error", () => {
  for (const name of TYPE_AWARE) {
    assert.equal(BORROWED[name], "error", `${name} is not borrowed at error`)
    assert.equal(rulesOf(source)[name], "error", `${name} is not in the source block`)
  }
})

test("a floating promise, an async handler passed where a void is expected and an unsound any are refused in front-end source", async () => {
  const block = source
  const parserOptions = {
    ...parserOptionsOf(block),
    projectService: { allowDefaultProject: ALLOW_DEFAULT_PROJECT, defaultProject: "tsconfig.json" },
  }
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: [{ ...block, rules: Object.fromEntries(TYPE_AWARE.map((name) => [name, "error"])), languageOptions: { ...block.languageOptions, parserOptions } }],
  })
  const text = [
    "declare const load: () => Promise<string>",
    "declare const raw: any",
    "export const run = (): void => { load() }",
    "export const handlers = [1].map(async () => 1).every(Boolean)",
    "export const name: string = raw.name",
    "",
  ].join("\n")
  const [linted] = await eslint.lintText(text, { filePath: join(ROOT, "apps", "web", "src", "components", "blocks", "Feed", "index.tsx") })
  const result = present(linted, "the lint result")
  assert.deepEqual(result.messages.filter((message) => message.fatal), [], "the file parses with types")
  const ids = new Set(result.messages.map((message) => message.ruleId))
  for (const name of ["@typescript-eslint/no-floating-promises", "@typescript-eslint/no-unsafe-member-access", "@typescript-eslint/no-unsafe-assignment"]) assert.ok(ids.has(name), `${name} did not report: ${[...ids].join(", ")}`)
})

// -- a front-end tree that is no HFS app (a runtime package, the harness UI) ---------------------------------

const plain = starciPlainSourceConfig({ root: ROOT })

test("the plain-source config is typed, fenced and at error: no rule is off, warn or overridable", () => {
  assert.equal(plain.length, 3)
  assert.deepEqual(filesOf(plain[1]), [...PLAIN_SOURCE_FILES])
  assert.equal(parserOptionsOf(plain[1])["tsconfigRootDir"], ROOT)
  assert.equal(parserOptionsOf(plain[1])["projectService"], true)
  assert.deepEqual(blockOf(plain, 1).linterOptions, { noInlineConfig: true, reportUnusedDisableDirectives: "error" })
  for (const block of plain.slice(1)) for (const [name, setting] of Object.entries(rulesOf(block))) assert.equal(levelOf(setting), "error", name)
  for (const name of TYPE_AWARE) assert.equal(rulesOf(plain[1])[name], "error", name)
  for (const name of SLOT_FREE_RULES) assert.equal(rulesOf(plain[1])[`starci-fe/${name}`], "error", name)
  assert.equal(rulesOf(plain[1])["react-hooks/rules-of-hooks"], "error")
  assert.equal(firstOf(rulesOf(plain[2])["unicorn/prefer-top-level-await"]), "error")
  assert.throws(() => starciPlainSourceConfig(), /needs { root }/)
})

test("the typed-source config is the plain one without the canon's own rules: types, hooks and Sonar way, all at error", () => {
  const typed = starciTypedSourceConfig({ root: ROOT })
  assert.equal(typed.length, 3)
  assert.deepEqual(Object.keys(rulesOf(typed[1])).filter((name) => name.startsWith("starci-fe/")), [])
  for (const name of TYPE_AWARE) assert.equal(rulesOf(typed[1])[name], "error", name)
  assert.equal(rulesOf(typed[1])["react-hooks/exhaustive-deps"], "error")
  assert.deepEqual(rulesOf(typed[2]), rulesOf(plain[2]))
  assert.deepEqual(blockOf(typed, 1).linterOptions, { noInlineConfig: true, reportUnusedDisableDirectives: "error" })
})

test("the slot-free list is closed: every other canon rule refuses to run without an HFS view, and every listed rule runs without one", () => {
  const linter = new Linter({ configType: "flat" })
  const parserOptions = { ...parserOptionsOf(plain[1]), projectService: { allowDefaultProject: ALLOW_DEFAULT_PROJECT, defaultProject: "tsconfig.json" } }
  const verify = (name: string) => linter.verify("export const x = 1\n", [{ files: ["**/*.ts"], languageOptions: { parser: tsParser, parserOptions }, plugins: { "starci-fe": eslintPlugin(plugin) }, rules: { [`starci-fe/${name}`]: "error" } }], { filename: join(ROOT, "src", "a.ts") })
  const free = new Set(SLOT_FREE_RULES)
  for (const name of free) assert.ok(name in rules, `${name} is a published rule`)
  for (const name of Object.keys(rules)) {
    if (free.has(name)) {
      assert.deepEqual(verify(name).filter((message) => message.fatal), [], `${name} runs without a slot view`)
    } else {
      assert.throws(() => verify(name), /settings.starci.hfs/, `${name} needs a slot view, or is missing from SLOT_FREE_RULES`)
    }
  }
})

test("the plain-source config refuses a floating promise and a bare button in a tree with no slots", async () => {
  const block = blockOf(plain, 1)
  const parserOptions = { ...parserOptionsOf(block), projectService: { allowDefaultProject: ALLOW_DEFAULT_PROJECT, defaultProject: "tsconfig.json" } }
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: [{ ...block, languageOptions: { ...block.languageOptions, parserOptions } }] })
  const text = ["declare const load: () => Promise<string>", "export const run = (): void => { load() }", "export const View = () => <button type=\"button\">x</button>", ""].join("\n")
  const [linted] = await eslint.lintText(text, { filePath: join(ROOT, "src", "plain.tsx") })
  const result = present(linted, "the lint result")
  assert.deepEqual(result.messages.filter((message) => message.fatal), [])
  const ids = new Set(result.messages.map((message) => message.ruleId))
  assert.ok(ids.has("@typescript-eslint/no-floating-promises"), [...ids].join(", "))
  assert.ok(ids.has("starci-fe/no-native-form-control"), [...ids].join(", "))
})

// -- the why map -----------------------------------------------------------------------------------

/** Laws whose every rule carries a catalogue code, and so a why. */
const CATALOGUED_LAWS = [
  "button-intent",
  "env-owner",
  "fe-stack",
  "transport",
  "client-boundary",
  "hooks-folder",
  "next-conventions",
  "brand-values",
  "native-controls",
  "size-and-state-budget",
  "lint-escape-hatch",
  "type-safety",
  "lists",
  "hygiene",
  "formatting",
]
/** The rules of laws that mix catalogued and older rules. */
const CATALOGUED_RULES = [
  "no-hardcoded-copy",
  "page-exports-metadata",
  "no-null-suspense-fallback",
  "navigation-from-intl",
  "no-native-anchor",
  "no-hardcoded-route",
  "no-native-img",
  "image-has-size",
  "outcome-kinds-exhaustive",
]

test("every catalogued rule has a why with a code, an English headline and an English next step", () => {
  const needed = Object.entries(ruleOwners)
    .filter(([name, law]) => CATALOGUED_LAWS.includes(law) || CATALOGUED_RULES.includes(name))
    .map(([name]) => name)
  assert.ok(needed.length >= 30, `only ${needed.length} catalogued rules found`)
  for (const name of needed) {
    const entry = whyOf[name]
    assert.ok(entry, `${name} has no why`)
    assert.match(entry.code, /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/, `${name}: code is not UPPER_SNAKE`)
    assert.ok((entry.en?.length ?? 0) > 0, `${name}: en is empty`)
    assert.ok(!hasSecondLanguage(entry.en), `${name}: en is not English`)
    assert.ok((entry.fix?.length ?? 0) > 0, `${name}: fix is empty`)
    assert.ok(!hasSecondLanguage(entry.fix), `${name}: fix is not English`)
  }
})

test("no why names a rule that does not exist", () => {
  const orphans = Object.keys(why).filter((name) => !(name in rules))
  assert.deepEqual(orphans, [])
})

test("the codes are the catalogue's codes for R18, R22, R49-R52, R55, R56, R58, R60-R62, R65 and the fe-stack catalog", () => {
  const codes = new Set(Object.values(why).map((entry) => entry.code))
  for (const code of [
    "FE_ENV_OWNER",
    "FE_TRANSPORT_OWNER",
    "FE_HTTP_STATUS_COLLAPSE",
    "FE_WIRE_GENERATED",
    "FE_CLIENT_BOUNDARY",
    "FE_HOOKS_ARE_HOOKS",
    "FE_I18N_LITERAL",
    "FE_STYLE_TOKEN_ONLY",
    "FE_NATIVE_FORM_CONTROL",
    "FE_SIZE_AND_STATE_BUDGET",
    "HFS_INLINE_SUPPRESSION",
    "FE_TYPE_ESCAPE",
    "FE_LIST_KEY",
    "FE_EFFECT_CLEANUP",
    "FE_EFFECT_FETCH",
    "FE_SWALLOWED_ERROR",
    "FE_CONSOLE_CALL",
    "FE_PAGE_METADATA_MISSING",
    "FE_SUSPENSE_NULL_FALLBACK",
    "FE_I18N_NAVIGATION",
    "FE_I18N_FORMATTER",
    "FE_ROUTE_HARDCODED",
    "FE_CLIENT_SERVER_IMPORT",
    "FE_STORAGE_OUTSIDE_MODULES",
    "FE_DANGEROUS_HTML",
    "FE_NATIVE_IMAGE",
    "FE_OUTCOME_KIND_UNHANDLED",
    "FE_STACK_FORBIDDEN",
    "FE_SERVER_ACTION_FORBIDDEN",
  ]) {
    assert.ok(codes.has(code), `no rule reports under ${code}`)
  }
})

test("every workspace package is linted, whatever its name", () => {
  const eslintFiles = globsOf(source)
  for (const pkg of ["nivo-ui", "ui", "design-system"]) {
    assert.ok(eslintFiles.some((glob) => glob.startsWith("packages/*/")), `packages/${pkg} is not reached by the source block`)
  }
})

test("the Sonar way block lints the source outside the specs with the pinned sonarjs and unicorn plugins", () => {
  const sonar = blockOf(config, 2)
  const sonarRules = rulesOf(sonar)
  assert.ok(present(sonar.ignores, "the ignores of the Sonar block").some((glob) => glob.includes(".spec.")), "a spec is outside the scan")
  assert.ok(pluginsOf(sonar)["sonarjs"]?.rules && pluginsOf(sonar)["unicorn"]?.rules)
  assert.deepEqual(sonarRules["sonarjs/cognitive-complexity"], ["error", 15])
  for (const name of ["sonarjs/no-nested-template-literals", "no-duplicate-imports", "unicorn/prefer-set-has"]) assert.ok(name in sonarRules, `${name} is mapped`)
  for (const name of ["sonarjs/different-types-comparison", "sonarjs/function-return-type", "sonarjs/argument-type", "@typescript-eslint/prefer-optional-chain", "unicorn/prefer-top-level-await"]) {
    assert.equal(firstOf(sonarRules[name]), "error", `${name} is not left to the server`)
  }
  assert.deepEqual(sonarRules["unicorn/consistent-function-scoping"], ["error"], "arrow functions are judged too")
  assert.equal(rulesOf(source)["starci-fe/max-params"], "error")
  assert.equal(rulesOf(source)["starci-fe/media-has-caption"], "error")
})
