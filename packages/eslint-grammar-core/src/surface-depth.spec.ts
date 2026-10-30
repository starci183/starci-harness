/**
 * Twin tests for the surface depth law (R340): a depth-accepting Grammar surface nested in another surface does not force
 * `depth="top"`.
 *
 *   node --test src/surface-depth.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noRaisedSurfaceInSurface, recommended, rules } from "./surface-depth.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { SurfaceAccordionCard, SurfaceCard, SurfaceListCard } from \"@starci/grammar/core\"\n"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-raised-surface-in-surface"])
  assert.deepEqual(recommended, { "starci-grammar/no-raised-surface-in-surface": "error" })
})

test("R340: a surface nested in a surface does not force depth=\"top\"", () => {
  slotTester().run("no-raised-surface-in-surface", noRaisedSurfaceInSurface, {
    valid: [
      // a top-level list may say top
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceListCard label=\"Runs\" depth=\"top\" items={[]} />" },
      // a nested list lets the Grammar resolve its depth, or says nested
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SurfaceListCard label=\"Steps\" items={[]} /></SurfaceCard>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SurfaceListCard depth=\"nested\" items={[]} /></SurfaceCard>" },
      // a depth computed at run time is not judged
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <SurfaceCard label=\"Run\"><SurfaceListCard depth={p.depth} items={[]} /></SurfaceCard>" },
      // a sibling of a surface is not inside it
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><SurfaceCard label=\"Run\" /><SurfaceListCard depth=\"top\" items={[]} /></div>" },
      // another element's depth is not a surface depth
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><Tree depth=\"top\" /></SurfaceCard>" },
      // a script is not product source
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SurfaceListCard depth=\"top\" items={[]} /></SurfaceCard>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SurfaceListCard label=\"Steps\" depth=\"top\" items={[]} /></SurfaceCard>", errors: [{ messageId: "raised", data: { element: "SurfaceListCard" } }] },
      // an expression container, a template literal and a namespaced element
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><G.SurfaceListCard depth={\"top\"} items={[]} /></SurfaceCard>", errors: [{ messageId: "raised" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"Run\"><SurfaceListCard depth={`top`} items={[]} /></SurfaceCard>", errors: [{ messageId: "raised" }] },
      // deeper inside, in a list card or an accordion card
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceListCard items={[]}><div><SurfaceListCard depth=\"top\" items={[]} /></div></SurfaceListCard>", errors: [{ messageId: "raised" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceAccordionCard label=\"Run\"><SurfaceListCard depth=\"top\" items={[]} /></SurfaceAccordionCard>", errors: [{ messageId: "raised" }] },
    ],
  })
})
