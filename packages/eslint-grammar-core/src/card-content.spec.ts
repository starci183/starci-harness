/**
 * Twin tests for the card content law (CARD-ONE-CONTENT): one content per card, no description under a label.
 *
 *   node --test src/card-content.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { cardOneContent, noLabelDescription, recommended, rules } from "./card-content.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { DataTable, DescriptionList, ListBox, Section, Stack, SurfaceCard } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes two rules and both are errors", () => {
  assert.deepEqual(Object.keys(rules), ["card-one-content", "no-label-description"])
  assert.deepEqual(recommended, { "starci-grammar/card-one-content": "error", "starci-grammar/no-label-description": "error" })
})

test("CARD-ONE-CONTENT: a card holds one content", () => {
  slotTester().run("card-one-content", cardOneContent, {
    valid: [
      { filename: BLOCK, code: code("<SurfaceCard label=\"Orders\"><DataTable label=\"Orders\" columns={c} rows={r} renderCell={f} emptyContent=\"-\" /></SurfaceCard>") },
      { filename: BLOCK, code: code("<SurfaceCard kind=\"list\" label=\"Orders\" items={i} empty=\"-\" headers={[{ kind: \"search\" }]} />") },
      { filename: BLOCK, code: code("<SurfaceCard kind=\"figures\" label=\"Totals\" items={i} />") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Profile\"><Stack gap=\"row\"><DescriptionList items={i} /></Stack></SurfaceCard>") },
      { filename: SCRIPT, code: code("<SurfaceCard label=\"x\"><ListBox label=\"a\" /><DescriptionList items={i} /></SurfaceCard>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<SurfaceCard label=\"Order\"><ListBox label=\"Lines\" /><DescriptionList items={i} /></SurfaceCard>"), errors: [{ messageId: "many" }] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Order\"><Stack gap=\"row\"><DataTable label=\"a\" /><Section kind=\"list\" title=\"b\" items={i} empty=\"-\" /></Stack></SurfaceCard>"), errors: [{ messageId: "many" }] },
      { filename: BLOCK, code: code("<SurfaceCard kind=\"list\" label=\"Orders\" items={i} empty=\"-\" headers={[{ kind: \"figures\", items: f }]} />"), errors: [{ messageId: "ribbon" }] },
    ],
  })
})

test("CARD-ONE-CONTENT: a label has no description under it", () => {
  slotTester().run("no-label-description", noLabelDescription, {
    valid: [
      { filename: BLOCK, code: code("<Section title=\"Runs\" caption=\"Updated at 10:00\">x</Section>") },
      { filename: BLOCK, code: code("<SurfaceCard kind=\"tile\" name=\"Quote\" description=\"Writes a quote.\" />") },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Orders\" note=\"Updated at 10:00\">x</SurfaceCard>") },
      { filename: SCRIPT, code: code("<Section title=\"Runs\" description=\"x\">x</Section>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Section title=\"Runs\" description=\"Everyone\">x</Section>"), errors: [{ messageId: "section" }] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"Orders\" description=\"Open orders\">x</SurfaceCard>"), errors: [{ messageId: "card" }] },
    ],
  })
})
