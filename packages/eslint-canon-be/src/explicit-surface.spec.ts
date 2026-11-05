/**
 * Twin tests for the explicit exported surface (R368): an exported declaration states its type, and the rule reports exactly the files the lint result
 * cache counts as open. The cases are the table the cache holds (packages/hfs/src/fixtures/explicit-surface-cases.json).
 */
// proves: HFS_EXPLICIT_EXPORT_SURFACE@lite HFS_EXPLICIT_EXPORT_SURFACE@full
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import ts from "typescript"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { declarationSurface } from "@starci/hfs/runtime/scripts/lib/declaration-surface.mjs"
import { recommended, rules } from "./explicit-surface.ts"
import { recommended as pluginRecommended, rules as pluginRules } from "./index.ts"

interface Case {
    readonly name: string
    readonly code: string
    readonly open: boolean
    readonly annotate: readonly string[]
}

const { cases } = JSON.parse(
    readFileSync(new URL("../../hfs/src/fixtures/explicit-surface-cases.json", import.meta.url), "utf8"),
) as { cases: readonly Case[] }

const languageOptions = { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } as const
const tester = canonRuleTester({ languageOptions })
const rule = rules["explicit-export-surface"]

test("R368: the rule is published at error", () => {
    assert.deepEqual(recommended, { "starci-be/explicit-export-surface": "error" })
    assert.equal(pluginRules["explicit-export-surface"], rule)
    assert.equal(pluginRecommended["starci-be/explicit-export-surface"], "error")
})

test("R368: the inferred exports are reported and the explicit ones pass", () => {
    assert.doesNotThrow(() => {
        tester.run("explicit-export-surface", rule, {
            valid: cases.filter((fixture) => !fixture.open).map((fixture) => ({ name: fixture.name, filename: "src/case.tsx", code: fixture.code })),
            invalid: cases
                .filter((fixture) => fixture.open)
                .map((fixture) => ({
                    name: fixture.name,
                    filename: "src/case.tsx",
                    code: fixture.code,
                    errors: fixture.annotate.map(() => ({ messageId: "inferred" })),
                })),
        })
    })
})

const lint = (code: string, filename: string): readonly Linter.LintMessage[] =>
    new Linter().verify(
        code,
        [{ files: ["**/*.{ts,tsx,mts,cts,mjs}"], languageOptions, plugins: { "starci-be": { rules } as never }, rules: { "starci-be/explicit-export-surface": "error" } }],
        { filename },
    )

for (const fixture of cases) {
    test(`R368 agrees with the cache classifier: ${fixture.name}`, () => {
        const classified = declarationSurface(ts, "src/case.tsx", fixture.code)
        assert.ok(classified, "the compiler has transpileDeclaration")
        const messages = lint(fixture.code, "src/case.tsx")
        assert.equal(messages.length > 0, classified.problems.length > 0, "a file is reported exactly when the cache counts it open")
        assert.equal(messages.length > 0, fixture.open)
        assert.equal(messages.length, classified.problems.length, "one report per problem")
        for (const [at, problem] of classified.problems.entries()) {
            const message = messages[at]
            assert.ok(message)
            assert.match(message.message, new RegExp(`^HFS_EXPLICIT_EXPORT_SURFACE: \`${problem.name}\``))
            assert.ok(message.message.includes(`Annotate the ${problem.annotate}.`), message.message)
            const before = fixture.code.slice(0, problem.start).split("\n")
            assert.deepEqual([message.line, message.column], [before.length, (before.at(-1) ?? "").length + 1])
        }
    })
}

test("R368: a message says what to write and never offers a fix that hides the type", () => {
    const [hook] = lint("export const useAvatar = () => useUpload()\n", "src/useAvatar.ts")
    assert.ok(hook)
    assert.match(hook.message, /Annotate the return type\. Write the return type after the parameter list/)
    assert.equal(hook.fix, undefined)
    assert.doesNotMatch(hook.message, /\bany\b/)
})

test("R368: declaration files and scripts are not judged", () => {
    assert.deepEqual(lint("export const a = make()\n", "src/a.d.ts"), [])
    assert.deepEqual(lint("export const a = make()\n", "src/a.mjs"), [])
})
