/**
 * Twin tests for the type-scale rule.
 *
 *   node --test src/type-scale.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { noRawFont, rules } from "./type-scale.ts"

const tester = slotTester()
const BLOCK = at("apps/web/src/components/blocks/Feed/index.tsx")

test("every rule this law declares is a rule", () => {
  for (const [name, rule] of Object.entries(rules)) assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
})

test("TYPE-1: no raw font utility or inline font style", () => {
  assert.doesNotThrow(() => {
    tester.run("no-raw-font", noRawFont, {
      valid: [
        { filename: BLOCK, code: "const E = () => <div className=\"text-foreground text-center truncate line-clamp-2 p-4\" />" },
        { filename: BLOCK, code: "const E = () => <code className=\"font-mono\" />" },
        { filename: BLOCK, code: "const E = () => <Text>hello</Text>" },
        { filename: BLOCK, code: "const E = () => <div style={{ color: \"var(--foreground)\" }} />" },
        { filename: BLOCK, code: "const title = \"text-lg is a string outside a class list\"" },
      ],
      invalid: [
        { filename: BLOCK, code: "const E = () => <div className=\"p-4 text-lg\" />", errors: [{ messageId: "utility" }] },
        { filename: BLOCK, code: "const E = () => <div className=\"md:font-bold\" />", errors: [{ messageId: "utility" }] },
        { filename: BLOCK, code: "const E = () => <div className=\"text-[15px]\" />", errors: [{ messageId: "utility" }] },
        { filename: BLOCK, code: "const E = () => <div className={cn(\"flex\", \"uppercase\")} />", errors: [{ messageId: "utility" }] },
        { filename: BLOCK, code: "const E = () => <div style={{ fontWeight: 700 }} />", errors: [{ messageId: "style" }] },
        { filename: BLOCK, code: "const E = () => <div style={{ fontSize: \"1rem\", lineHeight: 1.5 }} />", errors: [{ messageId: "style" }, { messageId: "style" }] },
      ],
    })
  })
})
