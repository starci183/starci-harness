/**
 * Twin tests for the section head law (SECTION-HEAD-ACTION): one Link variant="head", one IconButton or one neutral sm Button, never a commit Button, never two.
 *
 *   node --test src/section-head-action.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, sectionHeadAction } from "./section-head-action.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Button, IconButton, Link, Section } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["section-head-action"])
  assert.deepEqual(recommended, { "starci-grammar/section-head-action": "error" })
})

test("SECTION-HEAD-ACTION: one Link, one IconButton or one neutral sm Button; no other Button, no second command", () => {
  slotTester().run("section-head-action", sectionHeadAction, {
    valid: [
      { filename: BLOCK, code: code("<Section title=\"Runs\" count={3} action={<Link variant=\"head\" href=\"/runs\">All runs</Link>}>x</Section>") },
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<IconButton label=\"About\" glyph=\"more\" />}>x</Section>") },
      { filename: BLOCK, code: code("<Section title=\"Runs\">x</Section>") },
      { filename: BLOCK, code: code("<Section title=\"Provider\" count={2} action={<Button intent=\"neutral\" size=\"sm\" onPress={add}>Add provider</Button>}>x</Section>") },
      { filename: SCRIPT, code: code("<Section title=\"Runs\" action={<Button>Add</Button>}>x</Section>") },
      { filename: BLOCK, code: "export const A = () => <Section title=\"Runs\" action={<Button>Add</Button>}>x</Section>" },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<Button size=\"sm\" onPress={go}>Open</Button>}>x</Section>"), errors: [{ messageId: "button" }] },
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<Button intent=\"commit\" size=\"sm\" onPress={go}>Add</Button>}>x</Section>"), errors: [{ messageId: "button" }] },
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<Button intent=\"neutral\" size=\"md\" onPress={go}>Add</Button>}>x</Section>"), errors: [{ messageId: "button" }] },
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<Button intent=\"neutral\" size=\"sm\" startGlyph=\"plus\" onPress={go}>Add</Button>}>x</Section>"), errors: [{ messageId: "icon" }] },
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<><Link variant=\"head\" href=\"/a\">A</Link><Link variant=\"head\" href=\"/b\">B</Link></>}>x</Section>"), errors: [{ messageId: "many" }] },
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<><Link href=\"/a\">A</Link><IconButton label=\"About\" glyph=\"more\" /></>}>x</Section>"), errors: [{ messageId: "many" }] },
      { filename: BLOCK, code: code("<Section title=\"Runs\" action={<><Button>A</Button><Button>B</Button></>}>x</Section>"), errors: [{ messageId: "many" }, { messageId: "button" }, { messageId: "button" }] },
    ],
  })
})
