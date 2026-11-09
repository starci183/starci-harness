/**
 * Twin tests for the raw-scroll law (NO-RAW-SCROLL): an app scroll area is a Grammar scroller.
 *
 *   node --test src/no-raw-scroll.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noRawScroll, recommended, rules } from "./no-raw-scroll.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const code = (body: string): string => `export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-raw-scroll"])
  assert.deepEqual(recommended, { "starci-grammar/no-raw-scroll": "error" })
})

test("NO-RAW-SCROLL: an app element with an overflow auto or scroll class is refused", () => {
  slotTester().run("no-raw-scroll", noRawScroll, {
    valid: [
      { filename: BLOCK, code: code("<div className=\"overflow-hidden\" />") },
      { filename: BLOCK, code: code("<div className=\"overflow-clip overflow-visible\" />") },
      { filename: BLOCK, code: code("<div className=\"overflow-autofoo\" />") },
      { filename: SCRIPT, code: code("<div className=\"overflow-y-auto\" />") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<div className=\"flex overflow-y-auto\" />"), errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: code("<div className=\"overflow-auto\" />"), errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: code("<div className={cn(\"flex\", open && \"md:overflow-x-scroll\")} />"), errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: code("<div className={`p-2 overflow-y-auto`} />"), errors: [{ messageId: "raw" }] },
    ],
  })
})
