/**
 * Twin tests for the type nesting law (TYPE-NESTING): the reading and lead roles stand at page level only, and a nested block heads
 * one level deeper than the block around it.
 *
 *   node --test src/type-nesting.spec.ts
 */
// proves: FE_TYPE_NESTING
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended } from "./index.ts"
import { READING_ROLES, rules, typeNesting } from "./type-nesting.ts"

const FILE = at("apps/web/src/components/composites/Lesson/index.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = 'import { Accordion, Disclosure, Section, Stack, SurfaceCard, Text } from "@starci/grammar/common"\n'
const code = (body: string): string => `${IMPORT}export const A = () => ${body}`

test("the law publishes one rule, blocking, for the three reading roles", () => {
  assert.deepEqual(Object.keys(rules), ["type-nesting"])
  assert.equal(recommended["starci-grammar/type-nesting"], "error")
  assert.deepEqual([...READING_ROLES], ["reading.body", "reading.title", "lead"])
})

test("TYPE-NESTING: a reading role inside a headed block, and a block no deeper than its parent, are refused", () => {
  slotTester().run("type-nesting", typeNesting, {
    valid: [
      { filename: FILE, code: code('<Stack><Text as="p" role="reading.body">narration</Text></Stack>') },
      { filename: FILE, code: code('<Section title="a" headingLevel={2}><Text as="p">body</Text></Section>') },
      { filename: FILE, code: code('<Section title="a" headingLevel={2}><SurfaceCard label="b" headingLevel={3} /></Section>') },
      { filename: FILE, code: code('<Section title="a" headingLevel={2}><Accordion headingLevel={3} items={[]} /></Section>') },
      { filename: FILE, code: code('<Section title="a" headingLevel={level}><Section title="b" headingLevel={2} /></Section>') },
      { filename: FILE, code: code('<Section title="a" headingLevel={2}><Text role={role}>x</Text></Section>') },
      { filename: FILE, code: 'import { Section, Text } from "./local"\nexport const A = () => <Section headingLevel={2}><Text role="reading.body">x</Text></Section>' },
      { filename: SCRIPT, code: code('<Section title="a" headingLevel={2}><Text role="reading.body">x</Text></Section>') },
    ],
    invalid: [
      { filename: FILE, code: code('<Section title="a" headingLevel={2}><Stack><Text as="p" role="reading.body">x</Text></Stack></Section>'), errors: [{ messageId: "lead" }] },
      { filename: FILE, code: code('<SurfaceCard label="a"><Text role="reading.title">x</Text></SurfaceCard>'), errors: [{ messageId: "lead" }] },
      { filename: FILE, code: code('<Accordion items={[{ id: "a", title: "a", content: <Text role="lead">x</Text> }]} />'), errors: [{ messageId: "lead" }] },
      { filename: FILE, code: code('<Section title="a" headingLevel={2}><SurfaceCard label="b" headingLevel={2} /></Section>'), errors: [{ messageId: "level" }] },
      { filename: FILE, code: code('<Section title="a" headingLevel={3}><Stack><Disclosure title="b" headingLevel={2} /></Stack></Section>'), errors: [{ messageId: "level" }] },
    ],
  })
  assert.ok(true)
})
