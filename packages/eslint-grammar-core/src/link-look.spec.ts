/**
 * Twin tests for the Link look law (LINK-LOOK): a Link inherits its size and keeps HeroUI's hover underline.
 *
 *   node --test src/link-look.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { linkLook, recommended, rules } from "./link-look.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Link } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["link-look"])
  assert.deepEqual(recommended, { "starci-grammar/link-look": "error" })
})

test("LINK-LOOK: a Link takes no size prop, size class or underline class", () => {
  slotTester().run("link-look", linkLook, {
    valid: [
      { filename: BLOCK, code: code("<Link href=\"/runs\">Runs</Link>") },
      { filename: BLOCK, code: code("<Link href=\"/runs\" kind=\"external\">Docs</Link>") },
      { filename: BLOCK, code: "export const A = () => <a href=\"/x\" className=\"underline text-sm\">x</a>" },
      { filename: SCRIPT, code: code("<Link href=\"/runs\" size=\"sm\">Runs</Link>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Link href=\"/runs\" size=\"sm\">Runs</Link>"), errors: [{ messageId: "size" }] },
      { filename: BLOCK, code: code("<Link href=\"/runs\" className=\"text-sm\">Runs</Link>"), errors: [{ messageId: "class" }] },
      { filename: BLOCK, code: code("<Link href=\"/runs\" className=\"underline\">Runs</Link>"), errors: [{ messageId: "class" }] },
      { filename: BLOCK, code: code("<Link href=\"/runs\" className=\"hover:no-underline\">Runs</Link>"), errors: [{ messageId: "class" }] },
    ],
  })
})
