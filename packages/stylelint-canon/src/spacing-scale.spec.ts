import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import stylelint from "stylelint"
import { spacingScale } from "./spacing-scale.ts"
import { lintRule, textAt } from "./testing.ts"

const rule = (declarations: string) => lintRule("spacing-scale", `[data-a] { ${declarations} }`, "apps/web/src/app/x.css")

test("accepts every step of the scale, in rem or px, either sign, in a fallback or a calc term", async () => {
  assert.deepEqual(await rule("padding: 0.75rem; gap: 0.25rem 0.5rem; margin-block: 1.5rem 2rem;"), [])
  assert.deepEqual(await rule("padding-inline: 12px 24px; row-gap: 32px; column-gap: 4px;"), [])
  assert.deepEqual(await rule("margin-inline: calc(-1 * var(--grammar-inset, 0.75rem)); padding: var(--grammar-row-gap, 0.75rem);"), [])
  assert.deepEqual(await rule("margin: -1px; gap: 1px; padding: 2px; padding-block: 0;"), [])
})

test("refuses a length between the steps, and the removed 16 step, wherever it is written", async () => {
  const meter = await rule("gap: 0.375rem;")
  assert.equal(meter.length, 1)
  assert.match(textAt(meter, 0), /gap: 0\.375rem.*not a step of the spacing scale/)
  assert.equal((await rule("padding: 1rem;")).length, 1)
  assert.equal((await rule("padding: 16px;")).length, 1)
  assert.equal((await rule("margin: -3px; padding: 3px;")).length, 2)
  assert.equal((await rule("padding: var(--grammar-inset, 1rem);")).length, 1)
  assert.equal((await rule("gap: calc(1rem + 2px);")).length, 1)
  assert.equal((await rule("--grammar-pane-inset-inline: 1rem;")).length, 1)
})

test("refuses a fluid spacing value", async () => {
  const warnings = await rule("padding-inline: clamp(1rem, 3vw, 2rem);")
  assert.ok(warnings.some((warning) => /fluid/.test(warning.text)))
  assert.equal((await rule("gap: 2vw;")).length, 1)
})

test("does not judge widths, positions, font-relative or proportional lengths", async () => {
  assert.deepEqual(await rule("width: 1rem; inset-block-start: 1rem; padding: 0.125em 0.375em; margin-inline: 5%;"), [])
})

// The Grammar keeps no spec suite (contexts/authority/packages.md), so its stylesheets are judged here, read from the
// sibling package by relative path (packages/README.md).
const here = path.dirname(fileURLToPath(import.meta.url))
const grammarSrc = path.resolve(here, "..", "..", "grammar", "src")

test("every Grammar stylesheet keeps its spacing on the scale", async () => {
  const sheets = ["common", "core", "offset-pop"].flatMap((entry) => fs.readdirSync(path.join(grammarSrc, entry)).filter((name) => name.endsWith(".css")).map((name) => path.join(grammarSrc, entry, name)))
  assert.ok(sheets.length > 5)
  const found: string[] = []
  for (const file of sheets) {
    const result = await stylelint.lint({ code: fs.readFileSync(file, "utf8"), codeFilename: file, config: { plugins: [spacingScale.plugin], rules: { [spacingScale.ruleName]: true } } })
    for (const warning of result.results[0]?.warnings ?? []) found.push(`${path.relative(grammarSrc, file)}:${String(warning.line)} ${warning.text}`)
  }
  assert.deepEqual(found, [])
})
