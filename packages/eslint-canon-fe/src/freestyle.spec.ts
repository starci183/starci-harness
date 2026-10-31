/**
 * The Freestyle region (owner ruling grammar-freestyle-region): the rules that judge hand-written elements, class strings and
 * art leave the raw elements of a Freestyle subtree alone, and judge everything else as before.
 *
 *   node --test src/freestyle.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { noNativeImg } from "./native-controls.ts"
import { noAppSurfacePaint } from "./surface-rules.ts"
import { noArbitraryValue } from "./tokens.ts"

const tester = slotTester()
const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const IMPORTS = "import { Freestyle, SurfaceCard } from \"@starci/grammar/core\"\n"

test("no-arbitrary-value: a raw element inside Freestyle may use an arbitrary value; outside and in a Grammar component it may not", () => {
  assert.doesNotThrow(() => tester.run("no-arbitrary-value", noArbitraryValue, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"sign-in brand art\"><div className=\"w-[42rem] gap-[13px]\" /></Freestyle>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"art\" className=\"h-[30rem]\"><div><div className=\"p-[3px]\" /></div></Freestyle>" },
      { filename: BLOCK, code: IMPORTS + "import * as G from \"@starci/grammar/core\"\nexport const A = () => <G.Freestyle reason=\"art\"><span className=\"p-[3px]\" /></G.Freestyle>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div className=\"w-[42rem]\" />", errors: [{ messageId: "length" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><Freestyle reason=\"art\" /><div className=\"w-[42rem]\" /></div>", errors: [{ messageId: "length" }] },
      // a Grammar component inside Freestyle is still judged
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"art\"><SurfaceCard className=\"w-[42rem]\" /></Freestyle>", errors: [{ messageId: "length" }] },
    ],
  }))
})

test("no-app-surface-paint: raw paint inside Freestyle is the app's own; a Grammar component keeps Grammar's paint", () => {
  assert.doesNotThrow(() => tester.run("no-app-surface-paint", noAppSurfacePaint, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"art\"><div className=\"bg-surface rounded-3xl shadow-lg\" style={{ background: \"red\" }} /></Freestyle>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div className=\"bg-surface rounded-3xl\" />", errors: [{ messageId: "surface" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"art\"><SurfaceCard className=\"bg-surface\" /></Freestyle>", errors: [{ messageId: "surface" }] },
    ],
  }))
})

test("no-native-img: art written as a raw img inside Freestyle is allowed", () => {
  assert.doesNotThrow(() => tester.run("no-native-img", noNativeImg, {
    valid: [{ filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"art\"><img src=\"/images/a.webp\" alt=\"\" /></Freestyle>" }],
    invalid: [{ filename: BLOCK, code: IMPORTS + "export const A = () => <img src=\"/images/a.webp\" alt=\"\" />", errors: [{ messageId: "img" }] }],
  }))
})
