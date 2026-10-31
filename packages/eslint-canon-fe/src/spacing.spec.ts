/** Spacing is the Grammar's: an app class string carries no padding, margin, gap or space utility (R350). */
// proves: FE_SPACING_UTILITY@lite FE_SPACING_UTILITY@full
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { COUNTING } from "./lib/config.ts"
import { baseUtility, noSpacingUtility, recommended, rules, spacingUtilities } from "./spacing.ts"

const tester = slotTester()
const BLOCK = at("apps/web/src/components/blocks/OfficeMessenger/index.tsx")
const CLASS_NAMES = at("apps/web/src/components/blocks/OfficeMessenger/classNames.ts")

test("every rule this law declares is exported under its published name, in the counting cohort", () => {
  for (const [name, rule] of Object.entries(rules)) assert.ok(rule.meta && rule.create, `${name} is not a rule`)
  assert.deepEqual(recommended, { "starci-fe/no-spacing-utility": "warn" })
  assert.deepEqual(COUNTING["starci-fe/no-spacing-utility"], { rule: "R350", ruling: "spacing-roles" })
})

test("a utility is read past its variants and importance, and only the spacing families count", () => {
  assert.equal(baseUtility("sm:hover:px-4"), "px-4")
  assert.equal(baseUtility("[&>*]:gap-2"), "gap-2")
  assert.equal(baseUtility("!p-3"), "p-3")
  assert.deepEqual(spacingUtilities("flex min-w-0 gap-3 sm:px-6 -mt-1 space-y-2 text-sm w-full shrink-0 inset-0"), ["gap-3", "sm:px-6", "-mt-1", "space-y-2"])
  assert.deepEqual(spacingUtilities("pointer-events-none max-w-4xl min-h-0 grid-cols-2 place-items-center"), [])
})

test("R350: an app writes no padding, margin, gap or space utility, arbitrary values included", () => {
  assert.doesNotThrow(() => tester.run("no-spacing-utility", noSpacingUtility, {
    valid: [
      { filename: BLOCK, code: "const C = \"flex min-w-0 flex-1 items-center\"" },
      { filename: CLASS_NAMES, code: "export const MEASURE_CLASS_NAME = \"max-w-4xl min-w-0\"" },
      { filename: BLOCK, code: "const View = () => <div className=\"grid grid-cols-2\" />" },
    ],
    invalid: [
      { filename: CLASS_NAMES, code: "export const LIST_HEAD_CLASS_NAME = \"shrink-0 px-4 pt-3 pb-2\"", errors: [{ messageId: "utility" }, { messageId: "utility" }, { messageId: "utility" }] },
      { filename: BLOCK, code: "const View = () => <div className=\"flex gap-4\" />", errors: [{ messageId: "utility", data: { cls: "gap-4", instead: "gap=\"section\" on the Stack or Cluster that holds these siblings" } }] },
      { filename: BLOCK, code: "const C = \"sm:px-6 gap-[13px]\"", errors: [{ messageId: "utility" }, { messageId: "utility" }] },
      { filename: CLASS_NAMES, code: "const C = { x: { classes: [\"flex\", \"-mt-1\", \"space-y-2\"] } }", errors: [{ messageId: "utility" }, { messageId: "utility" }] },
    ],
  }))
})
