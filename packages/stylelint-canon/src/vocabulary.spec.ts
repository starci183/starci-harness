/**
 * The vocabulary the rules judge against is HeroUI's theme and the grammar's own: this twin test recomputes it from the grammar CSS snapshot
 * in fixtures/grammar/src and HeroUI's variables in fixtures/heroui, and fails when `lib/vocabulary.generated.ts` is stale (run `npm run vocabulary`).
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import postcss, { AtRule } from "postcss"
import type { Container, Document } from "postcss"
import { extractHeroTokens, extractVocabulary, FAMILY_PREFIXES, GRAMMAR_CSS, HEROUI_VARIABLES } from "./lib/extract-vocabulary.ts"
import { BREAKPOINTS, DECLARED, STATUS_TONES, VENDOR } from "./lib/vocabulary.generated.ts"
import { isGrammarToken, isKnownToken } from "./lib/vocabulary.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
const grammarSrc = path.resolve(here, "..", "fixtures", "grammar", "src")
const heroVariables = path.resolve(here, "..", HEROUI_VARIABLES)

test("the generated vocabulary equals what the grammar CSS declares and reads", () => {
  const fresh = extractVocabulary(grammarSrc, heroVariables)
  assert.deepEqual(DECLARED, fresh.declared, "DECLARED is stale: run `npm run vocabulary` in packages/stylelint")
  assert.deepEqual(VENDOR, fresh.vendor, "VENDOR is stale: run `npm run vocabulary` in packages/stylelint")
  assert.deepEqual(BREAKPOINTS, fresh.breakpoints, "BREAKPOINTS is stale: run `npm run vocabulary` in packages/stylelint")
  assert.deepEqual(STATUS_TONES, fresh.statusTones, "STATUS_TONES is stale: run `npm run vocabulary` in packages/stylelint")
})

test("the four family namespaces and the semantic layer are grammar tokens", () => {
  assert.deepEqual(FAMILY_PREFIXES, ["--grammar-", "--starci-core-", "--offset-pop-"])
  for (const name of ["--grammar-inline-gap", "--starci-core-anything", "--offset-pop-shadow", "--accent", "--surface", "--radius-lg", "--font-mono", "--font-sans"]) {
    assert.ok(isGrammarToken(name), name)
  }
})

test("a private namespace is not a grammar token, unless the repository declared it", () => {
  assert.equal(isGrammarToken("--nv-ink"), false)
  assert.equal(isKnownToken("--nv-ink"), false)
  assert.equal(isKnownToken("--nv-ink", ["--nv-ink"]), true)
})

test("every status tone has a solid pair and a soft pair in the vocabulary, info included", () => {
  assert.deepEqual(STATUS_TONES, ["success", "warning", "danger", "info"])
  for (const tone of STATUS_TONES) {
    for (const name of [`--${tone}`, `--${tone}-foreground`, `--${tone}-soft`, `--${tone}-soft-foreground`, `--${tone}-soft-hover`]) assert.ok(isGrammarToken(name), name)
  }
  assert.equal(isGrammarToken("--info-soft-foreground"), true)
  assert.equal(isGrammarToken("--info-softer"), false)
})

test("the grammar declares no HeroUI theme token on its root: the app sets them", () => {
  const hero = new Set(extractHeroTokens(fs.readFileSync(heroVariables, "utf8")))
  for (const name of ["--accent", "--background", "--surface", "--foreground", "--muted", "--border", "--scrollbar", "--radius"]) assert.ok(hero.has(name), `${name} is a HeroUI token`)
  const ROOT = /^\.grammar-common-root(?:\[[^\]]*\])*$/
  const found: string[] = []
  for (const file of GRAMMAR_CSS) {
    postcss.parse(fs.readFileSync(path.join(grammarSrc, file), "utf8")).walkRules((rule) => {
      if (!rule.selectors.every((selector) => ROOT.test(selector.trim()))) return
      // The reader's system colours (forced-colors) replace the theme; nothing else may.
      let forced = false
      for (let parent: Container | Document | undefined = rule.parent; parent !== undefined; parent = parent.parent) {
        if (parent instanceof AtRule && /forced-colors/.test(parent.params)) forced = true
      }
      if (forced) return
      rule.each((child) => {
        if (child.type === "decl" && hero.has(child.prop)) found.push(`${file}: ${rule.selector} { ${child.prop} }`)
      })
    })
  }
  assert.deepEqual(found, [])
})

test("every status tone but info has its solid pair in HeroUI, and the generator refuses one that has not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grammar-src-"))
  try {
    for (const file of GRAMMAR_CSS) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), ".grammar-common-root { }")
    }
    const variables = path.join(dir, "variables.css")
    fs.writeFileSync(variables, ":root { --success: red; --success-foreground: white; --warning: red; --warning-foreground: white; }")
    assert.throws(() => extractVocabulary(dir, variables), /lists danger, but HeroUI does not declare --danger/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
