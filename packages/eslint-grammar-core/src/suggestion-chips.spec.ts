/**
 * Twin tests for the suggestion chips law (`FE_SUGGESTION_CHIPS`).
 *
 *   node --test src/suggestion-chips.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, suggestionChips } from "./suggestion-chips.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { Button, Cluster, Stack } from \"@starci/grammar\"\n"
const chip = (label: string): string => `<Button size="sm" onPress={() => send(${label})}>{${label}}</Button>`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["suggestion-chips"])
  assert.deepEqual(recommended, { "starci-grammar/suggestion-chips": "error" })
})

test("FE_SUGGESTION_CHIPS: a row of neutral sm Buttons that send their own label is red", () => {
  slotTester().run("suggestion-chips", suggestionChips, {
    valid: [
      // one Button that is not in a map is not a row
      { filename: BLOCK, code: IMPORT + `export const A = () => <Cluster>${chip("q")}</Cluster>` },
      // md Buttons, a commit intent, a handler that sends something else
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Button onPress={() => send(a)}>{a}</Button><Button onPress={() => send(b)}>{b}</Button></Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Button size=\"sm\" intent=\"commit\" onPress={() => send(a)}>{a}</Button><Button size=\"sm\" intent=\"commit\" onPress={() => send(b)}>{b}</Button></Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Button size=\"sm\" onPress={save}>Save</Button><Button size=\"sm\" onPress={() => close()}>Close</Button></Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{items.map((item) => <Button key={item.id} size=\"sm\" onPress={() => open(item.id)}>{item.label}</Button>)}</Cluster>" },
      // a computed size or intent, a spread: ambiguous
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{qs.map((q) => <Button size={size} onPress={() => send(q)}>{q}</Button>)}</Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{qs.map((q) => <Button size=\"sm\" intent={tone} onPress={() => send(q)}>{q}</Button>)}</Cluster>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{qs.map((q) => <Button size=\"sm\" {...rest} onPress={() => send(q)}>{q}</Button>)}</Cluster>" },
      // a local Button and a script are not judged
      { filename: BLOCK, code: "const Button = (p) => p.children\nexport const A = () => <div>{qs.map((q) => <Button size=\"sm\" onPress={() => send(q)}>{q}</Button>)}</div>" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <Cluster>{qs.map((q) => <Button size=\"sm\" onPress={() => send(q)}>{q}</Button>)}</Cluster>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster>{qs.map((q) => <Button key={q} size=\"sm\" onPress={() => send(q)}>{q}</Button>)}</Cluster>", errors: [{ messageId: "chips" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Stack>{items.map((item) => <Button key={item.id} size=\"sm\" intent=\"neutral\" onPress={() => ask(item.label)}>{item.label}</Button>)}</Stack>", errors: [{ messageId: "chips" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <div>{qs.map((q) => <Button size=\"sm\" intent=\"alternative\" onPress={() => { send(q) }}>{q}</Button>)}</div>", errors: [{ messageId: "chips" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><Button size=\"sm\" onPress={() => send(\"Why?\")}>Why?</Button><Button size=\"sm\" onPress={() => send(\"How?\")}>{\"How?\"}</Button></Cluster>", errors: [{ messageId: "chips" }, { messageId: "chips" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Cluster><>" + chip("a") + "</>" + chip("b") + "</Cluster>", errors: [{ messageId: "chips" }, { messageId: "chips" }] },
    ],
  })
})
