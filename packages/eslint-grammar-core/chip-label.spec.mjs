/**
 * Twin tests for the chip label law (R322): the literal label of a `StatusDot` or a `Badge` starts uppercase.
 *
 *   node --test chip-label.spec.mjs
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../eslint-canon-fe/fixtures/typed/tester.mjs"
import { chipLabelStartsUppercase, recommended, rules, startsLowercase } from "./chip-label.mjs"

const BLOCK = at("apps/web/src/components/blocks/RunStatus/component.tsx")
const SCRIPT = at("scripts/build.tsx")

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["chip-label-starts-uppercase"])
  assert.deepEqual(recommended, { "starci-grammar/chip-label-starts-uppercase": "error" })
})

test("only a lowercase letter in first place is a finding", () => {
  for (const text of ["running", "  queued", "đang chạy", "échec"]) assert.equal(startsLowercase(text), true, text)
  for (const text of ["Running", "3 failed", "#12", "", "   ", "Đang chạy", "完了"]) assert.equal(startsLowercase(text), false, text)
})

test("R322: a StatusDot or Badge label written in lowercase is red and is fixed in place", () => {
  slotTester().run("chip-label-starts-uppercase", chipLabelStartsUppercase, {
    valid: [
      { filename: BLOCK, code: "export const A = () => <StatusDot tone=\"success\">Running</StatusDot>" },
      { filename: BLOCK, code: "export const A = () => <Badge isDot tone=\"danger\">Failed</Badge>" },
      { filename: BLOCK, code: "export const A = () => <Badge>{\"Queued\"}</Badge>" },
      { filename: BLOCK, code: "export const A = () => <Badge>{cond ? \"Live\" : `Idle`}</Badge>" },
      // a count or a symbol first is not a letter
      { filename: BLOCK, code: "export const A = () => <Badge>3 failed</Badge>" },
      // text the source cannot show is left alone
      { filename: BLOCK, code: "export const A = () => <StatusDot tone=\"warning\">{t(\"status.queued\")}</StatusDot>" },
      { filename: BLOCK, code: "export const A = () => <Badge>{count} failed</Badge>" },
      { filename: BLOCK, code: "export const A = () => <Badge>{`${n} left`}</Badge>" },
      // a dot-only StatusDot has no visible label
      { filename: BLOCK, code: "export const A = () => <StatusDot aria-label=\"alive\" echo />" },
      // another component's children are not a chip label
      { filename: BLOCK, code: "export const A = () => <Text>running</Text>" },
      // a script is not product source
      { filename: SCRIPT, code: "export const A = () => <Badge>running</Badge>" },
    ],
    invalid: [
      { filename: BLOCK, code: "export const A = () => <StatusDot tone=\"success\">running</StatusDot>", output: "export const A = () => <StatusDot tone=\"success\">Running</StatusDot>", errors: [{ messageId: "lowercase" }] },
      { filename: BLOCK, code: "export const A = () => <Badge isDot>\n  failed\n</Badge>", output: "export const A = () => <Badge isDot>\n  Failed\n</Badge>", errors: [{ messageId: "lowercase" }] },
      { filename: BLOCK, code: "export const A = () => <Badge>{\"queued\"}</Badge>", output: "export const A = () => <Badge>{\"Queued\"}</Badge>", errors: [{ messageId: "lowercase" }] },
      { filename: BLOCK, code: "export const A = () => <Badge>{cond ? \"live\" : `idle`}</Badge>", output: "export const A = () => <Badge>{cond ? \"Live\" : `Idle`}</Badge>", errors: [{ messageId: "lowercase" }, { messageId: "lowercase" }] },
      { filename: BLOCK, code: "export const A = () => <Grammar.StatusDot>đang chạy</Grammar.StatusDot>", output: "export const A = () => <Grammar.StatusDot>Đang chạy</Grammar.StatusDot>", errors: [{ messageId: "lowercase" }] },
    ],
  })
})
