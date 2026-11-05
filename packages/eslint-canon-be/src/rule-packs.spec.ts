/**
 * The ESLint rules of an app's rule packs (hfs.json `rulePacks`, contexts/project/lint.md PROJECT-LINT-3): the canon factory loads them, so an app adds a
 * lint law without a local rule in its tool config, and a refused pack stops the lint run instead of being guessed around.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { TSESLint } from "@typescript-eslint/utils"
import tsParser from "@typescript-eslint/parser"
import { starciBePackagesConfig } from "./index.ts"
import { packagesHfsFromDeclaration } from "./lib/hfs.ts"
import { appDeclaration } from "../fixtures/app.ts"

const PACK = "@acme/hfs-rules"
const DECLARATION = appDeclaration("be", { apps: [{ name: "core", kind: "api" }] })
const RULE = `{ id: "ACME-PKG-1", code: "ACME_NO_TODO_EXPORT", severity: "error", spec: "rule.spec.mjs", doc: "https://example.invalid/acme-pkg-1",
  eslint: { name: "no-todo-export", sides: ["packages"], rule: { meta: { type: "problem", schema: [], messages: { todo: "an export named todo" } },
    create: (context) => ({ ExportNamedDeclaration(node) { if (node.declaration?.declarations?.[0]?.id?.name === "todo") context.report({ node, messageId: "todo" }) } }) } } }`

/** An app root that declares the pack `PACK` with `rules`, its root package and the package view of it. */
const appWith = (rules: string) => {
    const root = mkdtempSync(join(tmpdir(), "starci-be-rule-pack-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    write("hfs.json", JSON.stringify({ ...DECLARATION, rulePacks: [PACK] }))
    write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }))
    write("packages/agent-sdk/package.json", JSON.stringify({ name: "@fixture/agent-sdk", version: "0.1.0", private: true }))
    write("packages/agent-sdk/tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, jsx: "preserve" }, include: ["src"] }))
    write("packages/agent-sdk/src/index.ts", "export const sdk: number = 1\n")
    write(`node_modules/${PACK}/package.json`, JSON.stringify({ name: PACK, version: "1.0.0", type: "module", exports: { "./rule-pack": "./rule-pack.mjs", "./package.json": "./package.json" } }))
    write(`node_modules/${PACK}/rule-pack.mjs`, `export default { schema: "starci/rule-pack@1", name: "${PACK}", rules: [${rules}] }\n`)
    write(`node_modules/${PACK}/rule.spec.mjs`, "// proves ACME-PKG-1\n")
    return { root, hfs: packagesHfsFromDeclaration(DECLARATION, root), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("the packages config loads the pack's ESLint rule at its severity, and the rule judges the package code", async () => {
    const app = appWith(RULE)
    try {
        const config = await starciBePackagesConfig({ hfs: app.hfs })
        const block = config.find((entry) => entry.rules !== undefined && `${PACK}/no-todo-export` in entry.rules)
        assert.ok(block !== undefined, "the pack block is part of the config")
        assert.equal(block.rules?.[`${PACK}/no-todo-export`], "error")
        assert.deepEqual(block.files, ["packages/*/src/**/*.{ts,tsx,mts,cts}"])
        // The rule itself, judged on its own block (the typed blocks of the canon are proven by packages-config.spec.ts).
        const linter = new TSESLint.Linter({ cwd: app.root })
        const messages = linter.verify("export const todo: number = 1\n", [{ ...block, languageOptions: { parser: tsParser } }], { filename: join(app.root, "packages/agent-sdk/src/node/todo.ts") })
        assert.deepEqual(messages.map((message) => [message.ruleId, message.severity]), [[`${PACK}/no-todo-export`, 2]])
    } finally { app.cleanup() }
})

test("a pack that tries to turn a rule off is refused, and the factory throws instead of linting without the app's law", async () => {
    const app = appWith(RULE.replace('severity: "error"', 'severity: "error", off: ["starci-be/dead-exports"]'))
    try {
        await assert.rejects(starciBePackagesConfig({ hfs: app.hfs }), /HFS_RULE_PACK_INVALID: @acme\/hfs-rules rule 0 has off: a pack only adds rules/u)
    } finally { app.cleanup() }
})
