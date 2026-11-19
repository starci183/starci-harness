/**
 * Twin tests for the Fragment law and for the exemption every other Grammar rule gives a Fragment subtree.
 *
 *   node --test src/fragment.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { fragmentHasReason, recommended, rules as fragmentRules } from "./fragment.ts"
import { rules } from "./index.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import { Fragment, SurfaceCard } from \"@starci/grammar/core\"\n"
const rule = (name: string) => {
  const found = rules[name]
  assert.ok(found, `${name} is published`)
  return found
}

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(fragmentRules), ["fragment-has-reason"])
  assert.deepEqual(recommended, { "starci-grammar/fragment-has-reason": "error" })
})

test("a Fragment region names its reason", () => {
  slotTester().run("fragment-has-reason", fragmentHasReason, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Fragment reason=\"workflow graph\" />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Fragment reason={\"graph\"} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Fragment reason={`graph`} />" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Fragment {...p} />" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <Fragment />" },
      // React's Fragment needs no reason; the Grammar's, under an alias, does
      { filename: BLOCK, code: "import { Fragment } from \"react\"\nexport const A = () => <Fragment><span /></Fragment>" },
      { filename: BLOCK, code: "import { Fragment as GrammarFragment } from \"@starci/grammar/core\"\nexport const A = () => <GrammarFragment reason=\"graph\" />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Fragment />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Fragment reason=\"  \" />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Fragment reason={p.why} />", errors: [{ messageId: "reason" }] },
      { filename: BLOCK, code: "import { Fragment as GrammarFragment } from \"@starci/grammar/core\"\nexport const A = () => <GrammarFragment />", errors: [{ messageId: "reason" }] },
      // the law judges the element even inside another region
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Fragment reason=\"outer\"><Fragment /></Fragment>", errors: [{ messageId: "reason" }] },
    ],
  })
})

test("nothing inside Fragment is reported by a Grammar rule; outside it every rule stays", () => {
  assert.doesNotThrow(() => slotTester().run("no-raw-structural-element", rule("no-raw-structural-element"), {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Fragment reason=\"art\"><div><span /><ul /><table /></div></Fragment>" },
      { filename: BLOCK, code: IMPORTS + "import * as G from \"@starci/grammar/core\"\nexport const A = () => <G.Fragment reason=\"art\"><h1>t</h1></G.Fragment>" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <span />", errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><Fragment reason=\"art\"><span /></Fragment><span /></div>", errors: [{ messageId: "raw" }] },
      // React's Fragment and <> open no region
      { filename: BLOCK, code: "import { Fragment } from \"react\"\nexport const A = () => <Fragment><span /></Fragment>", errors: [{ messageId: "raw" }] },
      { filename: BLOCK, code: "export const A = () => <><span /></>", errors: [{ messageId: "raw" }] },
      // a component of the same name that the Grammar does not export opens no region
      { filename: BLOCK, code: "const Fragment = (p: { readonly children?: unknown }) => <>{p.children}</>\nexport const A = () => <Fragment><span /></Fragment>", errors: [{ messageId: "raw" }] },
    ],
  }))
})

test("the HeroUI import boundary: a primitive imported for Fragment alone is not judged", () => {
  assert.doesNotThrow(() => slotTester().run("vendor-primitive-has-named-owner", rule("vendor-primitive-has-named-owner"), {
    valid: [{ filename: BLOCK, code: IMPORTS + "import { Chip } from \"@heroui/react\"\nexport const A = () => <Fragment reason=\"vendor demo\"><Chip /></Fragment>" }],
    invalid: [{ filename: BLOCK, code: IMPORTS + "import { Chip } from \"@heroui/react\"\nexport const A = () => <><Chip /><Fragment reason=\"x\"><Chip /></Fragment></>", errors: [{ messageId: "owner" }] }],
  }))
})
