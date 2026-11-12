/**
 * Twin tests for the card description law (CARD-NO-DESCRIPTION): no free-standing muted line directly above a SurfaceCard.
 *
 *   node --test src/no-card-lead-description.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noCardLeadDescription, recommended, rules } from "./no-card-lead-description.ts"

const BLOCK = at("apps/web/src/components/blocks/Settings/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Heading, Stack, SurfaceCard, Text } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-card-lead-description"])
  assert.deepEqual(recommended, { "starci-grammar/no-card-lead-description": "error" })
})

test("CARD-NO-DESCRIPTION: a muted Text directly above a SurfaceCard is refused", () => {
  slotTester().run("no-card-lead-description", noCardLeadDescription, {
    valid: [
      { filename: BLOCK, code: code("<Stack><Heading level={3}>General</Heading><SurfaceCard kind=\"select\" label=\"Mode\" /></Stack>") },
      { filename: BLOCK, code: code("<Stack><SurfaceCard label=\"A\" /><Text tone=\"muted\">Caption</Text></Stack>") },
      { filename: BLOCK, code: code("<Stack><Text>One line</Text><SurfaceCard label=\"A\" /></Stack>") },
      { filename: BLOCK, code: code("<Stack><Text tone=\"muted\">One line</Text><Heading level={3}>General</Heading><SurfaceCard label=\"A\" /></Stack>") },
      { filename: SCRIPT, code: code("<Stack><Text tone=\"muted\">x</Text><SurfaceCard label=\"A\" /></Stack>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Stack><Heading level={3}>General</Heading><Text tone=\"muted\">Description</Text><SurfaceCard label=\"A\" /></Stack>"), errors: [{ messageId: "lead" }] },
      { filename: BLOCK, code: code("<><Text tone=\"muted\">Description</Text><SurfaceCard kind=\"select\" /></>"), errors: [{ messageId: "lead" }] },
    ],
  })
})
