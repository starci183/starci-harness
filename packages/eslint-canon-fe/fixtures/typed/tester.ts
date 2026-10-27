/**
 * The typed rule tester of the front-end canon: RuleTester over @typescript-eslint/parser with the project service on this
 * directory's tsconfig.json (JSX on), and `settings.starci.hfs` built from an in-memory hfs.json - the same inputs
 * starciFeConfig gives a repository. A case's `filename` is `at("apps/web/src/hooks/lesson/useLesson.ts")`: the file need not
 * exist; its slot comes from its path and its types from the library stubs in ./node_modules.
 * The RuleTester itself is the shared factory of ../../../eslint-canon-be/fixtures/typed/tester.mjs - one implementation, one side's
 * dialect and cap per caller.
 *
 * Every tester here is a `CanonRuleTester`: ESLint's RuleTester, taking the canon's typescript-eslint rule modules
 * (src/lib/eslint-boundary.ts joins the two type views).
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import tsParser from "@typescript-eslint/parser"
import { RuleTester } from "eslint"
import { eslintRule } from "../../src/lib/eslint-boundary.ts"
import { hfsFromDeclaration, type HfsView } from "../../src/lib/hfs.ts"
import { defineRule, type AnyContext, type Rule } from "../../src/lib/rule.ts"
import { appDeclaration } from "../../../eslint-canon-be/fixtures/app.mjs"
import { ruleTester } from "../../../eslint-canon-be/fixtures/typed/tester.mjs"

/** The cases RuleTester runs: ESLint's own test-case shape. */
export type RuleTests = Parameters<RuleTester["run"]>[2]

/** A RuleTester that runs the canon's rules. */
export interface CanonRuleTester {
  run(name: string, rule: Rule<string, readonly unknown[]>, tests: RuleTests): void
}

/** ESLint's RuleTester, taking the canon's rules. */
export const canonTester = (tester: RuleTester): CanonRuleTester => ({
  run: (name, rule, tests) => tester.run(name, eslintRule(rule), tests),
})

/** The fixture repository root. */
export const TYPED_ROOT = dirname(fileURLToPath(import.meta.url))

/** The fe side of an app declaration: its apps and the optional slots it turns on. */
export interface FeDeclaration {
  readonly apps: readonly { readonly name: string; readonly kind: string }[]
  readonly optionalSlots?: readonly string[]
  readonly [field: string]: unknown
}

/** The default fe side of the fixture app (hfs.json sides.fe): two apps and the shared packages. */
export const FE_DECLARATION: FeDeclaration = Object.freeze({
  apps: [{ name: "web", kind: "next" }, { name: "admin", kind: "next" }],
  optionalSlots: ["repo.packages", "fe.package.ui", "fe.package.api", "fe.package.i18n"],
})

/** The fe side of a lite fixture app: one app on a Supabase connection, no packages. */
export const LITE_FE_DECLARATION: FeDeclaration = Object.freeze({ apps: [{ name: "web", kind: "next" }] })

const SUPABASE_CONNECTION = { name: "primary", envPrefix: "PRIMARY_DB", owner: "core", isolation: "schema", provider: "supabase" }

/** An app declaration as the fixture reads it: the sides it spreads. */
interface AppDeclaration {
  readonly sides: { readonly be: Readonly<Record<string, unknown>>; readonly [side: string]: unknown }
  readonly [field: string]: unknown
}

/** True for an app declaration with a back-end side to extend. */
const isAppDeclaration = (value: unknown): value is AppDeclaration =>
  typeof value === "object" && value !== null && "sides" in value &&
  typeof value.sides === "object" && value.sides !== null && "be" in value.sides && typeof value.sides.be === "object"

/** The app declaration a fixture lints under: `lite` makes it an edition-lite app with a Supabase connection. */
const fixtureApp = (declaration: FeDeclaration, lite: boolean): unknown => {
  const app: unknown = appDeclaration("fe", declaration)
  if (!lite) return app
  if (!isAppDeclaration(app)) throw new TypeError("the shared fixture app declaration has no back-end side")
  return { ...app, edition: "lite", sides: { ...app.sides, be: { ...app.sides.be, connections: [SUPABASE_CONNECTION] } } }
}

/** The options of a fixture tester: the fe side declared and whether the app is edition lite. */
export interface FixtureOptions {
  readonly declaration?: FeDeclaration | undefined
  readonly lite?: boolean | undefined
}

/** The HFS view of the fixture fe side (`declaration` is the fe side of the app; `lite` lints it as an edition-lite app). */
export const fixtureHfs = (declaration: FeDeclaration = FE_DECLARATION, { lite = false }: FixtureOptions = {}): HfsView =>
  hfsFromDeclaration(fixtureApp(declaration, lite), TYPED_ROOT)

/** The absolute filename of a fixture-relative path. */
export const at = (rel: string): string => join(TYPED_ROOT, rel)

/** A RuleTester with typed linting, JSX and the fixture HFS settings. */
export const typedTester = ({ declaration, lite }: FixtureOptions = {}): CanonRuleTester =>
  canonTester(ruleTester({ root: TYPED_ROOT, hfs: fixtureHfs(declaration, { lite }), jsx: true, extensions: ["ts", "tsx"], maxDepth: 10, maxProjects: 1000 }))

/** A RuleTester with the fixture HFS settings and a syntax-only parser, for rules that read slots but no types. */
export const slotTester = ({ declaration }: FixtureOptions = {}): CanonRuleTester => canonTester(new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { starci: { hfs: fixtureHfs(declaration) } },
}))

/** The real rule context ESLint gives a rule linting `filename` with `hfs` in its settings. */
export const contextAt = (filename: string, hfs: HfsView): AnyContext => {
  let captured: AnyContext | undefined
  const probe = defineRule({
    meta: { type: "problem", schema: [], messages: {} },
    create(context) {
      captured = context
      return {}
    },
  })
  canonTester(new RuleTester({ settings: { starci: { hfs } } })).run("context", probe, { valid: [{ filename, code: "" }], invalid: [] })
  if (captured === undefined) throw new Error("the probe rule never ran")
  return captured
}
