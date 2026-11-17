/**
 * Twin tests for the one-look list law (LIST-ONE-LOOK): a list is `Section kind="list"`, never `SurfaceCard kind="list"`.
 *
 *   node --test src/surface-card-list.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, surfaceCardList } from "./surface-card-list.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Section, SurfaceCard, Text } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["surface-card-list"])
  assert.deepEqual(recommended, { "starci-grammar/surface-card-list": "error" })
})

test("LIST-ONE-LOOK: a list is a Section of rows, never a list card", () => {
  slotTester().run("surface-card-list", surfaceCardList, {
    valid: [
      { filename: BLOCK, code: code("<Section kind=\"list\" title=\"Runs\" items={runs} empty={null} />") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Plan\"><Text>Team</Text></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard kind=\"table\" label=\"Runs\" columns={columns} rows={rows} empty={null} />") },
      // a kind that is not a literal is the compiler's to judge
      { filename: BLOCK, code: code("<SurfaceCard kind={kind} label=\"Runs\" items={runs} empty={null} />") },
      // another source's card
      { filename: BLOCK, code: "import { SurfaceCard } from \"other-kit\"\nexport const A = () => <SurfaceCard kind=\"list\" />" },
      { filename: SCRIPT, code: code("<SurfaceCard kind=\"list\" label=\"Runs\" items={runs} empty={null} />") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<SurfaceCard kind=\"list\" label=\"Runs\" items={runs} empty={null} />"), errors: [{ messageId: "list" }] },
      { filename: BLOCK, code: code("<SurfaceCard kind={\"list\"} layout=\"suggestions\" ariaLabel=\"Replies\" items={replies} empty={null} />"), errors: [{ messageId: "list" }] },
      { filename: BLOCK, code: "import * as G from \"@starci/grammar\"\nexport const A = () => <G.SurfaceCard kind=\"list\" label=\"Runs\" items={runs} empty={null} />", errors: [{ messageId: "list" }] },
    ],
  })
})
