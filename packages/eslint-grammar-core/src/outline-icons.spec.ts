/**
 * Twin tests for the icon law (ICONS-OUTLINE): outline icons only, never a solid icon set.
 *
 *   node --test src/outline-icons.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { outlineIconsOnly, recommended, rules } from "./outline-icons.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["outline-icons-only"])
  assert.deepEqual(recommended, { "starci-grammar/outline-icons-only": "error" })
})

test("ICONS-OUTLINE: no solid icon set is imported, anywhere", () => {
  slotTester().run("outline-icons-only", outlineIconsOnly, {
    valid: [
      { filename: BLOCK, code: "import { CheckCircleIcon } from \"@heroicons/react/24/outline\"\nexport const A = CheckCircleIcon" },
      { filename: BLOCK, code: "import { Thing } from \"./solid-things.ts\"\nexport const A = Thing" },
    ],
    invalid: [
      { filename: BLOCK, code: "import { CheckIcon } from \"@heroicons/react/16/solid\"\nexport const A = CheckIcon", errors: [{ messageId: "solid" }] },
      { filename: BLOCK, code: "import { CheckIcon } from \"@heroicons/react/20/solid\"\nexport const A = CheckIcon", errors: [{ messageId: "solid" }] },
      { filename: SCRIPT, code: "import { CheckIcon } from \"@heroicons/react/24/solid\"\nexport const A = CheckIcon", errors: [{ messageId: "solid" }] },
      { filename: BLOCK, code: "export { CheckIcon } from \"@heroicons/react/24/solid\"", errors: [{ messageId: "solid" }] },
      { filename: BLOCK, code: "import { CircleIcon } from \"@starci/heroicons/16/solid\"\nexport const A = CircleIcon", errors: [{ messageId: "solid" }] },
    ],
  })
})
