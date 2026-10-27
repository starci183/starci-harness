/** Behavioral witnesses for StarCi's per-slot status renderer. */
import test from "node:test"
import { at, slotTester } from "../eslint-canon-fe/fixtures/typed/tester.mjs"
import { slotStatusThroughSlotView } from "./drawing.mjs"

const tester = slotTester()
const BLOCK = at("apps/web/src/components/blocks/sales/HandoffBlock/component.tsx")
const BLOCK_INDEX = at("apps/web/src/components/blocks/sales/HandoffBlock/index.tsx")
const COMPOSITE = at("apps/web/src/components/composites/SlotView/index.tsx")

test("a block's pure half renders data status only through SlotView", () => {
  tester.run("slot-status-through-slotview", slotStatusThroughSlotView, {
    valid: [
      { filename: BLOCK, code: "export const X = (props: P) => <SlotView slot={props.props.order}>{(o) => <p>{o.code}</p>}</SlotView>" },
      { filename: BLOCK, code: "export const X = (props: P) => (props.state === \"sent\" ? <p /> : null)" },
      { filename: COMPOSITE, code: "export const SlotView = (props: P) => (props.slot.isLoading ? <p /> : null)" },
      // a shared-package drawing half is not a block's pure half
      { filename: at("packages/nivo-ui/src/leaves/Badge/component.tsx"), code: "export const X = (props: P) => (props.props.isLoading ? <Spinner /> : <p />)" },
      { filename: BLOCK_INDEX, code: "const state = query.isLoading ? \"a\" : \"b\"" },
    ],
    invalid: [
      { filename: BLOCK, code: "export const X = (props: P) => (props.props.isLoading ? <Spinner /> : <p />)", errors: [{ messageId: "branch" }] },
      { filename: BLOCK, code: "export const X = (props: P) => <div>{props.props.order.isError && <p />}</div>", errors: [{ messageId: "branch" }] },
      { filename: BLOCK, code: "const f = (s) => { if (s.isForbidden) return null; return 1 }", errors: [{ messageId: "branch" }] },
    ],
  })
})
