import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { Linter } from "eslint"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import { render } from "../sync/index.mjs"

const linter = new Linter({ configType: "flat" })
// reason: the typescript-eslint plugin and parser declare their own flat-config types, which ESLint's Linter.Config does not accept.
const config = [{
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "@typescript-eslint/prefer-function-type": "error" },
}] as unknown as Linter.Config[]

for (const template of [
    "be/inbox/platform/inbox/inbox.port.ts.tpl",
    "be/patterns/idempotency/platform/inbox/inbox.port.ts.tpl",
]) {
    test(`${template} emits callable types without the S6598 smell`, () => {
        const source = readFileSync(new URL(`../templates/${template}`, import.meta.url), "utf8")
        const code = render(source, {})
        const messages = linter.verify(code, config, { filename: "src/modules/platform/inbox/inbox.port.ts" })
        assert.deepEqual(messages, [])
    })
}
