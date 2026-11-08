/**
 * Twin tests for the button arrow law (`FE_BUTTON_ARROW`).
 *
 *   node --test src/button-arrow.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { buttonArrow, recommended, rules } from "./button-arrow.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { Button, Icon, TextAction } from \"@starci/grammar\"\n"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["button-arrow"])
  assert.deepEqual(recommended, { "starci-grammar/button-arrow": "error" })
})

test("FE_BUTTON_ARROW: a typed or passed arrow, or endArrow with a start mark, is red", () => {
  slotTester().run("button-arrow", buttonArrow, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endArrow>View runs</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button onPress={save} startGlyph=\"send\">Send</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button endContent={<Badge>3</Badge>}>Inbox</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button endArrow={false} startGlyph=\"send\">Send</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button>{t(\"go\")}</Button>" },
      // a hyphen is not an arrow
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button>Sign-in</Button>" },
      // another component's text, and a local Button, are not judged
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text>Next →</Text>" },
      { filename: BLOCK, code: "const Button = (p) => p.children\nexport const A = () => <Button>Next →</Button>" },
      // TextAction has no endArrow, so it is not judged
      { filename: BLOCK, code: IMPORT + "export const A = () => <TextAction endContent={<Icon source={ArrowRightIcon} />}>Open</TextAction>" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <Button>Next →</Button>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\">View runs →</Button>", errors: [{ messageId: "label" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\">{\"Next ->\"}</Button>", errors: [{ messageId: "label" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\">{go ? \"Open »\" : \"Open ›\"}</Button>", errors: [{ messageId: "label" }, { messageId: "label" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<Icon source={ArrowRightIcon} />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<ArrowRightIcon />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<ChevronRightIcon />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<Icon glyph=\"chevron-end\" />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endArrow startGlyph=\"send\">View</Button>", errors: [{ messageId: "both" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endArrow startContent={<Icon source={x} />}>View</Button>", errors: [{ messageId: "both" }] },
    ],
  })
})
