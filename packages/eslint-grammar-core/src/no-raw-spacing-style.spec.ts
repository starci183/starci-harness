/**
 * Twin tests for the spacing-roles law (SPACING-ROLES): no raw gap, padding or margin in a JSX style.
 *
 *   node --test src/no-raw-spacing-style.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noRawSpacingStyle, recommended, rules } from "./no-raw-spacing-style.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const code = (body: string): string => `export const A = () => ${body}`

test("the law publishes one rule and it counts at warn", () => {
  assert.deepEqual(Object.keys(rules), ["no-raw-spacing-style"])
  assert.deepEqual(recommended, { "starci-grammar/no-raw-spacing-style": "warn" })
})

test("SPACING-ROLES: a gap, padding or margin in a JSX style is reported; other keys and other objects are not", () => {
  slotTester().run("no-raw-spacing-style", noRawSpacingStyle, {
    valid: [
      { filename: BLOCK, code: code("<div style={{ width: 12, transform: \"none\" }} />") },
      { filename: BLOCK, code: "const option = { padding: 12, gap: 4 }\nexport const A = () => <div data-x={option} />" },
      { filename: SCRIPT, code: code("<div style={{ gap: 12 }} />") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<div style={{ gap: 12 }} />"), errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: code("<div style={{ paddingInline: \"1rem\", marginTop: 8 }} />"), errors: [{ messageId: "raw" }, { messageId: "raw" }] },
      { filename: BLOCK, code: code("<div style={{ \"column-gap\": \"8px\" }} />"), errors: [{ messageId: "raw" }] },
    ],
  })
})
