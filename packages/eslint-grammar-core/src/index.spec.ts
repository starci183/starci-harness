/** Package and factory contracts prove family adoption alongside the independent universal canon. */
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test, { after } from "node:test"
import { Linter } from "eslint"
import type { Rule } from "eslint"
import { parseYaml } from "../runtime/engine/yaml.mjs"
import { gatheredPluginSpec } from "../../eslint-canon-be/fixtures/gathered-plugin.ts"
import { FE_DECLARATION, fixtureHfs } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { rules as universal } from "../../eslint-canon-fe/src/index.ts"
import plugin, { lawOwners, recommended, ruleDeclarations, rules, coreGrammarConfig, why } from "./index.ts"
import { RULE_OWNERSHIP } from "./lib/rule-contract.ts"

/**
 * The gathered-plugin contract lists the law modules of a folder by their `.mjs` names. The sources here are `.ts`, so the
 * folder it reads is a mirror of this one with every law module named as the contract expects.
 */
const SOURCE_DIR = dirname(fileURLToPath(import.meta.url))
const lawFolder = mkdtempSync(join(tmpdir(), "grammar-core-laws-"))
for (const name of readdirSync(SOURCE_DIR)) {
  if (name.endsWith(".ts") && !name.endsWith(".d.ts")) writeFileSync(join(lawFolder, name.replace(/\.ts$/, ".mjs")), "")
}
after(() => rmSync(lawFolder, { recursive: true, force: true }))

const pluginRules = plugin.rules
assert.ok(pluginRules, "the plugin publishes its rules")
gatheredPluginSpec({ side: "grammar", dir: lawFolder, plugin: { ...plugin, rules: pluginRules }, lawOwners, recommended, ruleDeclarations, rules })

/** The behavioral citations `defineFamilyRules` attaches to a rule's docs. */
const citationsOf = (rule: Rule.RuleModule): { readonly url: unknown; readonly knowledge: unknown; readonly ownership: unknown } => {
  const docs = rule.meta?.docs
  return {
    url: docs?.url,
    knowledge: docs !== undefined && "knowledge" in docs ? docs.knowledge : undefined,
    ownership: docs !== undefined && "ownership" in docs ? docs.ownership : undefined,
  }
}

test("family rules and universal rules have distinct owners and retain behavioral citations", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(universal[name], undefined, `${name} has two package owners`)
    const citations = citationsOf(rule)
    assert.equal(citations.ownership, RULE_OWNERSHIP)
    assert.ok(citations.knowledge)
  }
  for (const name of Object.keys(why)) assert.ok(rules[name], `${name} has guidance without a rule`)
})

test("published family citations resolve to real knowledge files and declared YAML ids", () => {
  const documents = new Map<string, unknown>()
  const declares = (value: unknown, anchor: string): boolean => value !== null && typeof value === "object" &&
    ("id" in value && value.id === anchor || Object.values(value as Record<string, unknown>).some((child) => declares(child, anchor)))
  for (const [name, rule] of Object.entries(rules)) {
    const citations = citationsOf(rule)
    assert.equal(citations.url, citations.knowledge, `${name} publishes two behavioral sources`)
    for (const citation of [citations.knowledge, citations.ownership]) {
      assert.ok(typeof citation === "string", `${name} cites no knowledge file`)
      assert.match(citation, /^knowledge\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.yaml(?:#[a-zA-Z0-9-]+)?$/, `${name}: ${citation} must cite canonical knowledge YAML`)
      const [file, anchor] = citation.split("#")
      assert.ok(file !== undefined)
      if (!documents.has(file)) documents.set(file, parseYaml(readFileSync(new URL(`../runtime/${file}`, import.meta.url), "utf8")))
      if (anchor) assert.ok(declares(documents.get(file), anchor), `${name}: ${citation} does not declare its anchor`)
    }
  }
})

test("the lint package is versioned with its Grammar family", () => {
  const manifest = (relative: string): object => {
    const parsed: unknown = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"))
    assert.ok(typeof parsed === "object" && parsed !== null)
    return parsed
  }
  const field = (target: object, key: string): unknown => Reflect.get(target, key)
  const peerOf = (relative: string, name: string): unknown => {
    const peers = field(manifest(relative), "peerDependencies")
    assert.ok(typeof peers === "object" && peers !== null)
    return field(peers, name)
  }
  assert.equal(field(manifest("../package.json"), "version"), field(manifest("../../grammar/package.json"), "version"))
  assert.equal(peerOf("../package.json", "@starci/eslint-canon-fe"), field(manifest("../../eslint-canon-fe/package.json"), "version"))
})

/** The factory's input with the family ids widened to strings, for the inputs the factory must refuse. */
type FactoryInput = Parameters<typeof coreGrammarConfig>[0]
type RefusedInput = { readonly hfs: Omit<FactoryInput["hfs"], "grammar"> & { readonly grammar: string }; readonly family?: string }
const refused = (input: RefusedInput): FactoryInput => input as FactoryInput

/** The one block of a family config. */
const only = (configs: Linter.Config[]): Linter.Config => {
  const [first] = configs
  assert.ok(first)
  return first
}

test("the selected-family flat config attaches every rule at error and rejects an unrelated Grammar", () => {
  const hfs = fixtureHfs({ ...FE_DECLARATION, grammar: "core" })
  const block = only(coreGrammarConfig({ hfs }))
  const starci = block.settings?.["starci"]
  assert.ok(typeof starci === "object" && starci !== null && "hfs" in starci)
  assert.equal(starci.hfs, hfs)
  assert.equal(block.plugins?.["starci-grammar"], plugin)
  assert.deepEqual(block.files, ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"])
  assert.deepEqual(block.linterOptions, { noInlineConfig: true, reportUnusedDisableDirectives: "error" })
  for (const name of Object.keys(rules)) assert.equal(block.rules?.[`starci-grammar/${name}`], "error")
  assert.throws(() => (coreGrammarConfig as () => Linter.Config[])(), /FE view/)
  assert.throws(() => coreGrammarConfig(refused({ hfs, family: "unknown" })), /does not match/)
  assert.throws(() => coreGrammarConfig(refused({ hfs: { ...hfs, grammar: "offset-pop" } })), /does not match/)
  assert.throws(() => coreGrammarConfig(refused({ hfs: { ...hfs, grammar: "heritage" } })), /does not match/)
  assert.throws(() => coreGrammarConfig({ hfs, family: "offset-pop" }), /does not match/)
})

test("sides.fe.grammar core, the canonical id, loads the core family config without a deprecation note", (t) => {
  const warn = t.mock.method(process, "emitWarning", () => {})
  const hfs = fixtureHfs({ ...FE_DECLARATION, grammar: "core" })
  const block = only(coreGrammarConfig({ hfs }))
  assert.equal(block.plugins?.["starci-grammar"], plugin)
  for (const name of Object.keys(rules)) assert.equal(block.rules?.[`starci-grammar/${name}`], "error")
  assert.deepEqual(only(coreGrammarConfig({ hfs, family: "core" })).rules, block.rules)
  assert.equal(warn.mock.callCount(), 0)
})

test("only core and offset-pop are families; any other id, starci and starci-core included, is refused", () => {
  for (const other of ["starci", "starci-core"]) {
    assert.throws(() => coreGrammarConfig(refused({ hfs: fixtureHfs({ ...FE_DECLARATION, grammar: other }) })), /does not match the selected Grammar/)
    assert.throws(() => coreGrammarConfig(refused({ hfs: fixtureHfs({ ...FE_DECLARATION, grammar: "core" }), family: other })), /does not match the selected Grammar/)
  }
})

test("the family config reports a concrete status-tone violation through its public namespace", () => {
  const block = only(coreGrammarConfig({ hfs: fixtureHfs({ ...FE_DECLARATION, grammar: "core" }) }))
  const linter = new Linter()
  const config: Linter.Config = {
    ...block,
    files: ["**/*.tsx"],
    languageOptions: { ...block.languageOptions, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { "starci-grammar/status-text-uses-soft-foreground": block.rules?.["starci-grammar/status-text-uses-soft-foreground"] },
  }
  const source = (tone: string): string => `import { Text } from "@starci/grammar/common"; const view = <Text className="${tone}">Saved</Text>`
  assert.deepEqual(linter.verify(source("text-success-soft-foreground"), [config], { filename: "panel.tsx" }), [])
  const findings = linter.verify(source("text-success"), [config], { filename: "panel.tsx" })
  assert.deepEqual(findings.map(({ ruleId, severity }) => ({ ruleId, severity })), [{ ruleId: "starci-grammar/status-text-uses-soft-foreground", severity: 2 }])
})
