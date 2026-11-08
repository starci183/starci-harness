/**
 * Twin tests for the two-axis layout law (LAYOUT-TWO-AXIS): a report page stacks cards in one direction.
 *
 *   node --test src/layout-two-axis.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { layoutTwoAxis, recommended, rules } from "./layout-two-axis.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Grid, Cluster, Stack, SurfaceCard, Text } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["layout-two-axis"])
  assert.deepEqual(recommended, { "starci-grammar/layout-two-axis": "error" })
})

test("LAYOUT-TWO-AXIS: a card beside a column of cards, or unequal cards in a row, is refused", () => {
  slotTester().run("layout-two-axis", layoutTwoAxis, {
    valid: [
      // one vertical column
      { filename: BLOCK, code: code("<Stack gap=\"section\"><SurfaceCard kind=\"figures\" /><SurfaceCard label=\"Runs\"><Text>x</Text></SurfaceCard></Stack>") },
      // sibling cards of one role side by side
      { filename: BLOCK, code: code("<Grid kind=\"pair\" leading={<SurfaceCard kind=\"figures\" />} trailing={<SurfaceCard kind=\"figures\" />} />") },
      { filename: BLOCK, code: code("<Cluster><SurfaceCard kind=\"figures\" /><SurfaceCard kind=\"figures\" /></Cluster>") },
      { filename: BLOCK, code: code("<Grid kind=\"cards\">{items.map((i) => <SurfaceCard key={i} kind=\"tile\" />)}</Grid>") },
      // a task and its rail
      { filename: BLOCK, code: code("<Grid kind=\"main-rail\"><SurfaceCard kind=\"figures\" /><SurfaceCard kind=\"details\" /></Grid>") },
      // a Stack of one card beside a card is not a column of cards
      { filename: BLOCK, code: code("<Cluster><SurfaceCard /><Stack><SurfaceCard /></Stack></Cluster>") },
      // a spread may carry the kind
      { filename: BLOCK, code: code("<Cluster><SurfaceCard kind=\"figures\" /><SurfaceCard {...p} /></Cluster>") },
      { filename: SCRIPT, code: code("<Cluster><SurfaceCard /><Stack><SurfaceCard /><SurfaceCard /></Stack></Cluster>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Grid><SurfaceCard label=\"Runs\" /><Stack><SurfaceCard label=\"A\" /><SurfaceCard label=\"B\" /></Stack></Grid>"), errors: [{ messageId: "beside" }] },
      { filename: BLOCK, code: code("<Cluster><Stack><SurfaceCard /><SurfaceCard /></Stack><SurfaceCard /></Cluster>"), errors: [{ messageId: "beside" }] },
      { filename: BLOCK, code: code("<Cluster><SurfaceCard kind=\"figures\" /><SurfaceCard kind=\"details\" /></Cluster>"), errors: [{ messageId: "unequal" }] },
      { filename: BLOCK, code: code("<Grid><SurfaceCard /><SurfaceCard kind=\"figures\" /></Grid>"), errors: [{ messageId: "unequal" }] },
    ],
  })
})
