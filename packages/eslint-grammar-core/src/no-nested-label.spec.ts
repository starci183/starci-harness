/**
 * Twin tests for the label law (LABEL-SUBLABEL-HIERARCHY): a section has one Label; nested groups use a Sublabel.
 *
 *   node --test src/no-nested-label.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noNestedLabel, recommended, rules } from "./no-nested-label.ts"

const BLOCK = at("apps/web/src/components/blocks/Agent/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Section, SurfaceCard, Stack } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-nested-label"])
  assert.deepEqual(recommended, { "starci-grammar/no-nested-label": "error" })
})

test("LABEL-SUBLABEL-HIERARCHY: groups inside a labelled section take a sublabel", () => {
  slotTester().run("no-nested-label", noNestedLabel, {
    valid: [
      { filename: BLOCK, code: code("<Section title=\"Agent hiểu gì\"><SurfaceCard sublabel=\"Được tự làm\" kind=\"select\" /><SurfaceCard sublabel=\"Phải hỏi bạn\" kind=\"select\" /></Section>") },
      { filename: BLOCK, code: code("<Stack><SurfaceCard label=\"A\" /><SurfaceCard label=\"B\" /></Stack>") },
      { filename: BLOCK, code: code("<Section title=\"A\" action={<SurfaceCard label=\"B\" />} />") },
      { filename: SCRIPT, code: code("<Section title=\"A\"><SurfaceCard label=\"B\" /></Section>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Section title=\"A\"><SurfaceCard label=\"B\" /></Section>"), errors: [{ messageId: "nested" }] },
      { filename: BLOCK, code: code("<SurfaceCard label=\"A\"><Section title=\"B\" /></SurfaceCard>"), errors: [{ messageId: "nested" }] },
    ],
  })
})
