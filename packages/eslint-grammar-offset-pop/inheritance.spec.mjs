/** The selected Offset Pop lint package enforces its inherited Common component contract. */
import assert from "node:assert/strict"
import test from "node:test"
import { Linter } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { rules as commonRules, why as commonWhy } from "@starci/eslint-grammar-core"
import plugin, { offsetPopGrammarConfig, rules, why } from "./index.mjs"

const lintStatus = (code) => new Linter().verify(code, [{
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
  assert.equal(invalid[0].ruleId, "starci-grammar/status-text-uses-soft-foreground")
  assert.equal(invalid[0].messageId, "solid")
  assert.equal(invalid[0].severity, 2)
})

test("Offset Pop flat config attaches every inherited rule at error without an override door", () => {
  const hfs = { profile: "fe", grammar: "offset-pop", repoRoot: process.cwd(), slotOf: () => null }
  const config = offsetPopGrammarConfig({ hfs })
  const attached = Object.assign({}, ...config.map((entry) => entry.rules ?? {}))
  for (const rule of Object.keys(rules)) assert.equal(attached[`starci-grammar/${rule}`], "error")
  assert.ok(config.some((entry) => entry.plugins?.["starci-grammar"] === plugin))
  assert.ok(config.some((entry) => entry.linterOptions?.noInlineConfig === true))
  for (const other of ["core", "starci", "starci-core", "heritage"]) {
    assert.throws(() => offsetPopGrammarConfig({ hfs: { ...hfs, grammar: other } }), /does not match the selected Grammar/)
  }
})
