/**
 * Twin tests for the lone surface law (SINGLE-CHILD-CARD): a table, list or chart standing alone is the surface, not a card's content.
 *
 *   node --test src/single-child-card.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, singleChildCard } from "./single-child-card.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import * as G from \"@starci/grammar/core\"\nimport { SurfaceCard, DataTable, ListBox, DisclosureList, Timeline, BarChart, ProportionBar, BubbleMap, FlowGraph, MermaidDiagram, Section, Stack, Text, Button, DescriptionList, Meter } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`
const lone = { messageId: "lone" }

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["single-child-card"])
  assert.deepEqual(recommended, { "starci-grammar/single-child-card": "error" })
})

test("SINGLE-CHILD-CARD: a card around one table, list or chart is refused", () => {
  slotTester().run("single-child-card", singleChildCard, {
    valid: [
      // the table is the surface; the Section head carries the title
      { filename: BLOCK, code: code("<Section title=\"Runs\" caption=\"Last 30 days\"><DataTable columns={c} rows={r} /></Section>") },
      // two different parts
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Text>3 failed</Text><DataTable columns={c} rows={r} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><BarChart data={d} /><ListBox items={i} /></SurfaceCard>") },
      // zones and head actions
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" headers={[{ kind: \"search\" }]}><DataTable columns={c} rows={r} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" footers={[{ kind: \"paging\" }]}><ListBox items={i} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" labelEnd={<Button>Add</Button>}><BarChart data={d} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" kind=\"table\" labelEnd={<Button>Add</Button>} columns={c} rows={r} />") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" kind=\"list\" headers={[{ kind: \"filter\" }]} items={i} />") },
      // other kinds, a body of copy, a record's facts, a single value
      { filename: BLOCK, code: code("<SurfaceCard label=\"Plan\" kind=\"figures\" items={f} />") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Plan\"><Text>Hello</Text></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Order\"><DescriptionList items={i} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Quota\"><Meter value={3} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Section title=\"Runs\"><Text>x</Text></Section></SurfaceCard>") },
      // a spread may bring zones
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" {...zones}><DataTable columns={c} rows={r} /></SurfaceCard>") },
      // not the Grammar's SurfaceCard or table
      { filename: BLOCK, code: "import { SurfaceCard } from \"./mine\"\nimport { DataTable } from \"@starci/grammar/core\"\nexport const A = () => <SurfaceCard><DataTable columns={c} rows={r} /></SurfaceCard>" },
      { filename: BLOCK, code: "import { SurfaceCard } from \"@starci/grammar/core\"\nimport { DataTable } from \"./mine\"\nexport const A = () => <SurfaceCard label=\"R\"><DataTable /></SurfaceCard>" },
      // a script is not product source
      { filename: SCRIPT, code: code("<SurfaceCard label=\"Runs\"><DataTable columns={c} rows={r} /></SurfaceCard>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><DataTable columns={c} rows={r} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><ListBox items={i} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Steps\"><DisclosureList label=\"Steps\" items={i} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Log\"><Timeline items={i} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><Section kind=\"list\" items={rows} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Usage\"><BarChart data={d} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Share\"><ProportionBar items={d} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Map\"><BubbleMap data={d} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Flow\"><FlowGraph nodes={n} /></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Diagram\"><MermaidDiagram source={s} /></SurfaceCard>"), errors: [lone] },
      // namespace import, blank text, a fragment, a condition, empty zones
      { filename: BLOCK, code: code("<G.SurfaceCard label=\"Runs\">\n  <G.DataTable columns={c} rows={r} />\n</G.SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\"><><DataTable columns={c} rows={r} /></></SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\">{ready && <DataTable columns={c} rows={r} />}</SurfaceCard>"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" headers={[]} footers={[]}><DataTable columns={c} rows={r} /></SurfaceCard>"), errors: [lone] },
      // the data-driven form of the same lone table and list
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" kind=\"table\" columns={c} rows={r} />"), errors: [lone] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Runs\" kind=\"list\" items={i} empty={null} />"), errors: [lone] },
    ],
  })
})

test("SINGLE-CHILD-CARD: the message tells the fix", () => {
  assert.match(singleChildCard.meta?.messages?.lone ?? "", /standing alone is the surface: drop the SurfaceCard, put its title in a `Section` head \(`title`\) and one line under it in `Section caption`/)
})
