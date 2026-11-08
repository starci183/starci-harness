/**
 * Twin tests for the proximity law (GAP-PROXIMITY): a Grammar layout element stands at least one gap step closer than its parent.
 *
 *   node --test src/gap-proximity.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { gapProximity, recommended, rules } from "./gap-proximity.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import * as G from \"@starci/grammar/core\"\nimport { Stack, Cluster, Section, PaneSection, Grid, Form, Fieldset, SurfaceCard, Drawer, Dialog, Input, Select, Field, Text } from \"@starci/grammar/core\"\n"
const wide = { messageId: "wide" }
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["gap-proximity"])
  assert.deepEqual(recommended, { "starci-grammar/gap-proximity": "error" })
})

test("GAP-PROXIMITY: a child stands at least one step closer than its parent", () => {
  slotTester().run("gap-proximity", gapProximity, {
    valid: [
      // each step down
      { filename: BLOCK, code: code("<Stack gap=\"region\"><Stack gap=\"section\"><Stack gap=\"row\"><Cluster gap=\"inline\"><Cluster gap=\"identity\" /></Cluster></Stack></Stack></Stack>") },
      // a Section (row) inside a section stack
      { filename: BLOCK, code: code("<Stack gap=\"section\"><Section kind=\"list\" /></Stack>") },
      // a Section's own gap is row: an inline cluster inside it is fine
      { filename: BLOCK, code: code("<Section><Cluster gap=\"inline\" /></Section>") },
      // a PaneSection defaults to inline; an identity cluster is closer
      { filename: BLOCK, code: code("<PaneSection><Cluster gap=\"identity\" /></PaneSection>") },
      { filename: BLOCK, code: code("<PaneSection gap=\"section\"><Stack gap=\"row\" /></PaneSection>") },
      // grids by kind
      { filename: BLOCK, code: code("<Stack gap=\"region\"><Grid kind=\"sections\" /></Stack>") },
      { filename: BLOCK, code: code("<Grid kind=\"cards\"><Cluster gap=\"identity\" /></Grid>") },
      // a non-literal gap has no role
      { filename: BLOCK, code: code("<Stack gap=\"section\"><Stack gap={gap} /></Stack>") },
      { filename: BLOCK, code: code("<Stack gap={gap}><Stack gap=\"region\" /></Stack>") },
      // a plain element in between stops the comparison
      { filename: BLOCK, code: code("<Stack gap=\"row\"><div><Stack gap=\"region\" /></div></Stack>") },
      // a SurfaceCard, Drawer or Dialog is a reset
      { filename: BLOCK, code: code("<Stack gap=\"row\"><SurfaceCard label=\"Run\"><Stack gap=\"section\" /></SurfaceCard></Stack>") },
      { filename: BLOCK, code: code("<Drawer title=\"Edit\"><Stack gap=\"section\"><Input label=\"Name\" /></Stack></Drawer>") },
      { filename: BLOCK, code: code("<Dialog title=\"Edit\"><Stack gap=\"section\" /></Dialog>") },
      // a field stack is correct in a Form, a Fieldset and a Drawer
      { filename: BLOCK, code: code("<Form><Stack gap=\"section\"><Input label=\"Name\" /><Select label=\"Role\" /></Stack></Form>") },
      { filename: BLOCK, code: code("<Fieldset><Stack gap=\"section\"><Field label=\"A\" /><G.Input label=\"B\" /></Stack></Fieldset>") },
      { filename: BLOCK, code: code("<Form>{ok && <Stack gap=\"section\"><Input label=\"Name\" /></Stack>}</Form>") },
      // main-rail is compared with nothing, in either direction
      { filename: BLOCK, code: code("<Grid kind=\"main-rail\" rail={<Stack gap=\"region\" />}><Stack gap=\"region\" /></Grid>") },
      { filename: BLOCK, code: code("<Stack gap=\"region\"><Grid kind=\"main-rail\" /></Stack>") },
      // an element not from the Grammar is not judged
      { filename: BLOCK, code: "import { Stack } from \"./mine\"\nexport const A = () => <Stack gap=\"row\"><Stack gap=\"region\" /></Stack>" },
      // a script is not product source
      { filename: SCRIPT, code: code("<Stack gap=\"row\"><Stack gap=\"region\" /></Stack>") },
    ],
    invalid: [
      // equal and wider, direct
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Stack gap=\"row\" /></Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"inline\"><Cluster gap=\"section\" /></Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"section\"><G.Stack gap=\"section\"><Text>A</Text></G.Stack></Stack>"), errors: [wide] },
      // through a fragment, a condition, && and map
      { filename: BLOCK, code: code("<Stack gap=\"row\"><><Stack gap=\"row\" /></></Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"row\">{ok ? <Stack gap=\"section\" /> : null}</Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"row\">{ok && <Stack gap=\"row\" />}</Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"row\">{items.map((item) => <Stack key={item} gap=\"row\" />)}</Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"row\">{items.map((item) => { return <Stack key={item} gap=\"section\" /> })}</Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Fragment><Stack gap=\"row\" /></Fragment></Stack>"), errors: [wide] },
      // Section is always row
      { filename: BLOCK, code: code("<Section><Section /></Section>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Section kind=\"list\" /></Stack>"), errors: [wide] },
      // PaneSection default inline
      { filename: BLOCK, code: code("<PaneSection><Cluster gap=\"inline\" /></PaneSection>"), errors: [wide] },
      // Grid by kind, Form, Fieldset
      { filename: BLOCK, code: code("<Stack gap=\"section\"><Grid kind=\"pair\" /></Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Form /></Stack>"), errors: [wide] },
      { filename: BLOCK, code: code("<Form><Fieldset /></Form>"), errors: [wide] },
      // a section stack of non-field children in a section stack
      { filename: BLOCK, code: code("<Stack gap=\"section\"><Stack gap=\"section\"><Text>A</Text></Stack></Stack>"), errors: [wide] },
      // a field stack in a plain section stack is not the exemption
      { filename: BLOCK, code: code("<Stack gap=\"section\"><Stack gap=\"section\"><Input label=\"Name\" /></Stack></Stack>"), errors: [wide] },
      // a stack of section gap mixing fields and other children in a Form
      { filename: BLOCK, code: code("<Form><Stack gap=\"section\"><Input label=\"Name\" /><Text>Hi</Text></Stack></Form>"), errors: [wide] },
      // the region ceiling
      { filename: BLOCK, code: code("<Stack gap=\"region\"><Stack gap=\"region\" /></Stack>"), errors: [wide] },
      // identity cannot hold an identity child
      { filename: BLOCK, code: code("<Cluster gap=\"identity\"><Cluster gap=\"identity\" /></Cluster>"), errors: [wide] },
    ],
  })
})

test("the message gives the step to take", () => {
  slotTester().run("gap-proximity", gapProximity, {
    valid: [],
    invalid: [
      { filename: BLOCK, code: code("<Stack gap=\"section\"><Stack gap=\"section\" /></Stack>"), errors: [{ messageId: "wide", data: { child: "Stack", childRole: "section", childPixels: 24, parentPixels: 24, parent: "Stack", parentRole: "section", advice: "Give it gap=\"row\" (one step below the parent), or step the parent up." } }] },
      { filename: BLOCK, code: code("<Section><Section /></Section>"), errors: [{ messageId: "wide", data: { child: "Section", childRole: "row", childPixels: 12, parent: "Section", parentRole: "row", parentPixels: 12, advice: "`Section` fixes its own gap role (row), so step the parent up (a section gap) or do not nest Section there." } }] },
      { filename: BLOCK, code: code("<Cluster gap=\"identity\"><Cluster gap=\"identity\" /></Cluster>"), errors: [{ messageId: "wide", data: { child: "Cluster", childRole: "identity", childPixels: 4, parent: "Cluster", parentRole: "identity", parentPixels: 4, advice: "`Cluster` is the narrowest role: split the parent instead of nesting inside it." } }] },
    ],
  })
})
