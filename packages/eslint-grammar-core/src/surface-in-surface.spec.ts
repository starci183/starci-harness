/**
 * Twin tests for the row list law (SURFACE-IN-SURFACE): rows divided by lines inside a surface are `Section kind="list"`.
 *
 *   node --test src/surface-in-surface.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, surfaceInSurface } from "./surface-in-surface.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import * as G from \"@starci/grammar/core\"\nimport { Stack, Cluster, Divider, Section, SurfaceCard, Drawer, Dialog, PaneSection, Pane, Grid, Text } from \"@starci/grammar/core\"\n"
const handMade = { messageId: "handMade" }
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`
const ROWS = "<Cluster gap=\"inline\"><Text>A</Text></Cluster><Divider /><Cluster gap=\"inline\"><Text>B</Text></Cluster>"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["surface-in-surface"])
  assert.deepEqual(recommended, { "starci-grammar/surface-in-surface": "error" })
})

test("SURFACE-IN-SURFACE: a hand-made divided row list inside a surface is refused", () => {
  slotTester().run("surface-in-surface", surfaceInSurface, {
    valid: [
      // the Grammar list
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Section kind=\"list\" items={rows} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" kind=\"list\" items={rows} empty={null} />") },
      // a divided list outside any surface
      { filename: BLOCK, code: code(`<Stack gap="row">${ROWS}</Stack>`) },
      // a stack with no Divider
      { filename: BLOCK, code: code("<SurfaceCard label=\"Run\"><Stack gap=\"row\"><Cluster gap=\"inline\" /><Cluster gap=\"inline\" /></Stack></SurfaceCard>") },
      // a Divider alone separates nothing
      { filename: BLOCK, code: code("<Drawer title=\"Edit\"><Stack gap=\"row\"><Divider /></Stack></Drawer>") },
      // a Divider directly in a SurfaceCard is surface-card-kind's, not this rule's
      { filename: BLOCK, code: code("<SurfaceCard label=\"Run\"><Text>A</Text><Divider /><Text>B</Text></SurfaceCard>") },
      // a rail prop of another grid kind is not a surface
      { filename: BLOCK, code: code(`<Grid kind="pair" rail={<Stack gap="row">${ROWS}</Stack>} />`) },
      // not the Grammar's Stack/Divider
      { filename: BLOCK, code: "import { Divider } from \"./mine\"\nimport { SurfaceCard } from \"@starci/grammar/core\"\nexport const A = () => <SurfaceCard label=\"R\"><div><p>A</p><Divider /><p>B</p></div></SurfaceCard>" },
      // a script is not product source
      { filename: SCRIPT, code: code(`<Drawer title="Edit"><Stack gap="row">${ROWS}</Stack></Drawer>`) },
    ],
    invalid: [
      { filename: BLOCK, code: code(`<SurfaceCard label="Runs"><Stack gap="row">${ROWS}</Stack></SurfaceCard>`), errors: [handMade] },
      { filename: BLOCK, code: code(`<Drawer title="Edit"><Stack gap="row">${ROWS}</Stack></Drawer>`), errors: [handMade] },
      { filename: BLOCK, code: code(`<Dialog title="Pick"><G.Stack gap="row">${ROWS}</G.Stack></Dialog>`), errors: [handMade] },
      { filename: BLOCK, code: code(`<PaneSection><div>${ROWS}</div></PaneSection>`), errors: [handMade] },
      { filename: BLOCK, code: code(`<SurfaceCard label="Runs"><ul>${ROWS}</ul></SurfaceCard>`), errors: [handMade] },
      // a rail of a main-rail grid
      { filename: BLOCK, code: code(`<Grid kind="main-rail" rail={<Stack gap="row">${ROWS}</Stack>}><Text>Main</Text></Grid>`), errors: [handMade] },
      // rows mapped, each followed by a Divider
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Stack gap=\"row\">{runs.map((run) => <Fragment key={run}><Cluster gap=\"inline\"><Text>{run}</Text></Cluster><Divider /></Fragment>)}</Stack></SurfaceCard>"), errors: [handMade] },
      // deeper inside the surface
      { filename: BLOCK, code: code(`<SurfaceCard label="Runs"><Stack gap="section"><Text>Intro</Text><div>${ROWS}</div></Stack></SurfaceCard>`), errors: [handMade] },
    ],
  })
})
