/**
 * The ESLint rules of an app's rule packs (hfs.json `rulePacks`, contexts/project/lint.md PROJECT-LINT-3) on the front end: `starciFeConfig` loads the rules a
 * pack names for the fe side, at the pack's severity, so an app adds a lint law without a local rule in its tool config.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Linter } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { starciFeConfig } from "./index.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import { appDeclaration } from "../../eslint-canon-be/fixtures/app.ts"

const PACK = "@acme/hfs-rules"
const FE = appDeclaration("fe", { apps: [{ name: "web", kind: "next" }] })

test("starciFeConfig loads a pack's fe rule at its severity and leaves a be-only rule out", () => {
    const root = mkdtempSync(join(tmpdir(), "starci-fe-rule-pack-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    try {
        write("hfs.json", JSON.stringify({ ...FE, rulePacks: [PACK] }))
        write("package.json", JSON.stringify({ name: "fixture", private: true }))
        write(`node_modules/${PACK}/package.json`, JSON.stringify({ name: PACK, version: "1.0.0", type: "module", exports: { "./rule-pack": "./rule-pack.mjs", "./package.json": "./package.json" } }))
        write(`node_modules/${PACK}/rule.spec.mjs`, "// proves the pack rules\n")
        const rule = (id: string, name: string, sides: string, severity: string) => `{ id: "${id}", code: "${id.replaceAll("-", "_")}_X", severity: "${severity}", spec: "rule.spec.mjs", doc: "https://example.invalid/${id}",
          eslint: { name: "${name}", sides: [${sides}], rule: { meta: { type: "problem", schema: [], messages: { no: "no default export" } }, create: (context) => ({ ExportDefaultDeclaration(node) { context.report({ node, messageId: "no" }) } }) } } }`
        write(`node_modules/${PACK}/rule-pack.mjs`, `export default { schema: "starci/rule-pack@1", name: "${PACK}", rules: [${rule("ACME-FE-1", "no-default-export", '"fe"', "warning")}, ${rule("ACME-BE-1", "be-only", '"be"', "error")}] }\n`)
        mkdirSync(join(root, "fe"), { recursive: true })
        const config = starciFeConfig({ hfs: hfsFromDeclaration(FE, join(root, "fe")) })
        const block = config.find((entry) => entry.rules !== undefined && `${PACK}/no-default-export` in entry.rules)
        assert.ok(block !== undefined, "the pack block is part of the fe config")
        assert.deepEqual(block.rules, { [`${PACK}/no-default-export`]: "warn" }, "the be-only rule is not loaded on the fe side")
        const messages = new Linter({ cwd: join(root, "fe") }).verify("export default 1\n", [{ ...block, languageOptions: { parser: tsParser } }], { filename: join(root, "fe", "apps/web/src/a.ts") })
        assert.deepEqual(messages.map((message) => [message.ruleId, message.severity]), [[`${PACK}/no-default-export`, 1]])
    } finally { rmSync(root, { recursive: true, force: true }) }
})
