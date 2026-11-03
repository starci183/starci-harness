/**
 * Twin tests for the module directive position (R369).
 *
 *   node --test src/directive-first.spec.ts
 */
// proves: FE_DIRECTIVE_FIRST@lite FE_DIRECTIVE_FIRST@full
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { RuleTester } from "eslint"
import { canonTester } from "../fixtures/typed/tester.ts"
import { why } from "./lib/why.ts"
import { directiveFirst, recommended } from "./directive-first.ts"

const tester = canonTester(new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } }))

test("R369: the rule carries its finding code and is published at error", () => {
  assert.equal(why["directive-first"].code, "FE_DIRECTIVE_FIRST")
  assert.deepEqual(recommended, { "starci-fe/directive-first": "error" })
})

test("R369: a directive is valid in the prologue and reported anywhere below a statement", () => {
  assert.doesNotThrow(() =>
    tester.run("directive-first", directiveFirst, {
      valid: [
        { code: '"use client"\nimport { a } from "./a"\nexport const b = a' },
        { code: "'use client'\n'use strict'\nexport const b = 1" },
        { code: '// header\n"use server"\nexport const b = 1' },
        { code: 'import { a } from "./a"\nexport const b = "use client" + a' },
        { code: 'export const f = () => { "use server" }' },
        { code: 'import { a } from "./a"\nexport const b = a\nconst note = "use client"' },
      ],
      invalid: [
        { code: 'import { a } from "./a"\n"use client"\nexport const b = a', errors: [{ messageId: "misplaced", data: { directive: "use client" } }] },
        { code: 'import { a } from "./a"\n;("use client")\nexport const b = a', errors: [{ messageId: "misplaced" }] },
        { code: 'export const b = 1\n"use server"', errors: [{ messageId: "misplaced", data: { directive: "use server" } }] },
      ],
    }),
  )
})
