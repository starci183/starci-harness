// proves: HFS_FUNCTION_BUDGET@lite HFS_FUNCTION_BUDGET@full
import assert from "node:assert/strict"
import test from "node:test"
import { TSESLint } from "@typescript-eslint/utils"
import tsParser from "@typescript-eslint/parser"
import { appDeclaration } from "../fixtures/app.ts"
import { TYPED_ROOT } from "../fixtures/typed/tester.ts"
import { hfsFromDeclaration } from "./lib/hfs.ts"
import plugin, { lawOwners, recommended, ruleDeclarations, ruleOwners, rules as publishedRules } from "./index.ts"
import { functionLineBudget, rules } from "./function-budget.ts"
import { canonRuleTester } from "../fixtures/rule-tester.ts"

/** A real declared HFS edition; the common parameter is supplied until C08 updates the manifest. */
const fixtureHfs = (edition: "full" | "lite", max = 80) => {
    // the connection carries a provider, a field the fixture's declared connection shape does not list
    const primary = { name: "primary", envPrefix: "PRIMARY_DB", owner: "core", isolation: "schema", provider: "postgres" }
    const declaration = appDeclaration("be", {
        apps: [{ name: "core", kind: "api" }],
        connections: [primary],
    })
    const hfs = hfsFromDeclaration({ ...declaration, edition }, TYPED_ROOT)
    return { ...hfs, ruleParams: { ...hfs.ruleParams, functionLines: max } }
}

/** Exactly `count` physical body lines, with comments and blanks making up the interior. */
const body = (count: number, newline = "\n") => ["{", ...Array.from({ length: count - 2 }, (_, index) => index % 2 === 0 ? "// counted comment" : ""), "}"].join(newline)
const expression = (count: number) => ["[", ...Array(count - 2).fill("1,"), "]"].join("\n")
const error = (lines: number, max = 80) => ({ messageId: "lines", data: { lines, max } })
const languageOptions = { parser: tsParser, ecmaVersion: 2022, sourceType: "module" } as const

for (const edition of ["lite", "full"] as const) {
    test(`be ${edition}: HFS_FUNCTION_BUDGET accepts 80 body lines and refuses 81 across function forms`, () => {
        const hfs = fixtureHfs(edition)
        assert.equal(hfs.edition, edition)
        const tester = canonRuleTester({ languageOptions, settings: { starci: { hfs } } })
        tester.run("function-line-budget", functionLineBudget, {
            valid: [
                { code: `function work() ${body(80)}` },
                { code: `const work = function () ${body(80)}` },
                { code: `const work = () => ${body(80)}` },
                { code: `class Worker { work() ${body(80)} }` },
                { code: `const worker = { work() ${body(80)} }` },
                { code: `const work = () => ${expression(80)}` },
                { code: `const work = () => (\n${expression(78)}\n)` },
                { code: `function outer() {\nfunction inner() ${body(78)}\n}` },
                { code: `function work(\n${Array.from({ length: 90 }, (_, index) => `p${index}: number`).join(",\n")}\n) {}` },
                { code: `${Array(100).fill("// outside the body").join("\n")}\nfunction work() {}` },
                { code: Array.from({ length: 90 }, (_, index) => `function work${index}() {}`).join("\n") },
                { code: "declare function work(): void; interface Worker { work(): void }" },
            ],
            invalid: [
                { code: `function work() ${body(81)}`, errors: [error(81)] },
                { code: `const work = function () ${body(81)}`, errors: [error(81)] },
                { code: `const work = () => ${body(81)}`, errors: [error(81)] },
                { code: `class Worker { work() ${body(81)} }`, errors: [error(81)] },
                { code: `class Worker { constructor() ${body(81)} }`, errors: [error(81)] },
                { code: `class Worker { get value() ${body(81)} }`, errors: [error(81)] },
                { code: `class Worker { set value(value: number) ${body(81)} }`, errors: [error(81)] },
                { code: `const worker = { work() ${body(81)} }`, errors: [error(81)] },
                { code: `function* work() ${body(81)}`, errors: [error(81)] },
                { code: `const work = async () => ${body(81)}`, errors: [error(81)] },
                { code: `const work = () => ${expression(81)}`, errors: [error(81)] },
                { code: `const work = () => (\n${expression(79)}\n)`, errors: [error(81)] },
                { code: `const work = () => (\n${Array(79).fill("// counted comment").join("\n")}\n1)`, errors: [error(81)] },
                { code: `function work() ${body(81, "\r\n")}\r\n`, errors: [error(81)] },
                { code: `function outer() {\nconst inner = () => ${body(81)}\n}`, errors: [error(83), error(81)] },
                { filename: "work.spec.ts", code: `function work() ${body(81)}`, errors: [error(81)] },
            ],
        })
    })

    test(`be ${edition}: HFS_FUNCTION_BUDGET reads the common functionLines parameter`, () => {
      assert.doesNotThrow(() => {
          const tester = canonRuleTester({ languageOptions, settings: { starci: { hfs: fixtureHfs(edition, 3) } } })
          tester.run("function-line-budget", functionLineBudget, {
              valid: [{ code: `function work() ${body(3)}` }],
              invalid: [{ code: `function work() ${body(4)}`, errors: [error(4, 3)] }],
          })
      })
    })

    test(`be ${edition}: the append-only registration publishes and activates HFS_FUNCTION_BUDGET`, () => {
        assert.deepEqual(Object.keys(rules), ["function-line-budget"])
        assert.equal(plugin.rules["function-line-budget"], functionLineBudget)
        assert.equal(publishedRules["function-line-budget"], functionLineBudget)
        assert.equal(ruleOwners["function-line-budget"], "function-budget")
        assert.equal(lawOwners.filter((law) => law === "function-budget").length, 1)
        assert.deepEqual(ruleDeclarations.filter(({ name }) => name === "function-line-budget"), [{ law: "function-budget", name: "function-line-budget" }])
        assert.equal(recommended["starci-be/function-line-budget"], "error")
        // typescript-eslint's Linter is ESLint's own class under the types that accept the canon plugin
        const linter = new TSESLint.Linter()
        const messages = linter.verify(`function work() ${body(81)}`, [{
            languageOptions,
            settings: { starci: { hfs: fixtureHfs(edition) } },
            plugins: { "starci-be": plugin },
            rules: { "starci-be/function-line-budget": recommended["starci-be/function-line-budget"] },
        }])
        assert.equal(messages.length, 1)
        const [message] = messages
        assert.ok(message)
        assert.equal(message.ruleId, "starci-be/function-line-budget")
        assert.match(message.message, /HFS_FUNCTION_BUDGET/)
    })
}

test("be: the owner-decided cap remains active before C08 adds functionLines to the manifest", () => {
  assert.doesNotThrow(() => {
      const full = fixtureHfs("full")
      const { functionLines: _cap, ...ruleParams } = full.ruleParams
      const hfs = { ...full, ruleParams }
      const tester = canonRuleTester({ languageOptions, settings: { starci: { hfs } } })
      tester.run("function-line-budget", functionLineBudget, {
          valid: [{ code: `function work() ${body(80)}` }],
          invalid: [{ code: `function work() ${body(81)}`, errors: [error(81)] }],
      })
  })
})
