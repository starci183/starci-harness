/**
 * Twin tests for the Freestyle law (R341) and for the exemption the Grammar rules give a Freestyle subtree.
 *
 *   node --test src/freestyle.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { freestyleHasReason, recommended, rules } from "./freestyle.ts"
import { noRawStructuralElement } from "./grammar-boundary.ts"
import { generatedArtInMascotOrMediaFrame } from "./mascot.ts"
import { noFractionalStep } from "./tokens.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Freestyle, SurfaceCard } from \"@starci/grammar/core\"\n"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["freestyle-has-reason"])
  assert.deepEqual(recommended, { "starci-grammar/freestyle-has-reason": "error" })
})

test("R341: a Freestyle region names its reason", () => {
  slotTester().run("freestyle-has-reason", freestyleHasReason, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"sign-in brand art\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason={\"brand art\"} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason={`brand art`} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Freestyle {...p} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Other />" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <Freestyle />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"  \" />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Freestyle reason={p.why} />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <G.Freestyle reason />", errors: [{ messageId: "reason" }] },
    ],
  })
})

test("a raw element inside Freestyle is not a raw structural element; outside it still is", () => {
  assert.doesNotThrow(() => slotTester().run("no-raw-structural-element", noRawStructuralElement, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"art\"><div><span /><ul /></div></Freestyle>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <span />", errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><Freestyle reason=\"art\"><span /></Freestyle><span /></div>", errors: [{ messageId: "raw" }] },
    ],
  }))
})

test("generated art and fractional steps inside Freestyle belong to the app", () => {
  assert.doesNotThrow(() => slotTester().run("generated-art-in-mascot-or-media-frame", generatedArtInMascotOrMediaFrame, {
    valid: [{ filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"brand art\"><img src=\"/images/hero.webp\" alt=\"\" /></Freestyle>" }],
    invalid: [{ filename: BLOCK, code: IMPORTS + "export const A = () => <img src=\"/images/hero.webp\" alt=\"\" />", errors: [{ messageId: "outside" }] }],
  }))
  assert.doesNotThrow(() => slotTester().run("no-fractional-step", noFractionalStep, {
    valid: [{ filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"art\"><div className=\"gap-1.5\" /></Freestyle>" }],
    invalid: [{ filename: BLOCK, code: IMPORTS + "export const A = () => <div className=\"gap-1.5\" />", errors: [{ messageId: "fractional" }] }],
  }))
})
