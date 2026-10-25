/** Universal token discipline rejects authored values outside the vocabulary. */
// proves: FE_STYLE_TOKEN_ONLY@lite FE_STYLE_TOKEN_ONLY@full
import assert from "node:assert/strict"
import test from "node:test"
import { at, fixtureHfs, slotTester } from "./fixtures/typed/tester.mjs"
import { noArbitraryValue, rules } from "./tokens.mjs"

const tester = slotTester()
const LEAF = at("apps/web/src/components/leaves/Text/index.tsx")
const CLASS_NAMES = at("apps/web/src/components/leaves/Text/classNames.ts")

test("every rule this law declares is exported under its published name", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
  }
})

test("TOKEN-4: an arbitrary value escapes the vocabulary even when it matches it", () => {
  tester.run("no-arbitrary-value", noArbitraryValue, {
    valid: [
      { filename: LEAF, code: "const C = \"gap-4 p-6 text-muted\"" },
      // a variant selector is not a measurement
      { filename: LEAF, code: "const C = \"[&>*]:w-full\"" },
    ],
    invalid: [
      { filename: LEAF, code: "const C = \"gap-[13px]\"", errors: [{ messageId: "length" }] },
      { filename: LEAF, code: "const C = \"max-w-[42rem]\"", errors: [{ messageId: "length" }] },
      { filename: LEAF, code: "const C = \"text-[#ff0000]\"", errors: [{ messageId: "colour" }] },
      {
        filename: CLASS_NAMES,
        code: "const C = { x: { classes: [\"flex\", \"gap-[7px]\"] } }",
        errors: [{ messageId: "length" }],
      },
    ],
  })
})

for (const edition of ["lite", "full"]) {
  test(`FE_STYLE_TOKEN_ONLY ${edition}: accepts named tokens and refuses arbitrary lengths and colours`, () => {
    const hfs = fixtureHfs(undefined, { lite: edition === "lite" })
    assert.equal(hfs.edition, edition)
    const settings = { starci: { hfs } }
    tester.run("no-arbitrary-value", noArbitraryValue, {
      valid: [
        { filename: LEAF, settings, code: 'const classes = "gap-4 p-6 text-muted"' },
      ],
      invalid: [
        { filename: LEAF, settings, code: 'const classes = "gap-[13px]"', errors: [{ messageId: "length" }] },
        { filename: LEAF, settings, code: 'const classes = "text-[#ff0000]"', errors: [{ messageId: "colour" }] },
      ],
    })
  })
}
