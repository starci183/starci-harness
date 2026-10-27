/** Edition proofs for StarCi's closed slot-status recipe. */
// proves: FE_COMPONENT_API@lite FE_COMPONENT_API@full
import test from "node:test"
import { typedTester, at } from "../eslint-canon-fe/fixtures/typed/tester.mjs"
import { rules as drawing } from "./drawing.mjs"

const BLOCK = at("apps/web/src/components/blocks/sales/HandoffBlock/component.tsx")
for (const edition of ["lite", "full"]) {
  test(`R92 ${edition} uses the family slot-status recipe`, () => {
    const tester = typedTester({ lite: edition === "lite" })
    tester.run("slot-status-through-slotview", drawing["slot-status-through-slotview"], {
      valid: [{filename: BLOCK, code: 'export const X = (props: P) => <SlotView slot={props.props.order}>{(o) => <p>{o.code}</p>}</SlotView>'}],
      invalid: [{filename: BLOCK, code: 'export const X = (props: P) => (props.props.isLoading ? <Spinner /> : <p />)', errors: [{messageId: "branch"}]}],
    })
  })
}
