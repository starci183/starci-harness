/**
 * Twin tests for the text and emphasis laws (R357 text-inline-only, R358 no-text-heading, R359 one-highlight-per-render).
 *
 *   node --test src/text-rules.spec.ts
 */
// proves: FE_TEXT_BLOCK
// proves: FE_TEXT_HEADING
// proves: FE_ONE_HIGHLIGHT
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules } from "./text-rules.ts"

const FILE = at("apps/web/src/components/blocks/Profile/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = 'import { Text, Stack, Section, SurfaceCard, Badge, MessageBubble } from "@starci/grammar/core"\n'
const rule = (name: string) => {
  const found = rules[name]
  if (found === undefined) throw new Error(`no rule ${name}`)
  return found
}

test("the law publishes three rules, each an error", () => {
  assert.deepEqual(Object.keys(rules), ["text-inline-only", "no-text-heading", "one-highlight-per-render"])
  assert.deepEqual(Object.values(recommended), ["error", "error", "error"])
})

test("R357 text-inline-only: a block inside Text is refused", () => {
  assert.doesNotThrow(() => slotTester().run("text-inline-only", rule("text-inline-only"), {
    valid: [
      { filename: FILE, code: IMPORT + "export const A = () => <Text>Hello <Badge>new</Badge> world</Text>" },
      { filename: FILE, code: IMPORT + "export const A = () => <Text>Hello <b>bold</b></Text>" },
      { filename: FILE, code: 'import { Text } from "./Text"\nexport const A = () => <Text><div /></Text>' },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <Text><Stack /></Text>" },
    ],
    invalid: [
      { filename: FILE, code: IMPORT + "export const A = () => <Text><Stack /></Text>", errors: [{ messageId: "block" }] },
      { filename: FILE, code: IMPORT + "export const A = () => <Text>Name <div>x</div><SurfaceCard label=\"a\" /></Text>", errors: [{ messageId: "block" }, { messageId: "block" }] },
    ],
  }))
})

test("R358 no-text-heading: a strong Text that only titles blocks is refused", () => {
  assert.doesNotThrow(() => slotTester().run("no-text-heading", rule("no-text-heading"), {
    valid: [
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><Text>Plain</Text><Stack /></Stack>" },
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><Text isStrong>Name</Text><Text>detail</Text></Stack>" },
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><Text isStrong>Only</Text></Stack>" },
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><Text isStrong>Name</Text><Stack /><Text>after</Text></Stack>" },
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><Text isStrong={flag}>Name</Text><Stack /></Stack>" },
    ],
    invalid: [
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><Text isStrong>Members</Text><Stack /><SurfaceCard label=\"a\" /></Stack>", errors: [{ messageId: "heading" }] },
      { filename: FILE, code: IMPORT + "export const A = () => <><Text isStrong>Members</Text><Section title=\"x\" /></>", errors: [{ messageId: "heading" }] },
    ],
  }))
})

test("R359 one-highlight-per-render: a second isHighlight in one render is refused", () => {
  assert.doesNotThrow(() => slotTester().run("one-highlight-per-render", rule("one-highlight-per-render"), {
    valid: [
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><MessageBubble body=\"a\" isHighlight /><SurfaceCard label=\"b\" /></Stack>" },
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><MessageBubble body=\"a\" isHighlight={false} /><MessageBubble body=\"b\" isHighlight /></Stack>" },
      { filename: FILE, code: IMPORT + "export const A = ({ rows }) => <Stack>{rows.map((row) => <MessageBubble key={row.id} isHighlight={row.mine} />)}<MessageBubble body=\"x\" isHighlight /></Stack>" },
      { filename: FILE, code: IMPORT + "const A = () => <MessageBubble body=\"a\" isHighlight />\nconst B = () => <MessageBubble body=\"b\" isHighlight />" },
      { filename: FILE, code: 'import { SurfaceCard } from "./card"\nexport const A = () => <><SurfaceCard isHighlight /><SurfaceCard isHighlight /></>' },
    ],
    invalid: [
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><MessageBubble body=\"a\" isHighlight /><MessageBubble body=\"b\" isHighlight /></Stack>", errors: [{ messageId: "second" }] },
      { filename: FILE, code: IMPORT + "export const A = () => <Stack><MessageBubble body=\"a\" isHighlight /><MessageBubble isHighlight /><MessageBubble body=\"c\" isHighlight /></Stack>", errors: [{ messageId: "second" }, { messageId: "second" }] },
    ],
  }))
})
