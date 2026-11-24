import assert from "node:assert/strict"
import test from "node:test"
import { FILES, lintRule, textAt } from "./testing.ts"

const rule = (code: string, file = FILES.css) => lintRule("no-grammar-private-token", code, file)

test("refuses writing a private token of the grammar, in any stylesheet", async () => {
  const warnings = await rule(".a { --grammar-page-inset: 2rem; --starci-core-x: 1; --offset-pop-y: 2; }")
  assert.equal(warnings.length, 3)
  assert.match(textAt(warnings, 0), /--grammar-page-inset.*written/)
  assert.equal((await rule(":root { --grammar-row-gap: 1px; }", FILES.brand)).length, 1)
})

test("refuses reading a private token", async () => {
  const warnings = await rule(".a { margin: var(--grammar-row-gap); padding: var( --starci-core-fill-top , 0 ); }")
  assert.equal(warnings.length, 2)
  assert.match(textAt(warnings, 0), /--grammar-row-gap.*read/)
})

test("allows HeroUI tokens and local custom properties", async () => {
  assert.deepEqual(await rule(".a { color: var(--accent); --row-index: 3; margin: var(--spacing); }"), [])
})

test("brand.css may write a published theme hook of the grammar, and only there", async () => {
  assert.deepEqual(await rule(":root { --starci-core-card-radius: 12px; --starci-core-sidebar-weight: 2px; }", FILES.brand), [])
  assert.equal((await rule(".a { --starci-core-card-radius: 12px; }")).length, 1)
  assert.equal((await rule(":root { --starci-core-card-border: 1px solid var(--border); }", FILES.brand)).length, 1)
  assert.equal((await rule(":root { --starci-core-not-a-hook: 1; }", FILES.brand)).length, 1)
})
