/**
 * Twin tests for the button arrow law (`FE_BUTTON_ARROW`).
 *
 *   node --test src/button-arrow.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { buttonArrow, buttonIconPrimaryOnly, recommended, rules } from "./button-arrow.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { Button, Icon, TextAction } from \"@starci/grammar\"\n"

test("the law publishes its rules and they are errors", () => {
  assert.deepEqual(Object.keys(rules), ["button-arrow", "button-icon-primary-only"])
  assert.deepEqual(recommended, { "starci-grammar/button-arrow": "error", "starci-grammar/button-icon-primary-only": "error" })
})

test("FE_BUTTON_ARROW: a typed or passed arrow, or endArrow with a start mark, is red", () => {
  slotTester().run("button-arrow", buttonArrow, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endArrow>View runs</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" onPress={save} startGlyph=\"send\">Send</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button endContent={<Badge>3</Badge>}>Inbox</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" endArrow={false} startGlyph=\"send\">Send</Button>" },
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
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" href=\"/runs\" endArrow startGlyph=\"send\">View</Button>", errors: [{ messageId: "both" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" href=\"/runs\" endArrow startContent={<Icon source={x} />}>View</Button>", errors: [{ messageId: "both" }] },
    ],
  })
})

test("FE_BUTTON_ICON_PRIMARY_ONLY: only a primary Button carries a leading icon", () => {
  slotTester().run("button-icon-primary-only", buttonIconPrimaryOnly, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" startGlyph=\"plus\" onPress={add}>Add</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" size=\"lg\" startGlyph=\"plus\" onPress={add}>Add</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" size=\"sm\" onPress={add}>Add</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" startContent={<Icon source={x} />} onPress={add}>Add</Button>" },
      // the arrow is not an icon: any intent may lead
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"neutral\" href=\"/runs\" endArrow>View runs</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endArrow>View runs</Button>" },
      // text only, and an icon-only IconButton, are fine
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"alternative\" onPress={edit}>Edit</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <IconButton intent=\"neutral\" label=\"Edit\" source={x} />" },
      // an explicitly empty start states no icon
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"neutral\" startContent={undefined}>Edit</Button>" },
      // a local Button and a script are not judged
      { filename: BLOCK, code: "const Button = (p) => p.children\nexport const A = () => <Button startGlyph=\"plus\">Add</Button>" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <Button intent=\"neutral\" startGlyph=\"plus\">Add</Button>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"neutral\" startGlyph=\"plus\" onPress={add}>Add</Button>", errors: [{ messageId: "icon" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" size=\"sm\" startGlyph=\"plus\" onPress={add}>Add</Button>", errors: [{ messageId: "small" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"commit\" size=\"sm\" startContent={<Icon source={x} />} onPress={add}>Add</Button>", errors: [{ messageId: "small" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"alternative\" startContent={<Icon source={x} />} onPress={add}>Add</Button>", errors: [{ messageId: "icon" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"destructive\" startGlyph=\"trash\" onPress={del}>Delete</Button>", errors: [{ messageId: "icon" }] },
      // no intent renders the secondary step
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button startGlyph=\"plus\" onPress={add}>Add</Button>", errors: [{ messageId: "icon" }] },
      // a computed intent cannot be proven primary
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent={intent} startGlyph=\"plus\" onPress={add}>Add</Button>", errors: [{ messageId: "icon" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button intent=\"neutral\" startGlyph=\"plus\" startContent={<Icon source={x} />}>Add</Button>", errors: [{ messageId: "icon" }, { messageId: "icon" }] },
    ],
  })
})
