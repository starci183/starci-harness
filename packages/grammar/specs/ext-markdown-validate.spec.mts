import assert from "node:assert/strict"
import fs from "node:fs"
import { describe, it } from "node:test"
import { PROFILE_NAMES, PROFILES } from "../src/core/ext/markdown/profiles.ts"
import type { Issue } from "../src/core/ext/markdown/types.ts"
import { isValid, validate } from "../src/core/ext/markdown/validate.ts"

const codes = (issues: readonly Issue[]): string[] => issues.map((one) => one.code)
const errors = (issues: readonly Issue[]): string[] => issues.filter((one) => one.severity === "error").map((one) => one.code)

const CODE = "```ts\nconst a = 1\n```"
const DIFF = "```diff\n-a\n+b\n```"
const TERMINAL = "```terminal\n✓ ok\n```"
const COMPARE = ":::compare\n```\na\n```\n```\nb\n```\n:::"

describe("profiles are allow-lists", () => {
    it("names four profiles, prose allowing every block", () => {
        assert.deepEqual(PROFILE_NAMES, ["prose", "stem", "option", "report"])
        assert.equal(PROFILES.prose.blocks.length, 14)
    })

    it("prose takes everything", () => {
        const all = ["# T", "text `name`", CODE, DIFF, TERMINAL, COMPARE, ':::info\nx\n:::', '```mermaid caption="Figure 1: a"\nflowchart LR\nA-->B\n```', "| a |\n|---|\n| 1 |", "- x", "> q"].join("\n\n")
        assert.deepEqual(validate(all, "prose"), [])
    })

    it("stem: text, inline code and ONE code block", () => {
        assert.deepEqual(validate(`What does \`retry\` do?\n\n${CODE}`, "stem"), [])
        assert.deepEqual(errors(validate(`${CODE}\n\n${CODE}`, "stem")), ["MD_TOO_MANY"])
        assert.deepEqual(errors(validate(DIFF, "stem")), ["MD_NOT_ALLOWED"])
        assert.deepEqual(errors(validate("# heading", "stem")), ["MD_NOT_ALLOWED"])
        assert.deepEqual(errors(validate("[a](https://starci.dev)", "stem")), ["MD_NOT_ALLOWED"])
    })

    it("option: text, inline code and a diff", () => {
        assert.deepEqual(validate(`Change \`ttl\`:\n\n${DIFF}`, "option"), [])
        assert.deepEqual(errors(validate(CODE, "option")), ["MD_NOT_ALLOWED"])
        assert.deepEqual(errors(validate(`${DIFF}\n\n${DIFF}`, "option")), ["MD_TOO_MANY"])
    })

    it("report: terminal, compare and code", () => {
        assert.deepEqual(validate([TERMINAL, COMPARE, CODE, "Why does it fail?"].join("\n\n"), "report"), [])
        assert.deepEqual(errors(validate(":::tip\nx\n:::", "report")), ["MD_NOT_ALLOWED"])
    })
})

describe("validate", () => {
    it("a mermaid figure needs its caption", () => {
        assert.deepEqual(errors(validate("```mermaid\nflowchart LR\nA-->B\n```")), ["MD_MERMAID_CAPTION_MISSING"])
    })

    it("inline code longer than a name is a warning, so the text stays valid", () => {
        const issues = validate("Run `backend/0-typescript/src/modules/orders/outbox.relay.ts` now")
        assert.deepEqual(codes(issues), ["MD_INLINE_CODE_TOO_LONG"])
        assert.equal(issues[0]?.line, 1)
        assert.equal(isValid(issues), true)
    })

    it("carries the parse issues, sorted by line, and defaults to prose", () => {
        const issues = validate("ok\n\n<div>x</div>\n\n```mermaid\nA\n```")
        assert.deepEqual(codes(issues), ["MD_RAW_HTML", "MD_MERMAID_CAPTION_MISSING"])
        assert.deepEqual(issues.map((one) => one.line), [3, 5])
        assert.equal(isValid(issues), false)
    })

    it("judges nested content: a callout inside an accordion panel", () => {
        assert.deepEqual(errors(validate(':::::panel{title="A"}\n:::info\n```mermaid\nA\n```\n:::\n:::::')), ["MD_MERMAID_CAPTION_MISSING"])
    })

    it("a document in the legacy directive format is valid prose (a long inline path is only a warning)", () => {
        const issues = validate(fs.readFileSync(new URL("./fixtures/ext-markdown/legacy-format.md", import.meta.url), "utf8"), "prose", { legacyCaption: /^Figure \d+:/ })
        assert.deepEqual(errors(issues), [])
        assert.deepEqual(codes(issues), ["MD_INLINE_CODE_TOO_LONG"])
    })
})
