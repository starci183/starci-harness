import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { buttonArrow, noTypedArrow } from "./button-arrow.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { Button, Icon, TextAction } from \"@starci/grammar\"\n"

test("FE_BUTTON_ARROW: a typed or passed arrow, or endArrow with a start mark, is red", () => {
  slotTester().run("button-arrow", buttonArrow, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endArrow>View runs</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button variant=\"primary\" onPress={save} startGlyph=\"send\">Send</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button endContent={<Badge>3</Badge>}>Inbox</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button variant=\"primary\" endArrow={false} startGlyph=\"send\">Send</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button>{t(\"go\")}</Button>" },
      // a typed arrow character is no-typed-arrow's, for every element
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\">View runs →</Button>" },
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
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\">{go ? \"Open »\" : \"Open ›\"}</Button>", errors: [{ messageId: "label" }, { messageId: "label" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<Icon source={ArrowRightIcon} />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<ArrowRightIcon />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<ChevronRightIcon />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endContent={<Icon glyph=\"chevron-end\" />}>View</Button>", errors: [{ messageId: "endContent" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button variant=\"primary\" href=\"/runs\" endArrow startGlyph=\"send\">View</Button>", errors: [{ messageId: "both" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button variant=\"primary\" href=\"/runs\" endArrow startContent={<Icon source={x} />}>View</Button>", errors: [{ messageId: "both" }] },
    ],
  })
})


test("FE_NO_TYPED_ARROW: an arrow character in any rendered text is red; direction is a Grammar icon", () => {
  slotTester().run("no-typed-arrow", noTypedArrow, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\" endArrow>Xem lượt</Button>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text>Sign-in · 2 – 1</Text>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Link href=\"/a→b\" className=\"x→\" data-x=\"→\">Xem đơn</Link>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text>{t(\"next\")}</Text>" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <Text>Next →</Text>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text>Xem đơn →</Text>", errors: [{ messageId: "typed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Button href=\"/runs\">View runs →</Button>", errors: [{ messageId: "typed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <div>{\"Next ->\"}</div>", errors: [{ messageId: "typed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <>{ok ? \"Lên ↑\" : \"Xuống ↓\"}</>", errors: [{ messageId: "typed" }, { messageId: "typed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section title=\"Bước 1 ⇒ Bước 2\" aria-label=\"Mở ➜\" />", errors: [{ messageId: "typed" }, { messageId: "typed" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text>{`Tiếp ⟶`}</Text>", errors: [{ messageId: "typed" }] },
    ],
  })
})
