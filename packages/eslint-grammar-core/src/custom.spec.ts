/**
 * Twin tests for the Custom law and for the exemption every other Grammar rule gives a Custom subtree.
 *
 *   node --test src/custom.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { customHasReason, recommended, rules as customRules } from "./custom.ts"
import { rules } from "./index.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Custom, SurfaceCard } from \"@starci/grammar/core\"\n"
const rule = (name: string) => {
  const found = rules[name]
  assert.ok(found, `${name} is published`)
  return found
}

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(customRules), ["custom-has-reason"])
  assert.deepEqual(recommended, { "starci-grammar/custom-has-reason": "error" })
})

test("a Custom region names its reason", () => {
  slotTester().run("custom-has-reason", customHasReason, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Custom reason=\"workflow graph\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Custom as=\"section\" reason={\"graph\"} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Custom reason={`graph`} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Custom {...p} />" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <Custom />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Custom />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Custom reason=\"  \" />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Custom reason={p.why} />", errors: [{ messageId: "reason" }] },
      // the law judges the element even inside another region
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Custom reason=\"outer\"><Custom /></Custom>", errors: [{ messageId: "reason" }] },
    ],
  })
})

test("nothing inside Custom is reported by a Grammar rule; outside it every rule stays", () => {
  assert.doesNotThrow(() => slotTester().run("no-raw-structural-element", rule("no-raw-structural-element"), {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Custom reason=\"art\"><div><span /><ul /><table /></div></Custom>" },
      { filename: BLOCK, code: IMPORTS + "import * as G from \"@starci/grammar/core\"\nexport const A = () => <G.Custom reason=\"art\" as=\"section\"><h1>t</h1></G.Custom>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <span />", errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><Custom reason=\"art\"><span /></Custom><span /></div>", errors: [{ messageId: "raw" }] },
      // a component of the same name that the Grammar does not export opens no region
      { filename: BLOCK, code: "const Custom = (p: { readonly children?: unknown }) => <>{p.children}</>\nexport const A = () => <Custom><span /></Custom>", errors: [{ messageId: "raw" }] },
    ],
  }))
})

test("the HeroUI import boundary: a primitive imported for Custom alone is not judged", () => {
  assert.doesNotThrow(() => slotTester().run("vendor-primitive-has-named-owner", rule("vendor-primitive-has-named-owner"), {
    valid: [{ filename: BLOCK, code: IMPORTS + "import { Chip } from \"@heroui/react\"\nexport const A = () => <Custom reason=\"vendor demo\"><Chip /></Custom>" }],
    invalid: [{ filename: BLOCK, code: IMPORTS + "import { Chip } from \"@heroui/react\"\nexport const A = () => <><Chip /><Custom reason=\"x\"><Chip /></Custom></>", errors: [{ messageId: "owner" }] }],
  }))
})
