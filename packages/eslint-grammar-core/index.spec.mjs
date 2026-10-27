/** Package and factory contracts prove family adoption alongside the independent universal canon. */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { Linter } from "eslint"
import { parseYaml } from "./runtime/engine/yaml.mjs"
import { gatheredPluginSpec } from "../eslint-canon-be/fixtures/gathered-plugin.mjs"
import { FE_DECLARATION, fixtureHfs } from "../eslint-canon-fe/fixtures/typed/tester.mjs"
import { rules as universal } from "../eslint-canon-fe/index.mjs"
import plugin, { lawOwners, recommended, ruleDeclarations, rules, coreGrammarConfig, why } from "./index.mjs"
import { RULE_OWNERSHIP } from "./lib/rule-contract.mjs"

gatheredPluginSpec({ side: "grammar", dir: dirname(fileURLToPath(import.meta.url)), plugin, lawOwners, recommended, ruleDeclarations, rules })

test("family rules and universal rules have distinct owners and retain behavioral citations", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(universal[name], undefined, `${name} has two package owners`)
    assert.equal(rule.meta.docs.ownership, RULE_OWNERSHIP)
    assert.ok(rule.meta.docs.knowledge)
  }
  for (const name of Object.keys(why)) assert.ok(rules[name], `${name} has guidance without a rule`)
})

test("published family citations resolve to real knowledge files and declared YAML ids", () => {
  const documents = new Map()
  const declares = (value, anchor) => value !== null && typeof value === "object" &&
    (value.id === anchor || Object.values(value).some((child) => declares(child, anchor)))
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(rule.meta.docs.url, rule.meta.docs.knowledge, `${name} publishes two behavioral sources`)
    for (const citation of [rule.meta.docs.knowledge, rule.meta.docs.ownership]) {
      assert.match(citation, /^knowledge\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.yaml(?:#[a-zA-Z0-9-]+)?$/, `${name}: ${citation} must cite canonical knowledge YAML`)
      const [file, anchor] = citation.split("#")
      if (!documents.has(file)) documents.set(file, parseYaml(readFileSync(new URL(`./runtime/${file}`, import.meta.url), "utf8")))
      if (anchor) assert.ok(declares(documents.get(file), anchor), `${name}: ${citation} does not declare its anchor`)
    }
  }
})

test("the lint package is versioned with its Grammar family", () => {
  const manifest = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"))
  assert.equal(manifest("./package.json").version, manifest("../grammar/package.json").version)
  assert.equal(manifest("./package.json").peerDependencies["@starci/eslint-canon-fe"], manifest("../eslint-canon-fe/package.json").version)
})

test("the selected-family flat config attaches every rule at error and rejects an unrelated Grammar", () => {
  const hfs = fixtureHfs({ ...FE_DECLARATION, grammar: "core" })
  const [block] = coreGrammarConfig({ hfs })
  assert.equal(block.settings.starci.hfs, hfs)
  assert.equal(block.plugins["starci-grammar"], plugin)
  assert.deepEqual(block.files, ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"])
  assert.deepEqual(block.linterOptions, { noInlineConfig: true, reportUnusedDisableDirectives: "error" })
  for (const name of Object.keys(rules)) assert.equal(block.rules[`starci-grammar/${name}`], "error")
  assert.throws(() => coreGrammarConfig(), /FE view/)
  assert.throws(() => coreGrammarConfig({ hfs, family: "unknown" }), /does not match/)
  assert.throws(() => coreGrammarConfig({ hfs: { ...hfs, grammar: "offset-pop" } }), /does not match/)
  assert.throws(() => coreGrammarConfig({ hfs: { ...hfs, grammar: "heritage" } }), /does not match/)
  assert.throws(() => coreGrammarConfig({ hfs, family: "offset-pop" }), /does not match/)
})

test("sides.fe.grammar core, the canonical id, loads the core family config without a deprecation note", (t) => {
  const warn = t.mock.method(process, "emitWarning", () => {})
  const hfs = fixtureHfs({ ...FE_DECLARATION, grammar: "core" })
  const [block] = coreGrammarConfig({ hfs })
  assert.equal(block.plugins["starci-grammar"], plugin)
  for (const name of Object.keys(rules)) assert.equal(block.rules[`starci-grammar/${name}`], "error")
  assert.deepEqual(coreGrammarConfig({ hfs, family: "core" })[0].rules, block.rules)
  assert.equal(warn.mock.callCount(), 0)
})

test("only core and offset-pop are families; any other id, starci and starci-core included, is refused", () => {
  for (const other of ["starci", "starci-core"]) {
    assert.throws(() => coreGrammarConfig({ hfs: fixtureHfs({ ...FE_DECLARATION, grammar: other }) }), /does not match the selected Grammar/)
    assert.throws(() => coreGrammarConfig({ hfs: fixtureHfs({ ...FE_DECLARATION, grammar: "core" }), family: other }), /does not match the selected Grammar/)
  }
})

test("the family config reports a concrete status-tone violation through its public namespace", () => {
  const [block] = coreGrammarConfig({ hfs: fixtureHfs({ ...FE_DECLARATION, grammar: "core" }) })
  const linter = new Linter()
  const config = {
    ...block,
    files: ["**/*.tsx"],
    languageOptions: { ...block.languageOptions, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { "starci-grammar/status-text-uses-soft-foreground": block.rules["starci-grammar/status-text-uses-soft-foreground"] },
  }
  const source = (tone) => `import { Text } from "@starci/grammar/common"; const view = <Text className="${tone}">Saved</Text>`
  assert.deepEqual(linter.verify(source("text-success-soft-foreground"), [config], { filename: "panel.tsx" }), [])
  const findings = linter.verify(source("text-success"), [config], { filename: "panel.tsx" })
  assert.deepEqual(findings.map(({ ruleId, severity }) => ({ ruleId, severity })), [{ ruleId: "starci-grammar/status-text-uses-soft-foreground", severity: 2 }])
})
