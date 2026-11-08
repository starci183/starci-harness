/**
 * Twin tests for the Tabs laws: the pill stands only as a card's `switch` zone, and a page stacks two underline layers.
 *
 *   node --test src/tabs.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, tabsDepth, tabsSwitchZone } from "./tabs.ts"

const BLOCK = at("apps/web/src/components/blocks/Booking/component.tsx")
const SCRIPT = at("scripts/build.tsx")

const ITEMS = "items={[{ id: \"a\", label: \"A\" }, { id: \"b\", label: \"B\" }]}"

test("the law publishes two rules and both are errors", () => {
  assert.deepEqual(Object.keys(rules), ["tabs-switch-zone", "tabs-depth"])
  assert.deepEqual(recommended, { "starci-grammar/tabs-switch-zone": "error", "starci-grammar/tabs-depth": "error" })
})

test("tabs-switch-zone: the pill is the switch header zone, never JSX", () => {
  slotTester().run("tabs-switch-zone", tabsSwitchZone, {
    valid: [
      { filename: BLOCK, code: "export const A = () => <SurfaceCard kind=\"list\" label=\"Cash\" headers={[{ kind: \"switch\", label: \"Period\", items: [{ id: \"a\", label: \"This month\" }, { id: \"b\", label: \"Last month\" }], selectedKey: \"a\", onSelect: set }]} items={rows} empty={empty} />" },
      { filename: BLOCK, code: `export const A = () => <Tabs label="Views" ${ITEMS} selectedKey="a" />` },
      { filename: BLOCK, code: `export const A = () => <Tabs label="Status" kind="filter" ${ITEMS} selectedKey="a" />` },
      { filename: BLOCK, code: `export const A = ({ appearance }) => <Tabs label="x" appearance={appearance} ${ITEMS} />` },
      { filename: SCRIPT, code: `export const A = () => <Tabs appearance="primary" label="x" ${ITEMS} />` },
    ],
    invalid: [
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs appearance="primary" label="Views" ${ITEMS} selectedKey="a" /></Page>`, errors: [{ messageId: "pill" }] },
      { filename: BLOCK, code: `export const A = () => <Drawer><Tabs appearance="primary" label="Mode" ${ITEMS} /></Drawer>`, errors: [{ messageId: "pill" }] },
      { filename: BLOCK, code: `export const A = () => <Pane label="p"><Grammar.Tabs appearance={"primary"} label="Mode" ${ITEMS} /></Pane>`, errors: [{ messageId: "pill" }] },
    ],
  })
})

test("tabs-depth: page tabs and one region set, the region set as kind=filter", () => {
  slotTester().run("tabs-depth", tabsDepth, {
    valid: [
      // page tabs (header) + one region set drawn as the 13px filter look
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs kind="filter" label="Status" ${ITEMS} selectedKey={status} onSelect={setStatus} /></Page>` },
      // a lone set with no page tabs
      { filename: BLOCK, code: `export const A = () => <Tabs label="Views" ${ITEMS} selectedKey={view} onSelect={setView} />` },
      // a page without header tabs: one set nested in another's panel is the second layer
      { filename: BLOCK, code: `export const A = () => <div><Tabs label="Views" ${ITEMS} selectedKey={view} />{view === "a" && <Tabs kind="filter" label="Sub" ${ITEMS} selectedKey={sub} />}</div>` },
      // a drawer starts its own surface: its set is the first layer of the drawer
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Drawer><Tabs label="Mode" ${ITEMS} selectedKey="a" /></Drawer></Page>` },
      // the page tabs are the header's object, not a Tabs element; two sibling region sets are each layer two
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs kind="filter" label="a" ${ITEMS} selectedKey={s1} /><Tabs kind="filter" label="b" ${ITEMS} selectedKey={s2} /></Page>` },
      // a Page header without tabs stacks no layer
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x" }}><Tabs label="Views" ${ITEMS} selectedKey={view} /></Page>` },
      // a dynamic kind is not judged
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs kind={kind} label="a" ${ITEMS} selectedKey={s1} /></Page>` },
      { filename: SCRIPT, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs label="a" ${ITEMS} /></Page>` },
    ],
    invalid: [
      // the live case: views drawn at the page-tab size under the page tabs
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs label="Views" ${ITEMS} selectedKey={view} /></Page>`, errors: [{ messageId: "region" }] },
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs kind="views" label="Views" ${ITEMS} selectedKey={view} /></Page>`, errors: [{ messageId: "region" }] },
      // a region set nested in another set's panel, with no page tabs, is drawn as the filter look
      { filename: BLOCK, code: `export const A = () => <div><Tabs label="Views" ${ITEMS} selectedKey={view} />{view === "a" ? <Tabs label="Sub" ${ITEMS} selectedKey={sub} /> : null}</div>`, errors: [{ messageId: "region" }] },
      // a third layer: page tabs, a set, and a set in that set's panel
      {
        filename: BLOCK,
        code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs kind="filter" label="a" ${ITEMS} selectedKey={view} />{view === "a" && <Tabs kind="filter" label="b" ${ITEMS} selectedKey={sub} />}</Page>`,
        errors: [{ messageId: "depth" }],
      },
      // a third layer without page tabs: three sets, each in the panel of the one before
      {
        filename: BLOCK,
        code: `export const A = () => <div><Tabs kind="filter" label="a" ${ITEMS} selectedKey={one} />{one === "a" && <div><Tabs kind="filter" label="b" ${ITEMS} selectedKey={two} />{two === "a" && <Tabs kind="filter" label="c" ${ITEMS} selectedKey={three} />}</div>}</div>`,
        errors: [{ messageId: "depth" }],
      },
    ],
  })
})
