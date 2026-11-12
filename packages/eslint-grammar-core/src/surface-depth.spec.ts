/**
 * Twin tests for the surface nesting law (R340): a `SurfaceCard` never stands inside another surface.
 *
 *   node --test src/surface-depth.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noRaisedSurfaceInSurface, recommended, rules } from "./surface-depth.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { SurfaceCard, Dialog, Drawer, AlertDialog, Popover, Pane } from \"@starci/grammar/core\"\n"
const nested = { messageId: "nested" }

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-raised-surface-in-surface"])
  assert.deepEqual(recommended, { "starci-grammar/no-raised-surface-in-surface": "error" })
})

test("R340: a card never stands inside another card; a white surface hosts cards", () => {
  slotTester().run("no-raised-surface-in-surface", noRaisedSurfaceInSurface, {
    valid: [
      // a card at the top
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Runs\" kind=\"list\" items={[]} empty={null} />" },
      // two cards side by side are not nested
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><SurfaceCard label=\"Run\" /><SurfaceCard label=\"Steps\" /></div>" },
      // a white Pane surface, a dialog, a drawer, an alert dialog and a popover host cards (0.37.5)
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"main\" surface><SurfaceCard label=\"Run\" /></Pane>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Dialog title=\"x\"><SurfaceCard label=\"Run\" /></Dialog>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Drawer title=\"x\"><SurfaceCard label=\"Run\" /></Drawer>" },
      // a Pane without a surface is a canvas
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"main\"><SurfaceCard label=\"Run\" /></Pane>" },
      // a card in an overlay's trigger is not its content
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Dialog title=\"x\" trigger={<SurfaceCard label=\"Run\" />}>body</Dialog>" },
      // another source's card is not the Grammar's
      { filename: BLOCK, code: "import { SurfaceCard } from \"other-kit\"\nimport { Dialog } from \"@starci/grammar/core\"\nexport const A = () => <Dialog title=\"x\"><SurfaceCard /></Dialog>" },
      // a script is not product source
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SurfaceCard label=\"Steps\" /></SurfaceCard>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SurfaceCard label=\"Steps\" /></SurfaceCard>", errors: [nested] },
      // deeper inside
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><div><SurfaceCard label=\"Steps\" /></div></SurfaceCard>", errors: [nested] },
    ],
  })
})
