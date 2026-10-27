import assert from "node:assert/strict"
import test from "node:test"
import { FILES, lintRule, textAt } from "./testing.ts"

const rule = (code: string, file?: string) => lintRule("no-css-module", code, file)

test("refuses a *.module.css whatever it holds, including an empty one", async () => {
  for (const code of [".a { color: var(--accent); }", ":root { --row-index: 1; }", "/* nothing */"]) {
    const warnings = await rule(code, FILES.module)
    assert.equal(warnings.length, 1, code)
    assert.match(textAt(warnings, 0), /Card\.module\.css.*CSS modules are banned/)
  }
})

test("does not judge any other stylesheet", async () => {
  for (const file of [FILES.css, FILES.globals, FILES.brand]) assert.deepEqual(await rule(":root { --a: 1; }", file), [])
})
