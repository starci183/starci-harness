/**
 * Twin tests for the rows law (ROWS-IN-CARD): a DescriptionList or DisclosureList stands in a card.
 *
 *   node --test src/rows-in-card.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rowsInCard, rules } from "./rows-in-card.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { DescriptionList, DisclosureList, ListBox, Section, SurfaceCard, Stack } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["rows-in-card"])
  assert.deepEqual(recommended, { "starci-grammar/rows-in-card": "error" })
})

test("ROWS-IN-CARD: key-value and disclosure rows stand in a Section or a SurfaceCard", () => {
  slotTester().run("rows-in-card", rowsInCard, {
    valid: [
      { filename: BLOCK, code: code("<SurfaceCard label=\"Details\"><DescriptionList items={[]} /></SurfaceCard>") },
      { filename: BLOCK, code: code("<Section title=\"Steps\"><DisclosureList items={[]} /></Section>") },
      { filename: BLOCK, code: code("<Card body={<DescriptionList items={[]} />} />") },
      { filename: BLOCK, code: code("<ListBox label=\"Rooms\" items={[]} />") },
      { filename: SCRIPT, code: code("<DescriptionList items={[]} />") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Stack><DescriptionList items={[]} /></Stack>"), errors: [{ messageId: "bare" }] },
      { filename: BLOCK, code: code("<DisclosureList items={[]} />"), errors: [{ messageId: "bare" }] },
    ],
  })
})
