import assert from "node:assert/strict"
import test from "node:test"
import { FILES, lintRule, textAt } from "./testing.ts"

const rule = (code: string, file?: string) => lintRule("no-self-reference", code, file)

test("refuses a custom property whose value is var of itself, in every stylesheet kind", async () => {
  for (const file of Object.values(FILES)) {
    const warnings = await rule(":root { --accent: var(--accent); }", file)
    assert.equal(warnings.length, 1, file)
    assert.match(textAt(warnings, 0), /--accent/)
  }
})

test("refuses it with a fallback, with spaces, and inside a larger value", async () => {
  assert.equal((await rule(":root { --focus: var(--focus, red); }")).length, 1)
  assert.equal((await rule(":root { --focus: var( --focus ); }")).length, 1)
  assert.equal((await rule(":root { --soft: color-mix(in oklab, var(--soft) 70%, black); }")).length, 1)
})

test("refuses the twenty aliases a rename left behind, one finding each", async () => {
  const names = ["accent", "accent-foreground", "accent-soft", "focus", "background", "surface", "surface-secondary", "surface-tertiary", "foreground", "muted", "border", "separator", "success", "success-foreground", "warning", "warning-foreground", "danger", "danger-foreground", "info", "info-foreground"]
  const block = `:root, .light, .dark {\n${names.map((name) => `  --${name}: var(--${name});`).join("\n")}\n}`
  assert.equal((await rule(block)).length, 20)
})

test("accepts a token that reads another token, a longer name and an ordinary property", async () => {
  assert.deepEqual(await rule(":root { --accent-soft: var(--accent); --accent-foreground: var(--accent-foreground-base); color: var(--accent); }"), [])
  assert.deepEqual(await rule(":root { --a: var(--ab); --ab: 1; }"), [])
})
