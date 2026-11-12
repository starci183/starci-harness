/**
 * The lint rules of a project's extension (ext/manifest.json and ext/lint/, contexts/project/lint.md PROJECT-LINT-3) on the front end: `starciFeConfig` loads
 * the rules whose appliesTo names paths of the fe side, at the rule's severity, so a project adds a lint law without a local rule in its tool config.
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

const FE = appDeclaration("fe", { apps: [{ name: "web", kind: "next" }] })
const RULE_MODULE = `export default { meta: { type: "problem", schema: [], messages: { no: "no default export" } }, create: (context) => ({ ExportDefaultDeclaration(node) { context.report({ node, messageId: "no" }) } }) }
`

test("starciFeConfig loads an extension rule over the fe paths it names, at its severity, and leaves a be-only rule out", () => {
    const root = mkdtempSync(join(tmpdir(), "starci-fe-project-ext-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    try {
        write("hfs.json", JSON.stringify(FE))
        write("package.json", JSON.stringify({ name: "fixture", private: true }))
        const rule = (id: string, file: string, appliesTo: string[], severity: string) => ({ id, code: `${id.replaceAll("-", "_")}_X`, severity, doc: `https://example.invalid/${id}`, appliesTo, lint: { tool: "eslint", file } })
        write("ext/manifest.json", JSON.stringify({ schema: "starci/project-ext@1", api: 1, rules: [rule("ACME-FE-1", "no-default-export.mjs", ["fe/apps/web/src/**/*.ts"], "warning"), rule("ACME-BE-1", "be-only.mjs", ["be/src/**"], "error")] }))
        write("ext/lint/no-default-export.mjs", RULE_MODULE)
        write("ext/lint/be-only.mjs", RULE_MODULE)
        mkdirSync(join(root, "fe"), { recursive: true })
        const config = starciFeConfig({ hfs: hfsFromDeclaration(FE, join(root, "fe")) })
        const blocks = config.filter((entry) => entry.rules !== undefined && Object.keys(entry.rules).some((name) => name.startsWith("project-ext/")))
        assert.deepEqual(blocks.map((block) => [block.files, block.rules]), [[["apps/web/src/**/*.ts"], { "project-ext/no-default-export": "warn" }]], "the be-only rule is not loaded on the fe side")
        const block = blocks[0]
        assert.ok(block !== undefined)
        const messages = new Linter({ cwd: join(root, "fe") }).verify("export default 1\n", [{ ...block, languageOptions: { parser: tsParser } }], { filename: join(root, "fe", "apps/web/src/a.ts") })
        assert.deepEqual(messages.map((message) => [message.ruleId, message.severity]), [["project-ext/no-default-export", 1]])
    } finally { rmSync(root, { recursive: true, force: true }) }
})
