/** The selected Offset Pop lint package enforces its inherited Common component contract. */
import assert from "node:assert/strict"
import test from "node:test"
import { Linter } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { rules as commonRules, why as commonWhy } from "@starci/eslint-grammar-core"
import plugin, { offsetPopGrammarConfig, rules, why } from "./index.ts"

const lintStatus = (code: string): Linter.LintMessage[] => new Linter().verify(code, [{
  files: ["**/*.tsx"],
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "starci-grammar": plugin },
  rules: { "starci-grammar/status-text-uses-soft-foreground": "error" },
}], { filename: "apps/web/src/components/branches/Panel/index.tsx" })

test("Offset Pop shares the authoritative Common checks and finding metadata", () => {
  assert.equal(rules, commonRules)
  assert.equal(why, commonWhy)
  assert.equal(plugin.rules, rules)
})

test("Offset Pop inherited status rule rejects a solid status text tone and accepts the soft foreground", () => {
  const imports = 'import { Text } from "@starci/grammar/offset-pop"; '
  const valid = lintStatus(imports + 'const Panel = () => <Text className="text-success-soft-foreground">Saved</Text>')
  assert.deepEqual(valid, [])
  const invalid = lintStatus(imports + 'const Panel = () => <Text className="text-success">Saved</Text>')
  assert.equal(invalid.length, 1)
  assert.equal(invalid[0]?.ruleId, "starci-grammar/status-text-uses-soft-foreground")
  assert.equal(invalid[0]?.messageId, "solid")
  assert.equal(invalid[0]?.severity, 2)
})

const PANE_RULES = ["pane-grid-children", "pane-children", "no-pane-section-padding", "pane-grid-page"]

const lintPanes = (code: string): Linter.LintMessage[] => new Linter().verify(code, [{
  files: ["**/*.tsx"],
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "starci-grammar": plugin },
  settings: { starci: { hfs: { slotOf: () => "fe.components", tierOf: () => "components", classify: () => ({ status: "owned", slot: "fe.components", kind: "blocks" }) } } },
  rules: Object.fromEntries(PANE_RULES.map((name) => [`starci-grammar/${name}`, "error"])),
}], { filename: "apps/web/src/components/blocks/Category/component.tsx" })

test("Offset Pop inherits the pane laws: a wrapper in a PaneGrid, a raw child of a Pane, section padding and a grid in a card are findings", () => {
  for (const name of PANE_RULES) assert.ok(name in rules, name)
  const imports = 'import { FillViewport, Pane, PaneGrid, PaneSection } from "@starci/grammar/offset-pop"; import { CategoryPane } from "./CategoryPane"; '
  assert.deepEqual(lintPanes(imports + 'const A = () => <PaneGrid areas={{ base: ["a"] }}><Pane area="a"><PaneSection><span /></PaneSection></Pane></PaneGrid>'), [])
  const invalid = [
    ["pane-grid-children", 'const A = () => <PaneGrid areas={{ base: ["a"] }}><CategoryPane area="a" /></PaneGrid>'],
    ["pane-children", 'const A = () => <Pane area="a"><div className="px-4" /></Pane>'],
    ["no-pane-section-padding", 'const A = () => <PaneSection><div className="px-4 pt-3" /></PaneSection>'],
    ["pane-grid-page", 'const A = () => <FillViewport><PaneGrid areas={{ base: ["a"] }} /></FillViewport>'],
  ] as const
  for (const [name, code] of invalid) {
    const found = lintPanes(imports + code)
    assert.equal(found.length, 1, name)
    assert.equal(found[0]?.ruleId, `starci-grammar/${name}`)
  }
})

/** The factory's input with the family id widened to a string, for the views the factory must refuse. */
type FactoryInput = Parameters<typeof offsetPopGrammarConfig>[0]
type RefusedInput = { readonly hfs: Omit<FactoryInput["hfs"], "grammar"> & { readonly grammar: string } }
const refused = (input: RefusedInput): FactoryInput => input as FactoryInput

test("Offset Pop flat config attaches every inherited rule at error without an override door", () => {
  const hfs: FactoryInput["hfs"] = { profile: "fe", grammar: "offset-pop", repoRoot: process.cwd(), slotOf: () => null }
  const config = offsetPopGrammarConfig({ hfs })
  const attached = new Map<string, unknown>(config.flatMap((entry) => Object.entries(entry.rules ?? {})))
  for (const rule of Object.keys(rules)) assert.equal(attached.get(`starci-grammar/${rule}`), "error")
  assert.ok(config.some((entry) => entry.plugins?.["starci-grammar"] === plugin))
  assert.ok(config.some((entry) => entry.linterOptions?.noInlineConfig === true))
  for (const other of ["core", "starci", "starci-core", "heritage"]) {
    assert.throws(() => offsetPopGrammarConfig(refused({ hfs: { ...hfs, grammar: other } })), /does not match the selected Grammar/)
  }
})
