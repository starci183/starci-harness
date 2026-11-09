/**
 * Twin tests for the Tabs laws: the pill stands only as a card's `switch` zone, and a page stacks two underline layers.
 *
 *   node --test src/tabs.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, tabsDepth, tabsInWell, tabsSwitchZone } from "./tabs.ts"

const BLOCK = at("apps/web/src/components/blocks/Booking/component.tsx")
const SCRIPT = at("scripts/build.tsx")

const ITEMS = "items={[{ id: \"a\", label: \"A\" }, { id: \"b\", label: \"B\" }]}"

test("the law publishes two rules and both are errors", () => {
  assert.deepEqual(Object.keys(rules), ["tabs-switch-zone", "tabs-depth", "tabs-in-well"])
  assert.deepEqual(recommended, { "starci-grammar/tabs-switch-zone": "error", "starci-grammar/tabs-depth": "error", "starci-grammar/tabs-in-well": "error" })
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

test("tabs-depth: page tabs and one region set, never a third layer", () => {
  slotTester().run("tabs-depth", tabsDepth, {
    valid: [
      // page tabs (header) + one region set
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs label="Status" ${ITEMS} selectedKey={status} onSelect={setStatus} /></Page>` },
      // the size of a layer is not judged: kind="filter" and the default are both fine
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs kind="filter" label="Status" ${ITEMS} selectedKey={status} onSelect={setStatus} /></Page>` },
      // a lone set with no page tabs
      { filename: BLOCK, code: `export const A = () => <Tabs label="Views" ${ITEMS} selectedKey={view} onSelect={setView} />` },
      // no page tabs: one set nested in another's panel is the second layer
      { filename: BLOCK, code: `export const A = () => <div><Tabs label="Views" ${ITEMS} selectedKey={view} />{view === "a" && <Tabs label="Sub" ${ITEMS} selectedKey={sub} />}</div>` },
      // a drawer starts its own surface: its set is the first layer of the drawer
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Drawer><Tabs label="Mode" ${ITEMS} selectedKey="a" /></Drawer></Page>` },
      // two sibling region sets are each layer two
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs label="a" ${ITEMS} selectedKey={s1} /><Tabs label="b" ${ITEMS} selectedKey={s2} /></Page>` },
      // a Page header without tabs stacks no layer
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x" }}><Tabs label="Views" ${ITEMS} selectedKey={view} /></Page>` },
      { filename: SCRIPT, code: `export const A = () => <Page header={{ title: "x", tabs }}><Tabs label="a" ${ITEMS} selectedKey={v} />{v === "a" && <Tabs label="b" ${ITEMS} selectedKey={w} />}</Page>` },
    ],
    invalid: [
      // the live case: a third layer "Tin nhan / Da ghim" in the panel of a region set inside a Page with header.tabs
      {
        filename: BLOCK,
        code: `export const A = () => <Page header={{ title: "Agent", tabs }}><Tabs label="Workbench" items={[{ id: "today", label: "Hôm nay" }, { id: "inbox", label: "Hộp thư" }]} selectedKey={view} onSelect={setView} />{view === "inbox" && <Tabs label="Inbox" items={[{ id: "messages", label: "Tin nhắn" }, { id: "pinned", label: "Đã ghim" }]} selectedKey={inbox} onSelect={setInbox} />}</Page>`,
        errors: [{ messageId: "depth" }],
      },
      // a third layer without page tabs: three sets, each in the panel of the one before
      {
        filename: BLOCK,
        code: `export const A = () => <div><Tabs label="a" ${ITEMS} selectedKey={one} />{one === "a" && <div><Tabs label="b" ${ITEMS} selectedKey={two} />{two === "a" && <Tabs label="c" ${ITEMS} selectedKey={three} />}</div>}</div>`,
        errors: [{ messageId: "depth" }],
      },
    ],
  })
})

test("tabs-in-well: the second layer stands in the header band, never in the well or a pane body", () => {
  slotTester().run("tabs-in-well", tabsInWell, {
    valid: [
      // in a card, a drawer, or a plain block outside Page and Pane
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "Agent", tabs, subTabs }}><SurfaceCard label="Runs"><Tabs label="Status" ${ITEMS} selectedKey={s} /></SurfaceCard></Page>` },
      { filename: BLOCK, code: `export const A = () => <Drawer title="x"><Tabs label="Status" ${ITEMS} selectedKey={s} /></Drawer>` },
      { filename: BLOCK, code: `export const A = () => <div><Tabs label="Status" ${ITEMS} selectedKey={s} /></div>` },
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "x" }}><Tabs appearance="primary" label="Status" ${ITEMS} selectedKey={s} /></Page>` },
      { filename: SCRIPT, code: `export const A = () => <Page header={{ title: "x" }}><Tabs label="Status" ${ITEMS} selectedKey={s} /></Page>` },
    ],
    invalid: [
      { filename: BLOCK, code: `export const A = () => <Page header={{ title: "Agent", tabs }}><Tabs label="Status" ${ITEMS} selectedKey={s} /></Page>`, errors: [{ messageId: "well" }] },
      { filename: BLOCK, code: `export const A = () => <Pane label="Side"><PaneSection><Tabs label="Status" ${ITEMS} selectedKey={s} /></PaneSection></Pane>`, errors: [{ messageId: "well" }] },
    ],
  })
})
