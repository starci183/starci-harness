/**
 * Twin tests for the field label law (FIELD-LABEL): a control is labelled by its own `label` prop.
 *
 *   node --test src/field-label.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { fieldLabel, recommended, rules } from "./field-label.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import * as G from \"@starci/grammar/core\"\nimport { Stack, Text, Label, Input, Select, Switch, Button } from \"@starci/grammar/core\"\n"
const handMade = { messageId: "handMade" }
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["field-label"])
  assert.deepEqual(recommended, { "starci-grammar/field-label": "error" })
})

test("FIELD-LABEL: a Text placed before a control is a hand-made label", () => {
  slotTester().run("field-label", fieldLabel, {
    valid: [
      // the control's own label
      { filename: BLOCK, code: code("<Stack gap=\"section\"><Input label=\"Name\" /><Select label=\"Role\" /></Stack>") },
      // a Text that is not immediately before a control
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Text>Hello</Text><Button>Go</Button><Input label=\"Name\" /></Stack>") },
      // a Text after the control is help or a note
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Input label=\"Name\" /><Text>Shown on your profile</Text></Stack>") },
      // a control with a label and a Text before it is not this law's business
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Text>Intro</Text><Input label=\"Name\" /></Stack>") },
      // a spread may carry the label
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Text>Name</Text><Input {...props} /></Stack>") },
      // a plain span with a dynamic child is not a literal label
      { filename: BLOCK, code: code("<div><span>{name}</span><Input label=\"Name\" /></div>") },
      // not Grammar controls
      { filename: BLOCK, code: "import { Text } from \"@starci/grammar/core\"\nimport { Input } from \"./mine\"\nexport const A = () => <div><Text>Name</Text><Input aria-label=\"Name\" /></div>" },
      // a control alone with an aria-label only is not a hand-made label
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Input aria-label=\"Search\" /></Stack>") },
      // a script is not product source
      { filename: SCRIPT, code: code("<div><Text>Name</Text><Input aria-label=\"Name\" /></div>") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Text>Name</Text><Input value={name} onChange={setName} /></Stack>"), errors: [handMade] },
      // an aria-label-only control
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Text size=\"sm\">Role</Text><Select aria-label=\"Role\" items={roles} /></Stack>"), errors: [handMade] },
      // Label, a plain label and a plain span with literal text
      { filename: BLOCK, code: code("<div><Label>Name</Label><Input /></div>"), errors: [handMade] },
      { filename: BLOCK, code: code("<div><label>Name</label><G.Input /></div>"), errors: [handMade] },
      { filename: BLOCK, code: code("<div><span>Name</span><Input /></div>"), errors: [handMade] },
      // through a fragment, a condition and a map
      { filename: BLOCK, code: code("<div><><Text>Name</Text><Input /></></div>"), errors: [handMade] },
      { filename: BLOCK, code: code("<div>{ok && <Text>Name</Text>}<Input /></div>"), errors: [handMade] },
      { filename: BLOCK, code: code("<div>{fields.map((f) => <><Text key={f}>{f}</Text><Input /></>)}</div>"), errors: [handMade] },
      // a Switch
      { filename: BLOCK, code: code("<Stack gap=\"row\"><Text>Notify me</Text><Switch isSelected={on} /></Stack>"), errors: [handMade] },
      // whitespace between them does not separate them
      { filename: BLOCK, code: code("<div>\n  <Text>Name</Text>\n  {/* the field */}\n  <Input />\n</div>"), errors: [handMade] },
    ],
  })
})
