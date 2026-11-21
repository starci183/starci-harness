/**
 * Twin tests for the type-roles law (TYPE-ROLES): app type is a Grammar role, never a raw size.
 *
 *   node --test src/no-raw-type-size.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noRawTypeSize, recommended, rules } from "./no-raw-type-size.ts"

const BLOCK = at("apps/web/src/components/blocks/Overview/component.tsx")
const BRAND = at("apps/web/src/modules/brand/tokens.ts")
const SCRIPT = at("scripts/render.tsx")
const GRAMMAR = at("node_modules/@starci/grammar/src/core/leaf/Text/index.tsx")
const code = (body: string): string => `export const A = () => ${body}`

test("the law publishes one rule and it is a counting warning", () => {
  assert.deepEqual(Object.keys(rules), ["no-raw-type-size"])
  assert.deepEqual(recommended, { "starci-grammar/no-raw-type-size": "warn" })
})

test("TYPE-ROLES: a text-size utility, a fontSize or a CSS font-size in app source is reported", () => {
  slotTester().run("no-raw-type-size", noRawTypeSize, {
    valid: [
      { filename: BLOCK, code: code("<span className=\"starci-type-label-item text-muted\" />") },
      { filename: BLOCK, code: code("<span className=\"text-[var(--accent)] text-success-soft-foreground\" />") },
      { filename: BLOCK, code: code("<span className=\"text-smart\" />") },
      { filename: BLOCK, code: "const style = { color: \"red\", lineHeight: 1 }; export const A = () => <div style={style} />" },
      { filename: BRAND, code: "export const scale = { fontSize: \"0.875rem\" }; export const sm = \"text-sm\"" },
      { filename: SCRIPT, code: code("<div className=\"text-sm\" style={{ fontSize: 12 }} />") },
      { filename: GRAMMAR, code: code("<div className=\"text-sm\" style={{ fontSize: 12 }} />") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<span className=\"font-medium text-sm\" />"), errors: [{ messageId: "utility", data: { token: "text-sm" } }] },
      { filename: BLOCK, code: code("<span className=\"md:text-2xl\" />"), errors: [{ messageId: "utility" }] },
      { filename: BLOCK, code: code("<span className={cn(\"flex\", big && \"text-base/6\")} />"), errors: [{ messageId: "utility" }] },
      { filename: BLOCK, code: code("<span className=\"text-[13px]\" />"), errors: [{ messageId: "utility" }] },
      { filename: BLOCK, code: code("<span className={`p-2 text-xs`} />"), errors: [{ messageId: "utility" }] },
      { filename: BLOCK, code: "const LABEL = \"text-lg text-muted\"; export const A = () => <span className={LABEL} />", errors: [{ messageId: "utility" }] },
      { filename: BLOCK, code: code("<div style={{ fontSize: 12 }} />"), errors: [{ messageId: "fontSize" }] },
      { filename: BLOCK, code: code("<text fontSize={12} />"), errors: [{ messageId: "fontSize" }] },
      { filename: BLOCK, code: "const css = `.note { font-size: 12px; }`; export const A = () => <style>{css}</style>", errors: [{ messageId: "css" }] },
    ],
  })
})
