/**
 * Twin tests for the tab count law (TAB-COUNT-CHIP): a tab count is a chip from `count`, never "· N" in the label.
 *
 *   node --test src/tab-count-chip.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, tabCountChip } from "./tab-count-chip.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Tabs } from \"@starci/grammar/core\"\n"
const code = (items: string): string => `${IMPORTS}export const A = () => <Tabs label="Views" items={${items}} />`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["tab-count-chip"])
  assert.deepEqual(recommended, { "starci-grammar/tab-count-chip": "error" })
})

test("TAB-COUNT-CHIP: a tab label never ends in a middle dot and a number", () => {
  slotTester().run("tab-count-chip", tabCountChip, {
    valid: [
      { filename: BLOCK, code: code("[{ id: \"all\", label: \"All\", count: 5 }]") },
      { filename: BLOCK, code: code("[{ id: \"todo\", label: \"To approve\", count: 3, isAttention: true }]") },
      { filename: BLOCK, code: code("[{ id: \"a\", label: \"Videos \\u00b7 six\" }]") },
      { filename: BLOCK, code: "export const A = () => ({ id: \"a\", label: \"All · 5\" })" },
      { filename: SCRIPT, code: code("[{ id: \"all\", label: \"All · 5\" }]") },
    ],
    invalid: [
      { filename: BLOCK, code: code("[{ id: \"all\", label: \"All · 5\" }]"), errors: [{ messageId: "label" }] },
      { filename: BLOCK, code: code("[{ id: \"all\", label: \"All · 12\" }]"), errors: [{ messageId: "label" }] },
      { filename: BLOCK, code: "import { Tabs } from \"@starci/grammar/core\"\nconst n = 3\nexport const A = () => <Tabs label=\"Views\" items={[{ id: \"all\", label: `All · ${n}` }]} />", errors: [{ messageId: "label" }] },
    ],
  })
})
