/**
 * Twin tests for the one-way-to-choose law (R380): no ButtonGroup, FilterButtonGroup or SegmentedControl in product source.
 *
 *   node --test src/choice-controls.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noButtonViewSwitch, noGroupedChoiceControls, noPrimaryTabsMisuse, recommended, rules } from "./choice-controls.ts"

const BLOCK = at("apps/web/src/components/blocks/Booking/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const grouped = (component: string, replacement: string) => [{ messageId: "grouped" as const, data: { component, replacement } }]

test("the law publishes three rules and all are errors", () => {
  assert.deepEqual(Object.keys(rules), ["no-grouped-choice-controls", "no-button-view-switch", "no-primary-tabs-misuse"])
  assert.deepEqual(recommended, {
    "starci-grammar/no-grouped-choice-controls": "error",
    "starci-grammar/no-button-view-switch": "error",
    "starci-grammar/no-primary-tabs-misuse": "error",
  })
})

test("R380: primary tabs hold two to four fixed options, no count, no href", () => {
  slotTester().run("no-primary-tabs-misuse", noPrimaryTabsMisuse, {
    valid: [
      { filename: BLOCK, code: "export const A = () => <Tabs appearance=\"primary\" label=\"Period\" items={[{ id: \"a\", label: \"This month\" }, { id: \"b\", label: \"Last month\" }]} selectedKey=\"a\" />" },
      { filename: BLOCK, code: "export const A = () => <Tabs label=\"Status\" kind=\"filter\" items={[{ id: \"a\", label: \"All\", count: 3 }, { id: \"b\", label: \"Mine\", href: \"/m\" }]} />" },
      { filename: BLOCK, code: "export const z = { kind: \"switch\", label: \"Period\", items: [{ id: \"d\", label: \"Day\" }, { id: \"w\", label: \"Week\" }] }" },
      { filename: SCRIPT, code: "export const A = () => <Tabs appearance=\"primary\" label=\"x\" items={[{ id: \"a\", label: \"A\", count: 1 }, { id: \"b\", label: \"B\" }]} />" },
    ],
    invalid: [
      { filename: BLOCK, code: "export const A = () => <Tabs appearance=\"primary\" label=\"Period\" items={[{ id: \"a\", label: \"A\", count: 3 }, { id: \"b\", label: \"B\" }]} />", errors: [{ messageId: "primary" }] },
      { filename: BLOCK, code: "export const A = () => <Tabs appearance=\"primary\" label=\"Nav\" items={[{ id: \"a\", label: \"A\", href: \"/a\" }, { id: \"b\", label: \"B\", href: \"/b\" }]} />", errors: [{ messageId: "primary" }] },
      { filename: BLOCK, code: "export const z = { kind: \"switch\", label: \"Range\", items: [{ id: \"1\" }, { id: \"2\" }, { id: \"3\" }, { id: \"4\" }, { id: \"5\" }] }", errors: [{ messageId: "primary" }] },
    ],
  })
})

test("R380: Buttons carrying a selection state side by side are a view switch", () => {
  slotTester().run("no-button-view-switch", noButtonViewSwitch, {
    valid: [
      // one toggle on its own is a command with a state
      { filename: BLOCK, code: "export const A = () => <div><Button aria-pressed={on} onPress={t}>Mute</Button><Button onPress={s}>Save</Button></div>" },
      // buttons with no selection state
      { filename: BLOCK, code: "export const A = () => <div><Button onPress={a}>Cancel</Button><Button onPress={b}>Save</Button></div>" },
      { filename: BLOCK, code: "export const A = () => <Tabs label=\"Period\" kind=\"filter\" items={items} />" },
      { filename: SCRIPT, code: "export const A = () => <div><Button isSelected>a</Button><Button>b</Button></div>" },
    ],
    invalid: [
      { filename: BLOCK, code: "export const A = () => <div><Button aria-pressed={p === \"this\"} onPress={a}>This month</Button><Button aria-pressed={p === \"last\"} onPress={b}>Last month</Button></div>", errors: [{ messageId: "switch" }, { messageId: "switch" }] },
      { filename: BLOCK, code: "export const A = () => <div>{periods.map((p) => <Button key={p.id} isSelected={p.id === current} onPress={() => set(p.id)}>{p.label}</Button>)}</div>", errors: [{ messageId: "switch" }] },
    ],
  })
})

test("R380: a grouped choice control is red and names its replacement", () => {
  slotTester().run("no-grouped-choice-controls", noGroupedChoiceControls, {
    valid: [
      { filename: BLOCK, code: "export const A = () => <Tabs label=\"Status\" kind=\"filter\" items={items} />" },
      { filename: BLOCK, code: "export const A = () => <ChoiceChips label=\"Time\" options={slots} empty={null} />" },
      { filename: BLOCK, code: "export const A = () => <RadioGroup label=\"Mode\" options={modes} />" },
      { filename: SCRIPT, code: "export const A = () => <ButtonGroup>x</ButtonGroup>" },
    ],
    invalid: [
      { filename: BLOCK, code: "export const A = () => <ButtonGroup label=\"Actions\" />", errors: grouped("ButtonGroup", "separate `Button`s (one commit, the rest alternative or dismiss), or a `DropdownMenu` for the overflow") },
      { filename: BLOCK, code: "export const A = () => <G.FilterButtonGroup label=\"Status\" options={o} />", errors: grouped("FilterButtonGroup", "`Tabs kind=\"filter\"` (compact underline tabs with a `count` each, under the list's search field) to narrow a list that stays in place") },
      { filename: BLOCK, code: "export const A = () => <SegmentedControl label=\"Mode\" options={o} />", errors: grouped("SegmentedControl", "`ChoiceChips` or `RadioGroup` to choose a value of a form, or `Tabs appearance=\"primary\"` (a `switch` header zone) to switch a mode or period of one block") },
    ],
  })
})
