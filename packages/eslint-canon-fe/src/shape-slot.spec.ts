/**
 * Twin tests for the shape and slot law.
 *
 *   node --test src/shape-slot.spec.ts
 *
 * The cases that matter sit at the edges of each scope: the connected half may hold status, SlotView and a route's
 * loading page own the status recipe, and a branch may keep its own interaction state.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester, typedTester } from "../fixtures/typed/tester.ts"
import { branchIntrinsicState, exhaustiveShapeSwitch, noDataStatusProp, regionReadsThroughSlot, rules } from "./shape-slot.ts"

const tester = slotTester()

const BLOCK = at("apps/web/src/components/blocks/sales/HandoffBlock/component.tsx")
const BLOCK_INDEX = at("apps/web/src/components/blocks/sales/HandoffBlock/index.tsx")
const OVERLAY = at("apps/web/src/features/overlays/sales/SendOverlay/component.tsx")
const COMPOSITE = at("apps/web/src/components/composites/OrderCard/index.tsx")
const SLOT_VIEW = at("apps/web/src/components/composites/SlotView/index.tsx")
const LOADING_PAGE = at("apps/web/src/features/pages/OrdersLoadingPage/component.tsx")
const BRANCH = at("apps/web/src/components/branches/OrderRow/index.tsx")
const LEAF = at("apps/web/src/components/leaves/Amount/index.tsx")

const SHAPE = "export type HandoffBlockShape = \"prepared\" | \"sent\" | \"returned\"\n"

test("every rule this law declares is a rule with a description", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(typeof rule.create, "function", name)
    assert.ok(rule.meta.docs?.description, name)
  }
})

test("a pure half's branch on its shape draws every member, with no default standing in", () => {
  assert.doesNotThrow(() => tester.run("exhaustive-shape-switch", exhaustiveShapeSwitch, {
    valid: [
      {
        filename: BLOCK,
        code: `${SHAPE}export const HandoffBlockBase = (props: { shape: HandoffBlockShape }) => {
          switch (props.shape) { case "prepared": return <a />; case "sent": return <b />; case "returned": return <i /> }
        }`,
      },
      { filename: BLOCK, code: `${SHAPE}const draw = (shape: HandoffBlockShape) => shape === "prepared" ? 1 : shape === "sent" ? 2 : 3` },
      // a switch on something else is not a shape branch
      { filename: BLOCK, code: `${SHAPE}const f = (kind: string) => { switch (kind) { case "a": return 1; default: return 2 } }` },
      // the connected half picks the shape; it is not the drawing
      { filename: BLOCK_INDEX, code: `${SHAPE}const f = (props: { shape: HandoffBlockShape }) => { switch (props.shape) { case "sent": return 1 } }` },
    ],
    invalid: [
      {
        filename: BLOCK,
        code: `${SHAPE}export const HandoffBlockBase = (props: { shape: HandoffBlockShape }) => {
          switch (props.shape) { case "prepared": return <a />; case "sent": return <b /> }
        }`,
        errors: [{ messageId: "missing" }],
      },
      {
        filename: BLOCK,
        code: `${SHAPE}export const HandoffBlockBase = (props: { shape: HandoffBlockShape }) => {
          switch (props.shape) { case "prepared": return <a />; default: return <b /> }
        }`,
        errors: [{ messageId: "hidden" }],
      },
      { filename: BLOCK, code: `${SHAPE}const draw = (shape: HandoffBlockShape) => shape === "prepared" ? 1 : 2`, errors: [{ messageId: "hidden" }] },
    ],
  }))
})

test("the shape union is read from the program's types when it comes from elsewhere", () => {
  assert.doesNotThrow(() => typedTester().run("exhaustive-shape-switch-typed", exhaustiveShapeSwitch, {
    valid: [
      {
        filename: OVERLAY,
        code: "type SendOverlayShape = \"form\" | \"confirm\"\ndeclare const props: { readonly shape: SendOverlayShape }\nexport const x = () => { switch (props.shape) { case \"form\": return 1; case \"confirm\": return 2 } }",
      },
    ],
    invalid: [
      {
        filename: OVERLAY,
        code: "declare const props: { readonly shape: \"form\" | \"confirm\" | \"sent\" }\nexport const x = () => { switch (props.shape) { case \"form\": return 1; default: return 2 } }",
        errors: [{ messageId: "hidden" }],
      },
    ],
  }))
})

test("no unit below SlotView takes a data-status prop; a leaf takes only isSkeleton", () => {
  assert.doesNotThrow(() => tester.run("no-data-status-prop", noDataStatusProp, {
    valid: [
      { filename: SLOT_VIEW, code: "type SlotViewProps = { readonly isLoading: boolean; readonly isError: boolean; readonly isForbidden: boolean }" },
      { filename: LOADING_PAGE, code: "type OrdersLoadingPageBaseProps = { readonly props: { readonly isLoading: boolean } }" },
      { filename: LEAF, code: "type AmountProps = { readonly value: string; readonly isSkeleton?: boolean }" },
      { filename: COMPOSITE, code: "type OrderCardProps = { readonly isPending: boolean; readonly isOpen: boolean }" },
      // the DataSlot type lives in modules/types, outside every unit
      { filename: at("apps/web/src/modules/types/slot.ts"), code: "export type DataSlot<T> = { readonly items?: T; readonly isLoading?: boolean; readonly isError?: boolean }" },
    ],
    invalid: [
      { filename: COMPOSITE, code: "type OrderCardProps = { readonly isLoading: boolean }", errors: [{ messageId: "status" }] },
      { filename: BLOCK, code: "type HandoffBlockBaseProps = { readonly props: { readonly isFailed: boolean; readonly failure: string | null } }", errors: [{ messageId: "status" }, { messageId: "status" }] },
      { filename: BRANCH, code: "interface OrderRowProps { readonly isForbidden: boolean }", errors: [{ messageId: "status" }] },
      { filename: LEAF, code: "type AmountProps = { readonly isError?: boolean }", errors: [{ messageId: "leaf" }] },
    ],
  }))
})

test("a region that reads data folds it into a DataSlot and renders it through SlotView", () => {
  assert.doesNotThrow(() => tester.run("region-reads-through-slot", regionReadsThroughSlot, {
    valid: [
      { filename: BLOCK_INDEX, code: "const order = useGetOrderSwr({ id })\nexport const slot = slotOfSwr(order)" },
      { filename: BLOCK_INDEX, code: "const order = useGetOrderSwr({ id })\nexport const slot = mapSlot(toSlot(order), (o) => o.code)" },
      { filename: BLOCK_INDEX, code: "export const HandoffBlock = () => <HandoffBlockBase props={{}} />" },
      { filename: BLOCK, code: "type P = { readonly order: DataSlot<Order> }\nexport const HandoffBlockBase = (props: { props: P }) => <SlotView slot={props.props.order}>{(o) => <i />}</SlotView>" },
      { filename: BLOCK, code: "export const HandoffBlockBase = (props: { props: { readonly id: string } }) => <i />" },
      // a branch is no split tier: it receives atoms and is judged by branch-intrinsic-state
      { filename: BRANCH, code: "const order = useGetOrderSwr({ id })" },
    ],
    invalid: [
      { filename: BLOCK_INDEX, code: "const order = useGetOrderSwr({ id })\nexport const items = order.data", errors: [{ messageId: "slot" }] },
      { filename: BLOCK, code: "type P = { readonly order: DataSlot<Order> }\nexport const HandoffBlockBase = (props: { props: P }) => props.props.order.isLoading ? <i /> : <b />", errors: [{ messageId: "view" }] },
    ],
  }))
})

test("a branch keeps only interaction state, and a leaf holds no hook", () => {
  assert.doesNotThrow(() => tester.run("branch-intrinsic-state", branchIntrinsicState, {
    valid: [
      { filename: BRANCH, code: "import { useState } from \"react\"\nexport const OrderRow = () => { const [open, setOpen] = useState(false); return <i onClick={() => setOpen(!open)} /> }" },
      { filename: BRANCH, code: "useEffect(() => { const id = setTimeout(close, 300); return () => clearTimeout(id) }, [])" },
      { filename: LEAF, code: "export const Amount = (props: { readonly value: string }) => <span>{props.value}</span>" },
      // a block owns the reads
      { filename: BLOCK_INDEX, code: "import { useGetOrderSwr } from \"@/hooks/swr\"\nconst order = useGetOrderSwr({ id })" },
    ],
    invalid: [
      { filename: BRANCH, code: "import { useOrderDraft } from \"@/hooks/orders\"", errors: [{ messageId: "hooks" }] },
      { filename: BRANCH, code: "import type { OrderView } from \"@/hooks\"", errors: [{ messageId: "hooks" }] },
      { filename: BRANCH, code: "const order = useGetOrderSwr({ id })", errors: [{ messageId: "data" }] },
      { filename: BRANCH, code: "useEffect(() => { fetch(\"/api/orders\").then(setRows) }, [])", errors: [{ messageId: "fetch" }] },
      { filename: BRANCH, code: "React.useEffect(() => { void load() }, [])\nasync function load() {}\nReact.useLayoutEffect(async () => { await load() }, [])", errors: [{ messageId: "fetch" }] },
      { filename: LEAF, code: "export const Amount = () => { const [v] = useState(0); return <span>{v}</span> }", errors: [{ messageId: "leaf" }] },
      { filename: LEAF, code: "export const Amount = () => { const id = React.useId(); return <span id={id} /> }", errors: [{ messageId: "leaf" }] },
    ],
  }))
})
