/**
 * The lint rules of a project's extension (ext/manifest.json and ext/lint/, contexts/project/lint.md PROJECT-LINT-3): the canon factory loads them, so a
 * project adds a lint law without a local rule in its tool config, and a refused extension stops the lint run instead of being guessed around.
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

const DECLARATION = appDeclaration("be", { apps: [{ name: "core", kind: "api" }] })
const RULE = { id: "ACME-PKG-1", code: "ACME_NO_TODO_EXPORT", severity: "error", doc: "https://example.invalid/acme-pkg-1", appliesTo: ["packages/sdk/src/**/*.ts", "fe/src/**"], lint: { tool: "eslint", file: "no-todo-export.mjs" } }
const RULE_MODULE = `export default { meta: { type: "problem", schema: [], messages: { todo: "an export named todo" } },
  create: (context) => ({ ExportNamedDeclaration(node) { if (node.declaration?.declarations?.[0]?.id?.name === "todo") context.report({ node, messageId: "todo" }) } }) }
`

/** An app root whose ext/ declares `rule`, its root package and the package view of it. */
const appWith = (rule: Record<string, unknown>) => {
    const root = mkdtempSync(join(tmpdir(), "starci-be-project-ext-"))
    const write = (relative: string, text: string) => {
        mkdirSync(dirname(join(root, relative)), { recursive: true })
        writeFileSync(join(root, relative), text)
    }
    write("hfs.json", JSON.stringify(DECLARATION))
    write("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }))
    write("packages/sdk/package.json", JSON.stringify({ name: "@fixture/sdk", version: "0.1.0", private: true }))
    write("packages/sdk/tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, jsx: "preserve" }, include: ["src"] }))
    write("packages/sdk/src/index.ts", "export const sdk: number = 1\n")
    write("ext/manifest.json", JSON.stringify({ schema: "starci/project-ext@1", api: 1, rules: [rule] }))
    write("ext/lint/no-todo-export.mjs", RULE_MODULE)
    return { root, hfs: packagesHfsFromDeclaration(DECLARATION, root), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("the packages config loads the extension's lint rule at its severity over the package paths it names, and the rule judges the package code", async () => {
    const app = appWith(RULE)
    try {
        const config = await starciBePackagesConfig({ hfs: app.hfs })
        const block = config.find((entry) => entry.rules !== undefined && "project-ext/no-todo-export" in entry.rules)
        assert.ok(block !== undefined, "the extension's block is part of the config")
        assert.equal(block.rules?.["project-ext/no-todo-export"], "error")
        assert.deepEqual(block.files, ["packages/sdk/src/**/*.ts"], "only the globs below packages/: the fe glob belongs to the fe config")
        // The rule itself, judged on its own block (the typed blocks of the canon are proven by packages-config.spec.ts).
        const linter = new TSESLint.Linter({ cwd: app.root })
        const messages = linter.verify("export const todo: number = 1\n", [{ ...block, languageOptions: { parser: tsParser } }], { filename: join(app.root, "packages/sdk/src/node/todo.ts") })
        assert.deepEqual(messages.map((message) => [message.ruleId, message.severity]), [["project-ext/no-todo-export", 2]])
    } finally { app.cleanup() }
})

test("an extension that tries to turn a rule off is refused, and the factory throws instead of linting without the project's law", async () => {
    const app = appWith({ ...RULE, off: ["starci-be/dead-exports"] })
    try {
        await assert.rejects(starciBePackagesConfig({ hfs: app.hfs }), /HFS_EXT_INVALID: ext\/manifest\.json rule 0 has off: an extension only adds rules/u)
    } finally { app.cleanup() }
})
