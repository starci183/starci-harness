/**
 * Tests for the Sonar parity law (R235 SCAN_SMELL): the shared syntax rules, each against the code SonarCloud flagged in the examples.
 *
 *   node --test src/sonar-parity.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { SONAR_SYNTAX_RULES } from "../runtime/scripts/lib/sonar-syntax-rules.mjs"
import { recommended, rules } from "./sonar-parity.ts"
import { canonRuleTester, ruleNamed } from "../fixtures/rule-tester.ts"

const tester = canonRuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
})
const rule = (name: string) => ruleNamed(SONAR_SYNTAX_RULES, name)
const LOOP = "async function a(items) { for (const item of items) await send(item) }"

test("the law publishes each shared rule at error under its own name", () => {
  for (const [name, published] of Object.entries(rules)) {
    assert.ok(published?.meta && published.create, `${name} is not a rule`)
    assert.equal(recommended[`starci-be/${name}`], "error")
  }
  assert.ok(!("async-needs-await" in rules), "the async law owns async-needs-await")
  assert.ok(!("no-unused-prop-types" in rules), "props types are a front-end matter")
})

test("S9382: no await in a loop body, test or update; the iterable of for-of, a nested function and an endless loop are outside", () => {
  assert.doesNotThrow(() => { tester.run("no-await-in-loop", rule("no-await-in-loop"), {
    valid: [
      "async function a(items) { await Promise.all(items.map(async (item) => { await send(item) })) }",
      "async function b(source) { for (const x of await source()) use(x) }",
      "async function c(source) { for await (const chunk of source) use(chunk) }",
      "async function d(items) { for (const item of items) { const run = async () => { await send(item) }; later(run) } }",
      // an endless loop walks pages or polls: each turn needs the one before
      "async function e() { for (;;) { const page = await next(); if (!page) return } }",
      "async function f() { while (true) { await tick() } }",
    ],
    invalid: [
      { code: LOOP, errors: [{ messageId: "loop" }] },
      { code: "async function b() { while (await more()) { step() } }", errors: [{ messageId: "loop" }] },
      { code: "async function c() { for (let i = 0; i < 3; i = await next(i)) { step() } }", errors: [{ messageId: "loop" }] },
      { code: "async function d() { do { await tick() } while (open()) }", errors: [{ messageId: "loop" }] },
      { code: "async function e(o) { for (const k in o) { await send(k) } }", errors: [{ messageId: "loop" }] },
      { code: "async function f() { while (running) { await tick() } }", errors: [{ messageId: "loop" }] },
    ],
  }) })
})

test("a unit spec and an end-to-end spec are outside the scan, so outside the rules", () => {
  assert.doesNotThrow(() => { tester.run("no-await-in-loop", rule("no-await-in-loop"), {
    valid: [
      { filename: "src/a/a.spec.ts", code: LOOP },
      { filename: "src/a/a.e2e-spec.ts", code: LOOP },
    ],
    invalid: [
      { filename: "src/a/a.contract-spec.ts", code: LOOP, errors: [{ messageId: "loop" }] },
      { filename: "src/a/a.builder.ts", code: LOOP, errors: [{ messageId: "loop" }] },
    ],
  }) })
})

test("S7758: codePointAt and fromCodePoint instead of charCodeAt and fromCharCode", () => {
  assert.doesNotThrow(() => { tester.run("prefer-code-point", rule("prefer-code-point"), {
    valid: ["const a = char.codePointAt(0)", "const b = String.fromCodePoint(65)", "const c = other.fromCharCode(65)", "const d = text.charAt(0)"],
    invalid: [
      { code: "const a = char.charCodeAt(0)", errors: [{ messageId: "codePoint" }] },
      { code: "const b = String.fromCharCode(65)", errors: [{ messageId: "codePoint" }] },
    ],
  }) })
})

test("S7780: a string that only escapes backslashes is written with String.raw", () => {
  assert.doesNotThrow(() => { tester.run("prefer-string-raw", rule("prefer-string-raw"), {
    valid: [
      String.raw`const a = "no escapes"`,
      String.raw`const c = "tab\there"`,
      String.raw`const d = "a\\b\n"`,
      String.raw`const e = "ends\\"`,
      String.raw`import x from "a\\b"`,
      String.raw`export const config = { matcher: ["/((?!api|.*\\..*).*)"] }`,
      String.raw`const f = /a\\b/`,
      String.raw`const g = "has \\ and ${"`"}"`,
    ],
    invalid: [
      { code: String.raw`const a = "a\\dir\\file"`, errors: [{ messageId: "raw" }] },
      { code: String.raw`const b = '\\d+'`, errors: [{ messageId: "raw" }] },
    ],
  }) })
})

test("S3358: a conditional expression is not nested in another", () => {
  assert.doesNotThrow(() => { tester.run("no-nested-conditional", rule("no-nested-conditional"), {
    valid: ["const a = x ? 1 : 2", "const c = f(x ? 1 : 2, y ? 3 : 4)"],
    invalid: [
      { code: "const a = x ? 1 : y ? 2 : 3", errors: [{ messageId: "nested" }] },
      { code: "const b = x ? (y ? 1 : 2) : 3", errors: [{ messageId: "nested" }] },
      { code: "const c = (x ? 1 : 2) ? 3 : 4", errors: [{ messageId: "nested" }] },
      { code: "const d = x ? (y ? 1 : 2) === 1 : 0", errors: [{ messageId: "nested" }] },
    ],
  }) })
})

test("S3735: void is kept only on a call", () => {
  assert.doesNotThrow(() => { tester.run("no-void-operator", rule("no-void-operator"), {
    valid: ["void attempts.mutate()", "void send()", "void (await send())", "void a?.run()"],
    invalid: [
      { code: "void principal", errors: [{ messageId: "void" }] },
      { code: "const a = void 0", errors: [{ messageId: "void" }] },
    ],
  }) })
})

test("S1128: an import nothing reads is removed", () => {
  assert.doesNotThrow(() => { tester.run("no-unused-import", rule("no-unused-import"), {
    valid: [
      "import { a } from 'x'\nexport const b = a()",
      "import type { T } from 'x'\nexport const b: T = 1",
      "import 'side-effect'",
      "import { a } from 'x'\nexport { a }",
      "import * as ns from 'x'\nexport const b = ns.value",
    ],
    invalid: [
      { code: "import { Order, Handoff } from 'x'\nexport const b: Handoff = 1", errors: [{ messageId: "unused", data: { name: "Order" } }] },
      { code: "import a from 'x'", errors: [{ messageId: "unused" }] },
      { code: "import * as ns from 'x'", errors: [{ messageId: "unused" }] },
    ],
  }) })
})

test("S7763: an import that is only handed on is re-exported with export from", () => {
  assert.doesNotThrow(() => { tester.run("prefer-export-from", rule("prefer-export-from"), {
    valid: [
      "export { a } from 'x'",
      "import { a } from 'x'\nexport const b = a()\nexport { a }",
      "import { a } from 'x'\nexport const b = () => a",
      // an annotation changes the type, so the declaration is not a plain re-export
      "import { a } from 'x'\nexport const b: Wider = a",
      "export const c = 1",
      "const local = 1\nexport { local }",
    ],
    invalid: [
      { code: "import { a } from 'x'\nexport { a }", errors: [{ messageId: "reexport", data: { name: "a" } }] },
      { code: "import { appHomeMetadata } from 'x'\nexport const generateMetadata = appHomeMetadata", errors: [{ messageId: "reexport", data: { name: "appHomeMetadata" } }] },
      { code: "import a from 'x'\nexport default a", errors: [{ messageId: "reexport" }] },
    ],
  }) })
})

test("S107: at most seven parameters; the constructor of an injectable class is a dependency list and is spared", () => {
    const eight = "a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number"
    assert.doesNotThrow(() => { tester.run("max-params", ruleNamed(SONAR_SYNTAX_RULES, "max-params"), {
        valid: [
            "function seven(a, b, c, d, e, f, g) { return a }",
            `@Injectable() class Service { constructor(${eight}) {} }`,
            `@Component({ selector: "x" }) class Widget { constructor(${eight}) {} }`,
            { filename: "src/a.service.spec.ts", code: `function eight(${eight}) { return a }` },
        ],
        invalid: [
            { code: `function eight(${eight}) { return a }`, errors: [{ messageId: "many" }] },
            { code: `class Plain { constructor(${eight}) {} }`, errors: [{ messageId: "many" }] },
            { code: `@Injectable() class Service { run(${eight}) {} }`, errors: [{ messageId: "many" }] },
        ],
    }) })
})

test("scanner line breaks: a raw U+2028, U+2029 or U+0085 anywhere in a file is refused with the escape to write, specs included", () => {
  assert.doesNotThrow(() => { tester.run("no-line-separator-literal", ruleNamed(SONAR_SYNTAX_RULES, "no-line-separator-literal"), {
    valid: [
      "const separator = '\\u2028'\nconst paragraph = \"\\u2029\"",
      "// the escape \\u0085 written as text\nexport const a = 1",
    ],
    invalid: [
      { code: "const a = 'x\u2028y'", errors: [{ messageId: "raw", data: { code: "U+2028", name: "LINE SEPARATOR", escape: "\\u2028" }, line: 1, column: 13 }] },
      { code: "const b = `x\u2029y`", errors: [{ messageId: "raw", data: { code: "U+2029", name: "PARAGRAPH SEPARATOR", escape: "\\u2029" } }] },
      { code: "// note\u0085here\nexport const c = 1", errors: [{ messageId: "raw", data: { code: "U+0085", name: "NEXT LINE", escape: "\\u0085" } }] },
      { filename: "src/a.service.spec.ts", code: "/* a\u2028b */ export const d = 1", errors: [{ messageId: "raw" }] },
      { code: "const e = 'a\u2028b\u2028c'", errors: [{ messageId: "raw" }, { messageId: "raw" }] },
    ],
  }) })
})

test("the back end publishes the import and character rules and none of the React ones", () => {
  for (const name of ["no-duplicate-import", "no-bidirectional-character", "todo-tag"]) assert.ok(name in rules, `${name} is published`)
  for (const name of ["no-useless-fragment", "no-nested-component", "no-children-prop", "use-state-destructured", "prefer-tag-over-role"]) assert.ok(!(name in rules), `${name} is a front-end rule`)
})

test("S3358: a conditional is nested in a branch, a test, an argument, a template or a cast; an array, object or function starts a new reading", () => {
  assert.doesNotThrow(() => { tester.run("no-nested-conditional", rule("no-nested-conditional"), {
    valid: ["const a = x ? () => (y ? 1 : 2) : 3", "const b = x ? { c: y ? 1 : 2 } : 3", "const c = x ? [y ? 1 : 2] : 3", { filename: "src/a.spec.ts", code: "const e = x ? 1 : y ? 2 : 3" }],
    invalid: [
      { code: "const a = x ? foo(y ? 1 : 2) : 3", errors: [{ messageId: "nested" }] },
      { code: "const b = x ? `${y ? 1 : 2}` : 3", errors: [{ messageId: "nested" }] },
      { code: "const c = (x ? p : q) ? 2 : 3", errors: [{ messageId: "nested" }] },
      { code: "const d = x ? (y ? 1 : 2) as number : 3", errors: [{ messageId: "nested" }] },
      { code: "const e = x ? 1 : y ? 2 : 3", errors: [{ messageId: "nested" }] },
    ],
  }) })
})

test("S7780: a String.raw template with no backslash is a plain template", () => {
  assert.doesNotThrow(() => { tester.run("prefer-string-raw", rule("prefer-string-raw"), {
    valid: ["const a = String.raw`a\\b`", "const b = `plain ${x}`"],
    invalid: [{ code: "const a = String.raw`plain ${x} text`", output: "const a = `plain ${x} text`", errors: [{ messageId: "needless" }] }],
  }) })
})

test("S3863: one module is imported once, and --fix merges a value import and a type import", () => {
  assert.doesNotThrow(() => { tester.run("no-duplicate-import", rule("no-duplicate-import"), {
    valid: [
      "import { a } from 'x'\nimport { b } from 'y'",
      "import { a, type B } from 'x'",
      "import 'x'\nimport { a } from 'x'",
      { filename: "src/a.spec.ts", code: "import { a } from 'x'\nimport type { B } from 'x'" },
    ],
    invalid: [
      {
        code: "import { Logger } from '@modules/platform/logging'\nimport type { LogFields } from '@modules/platform/logging'\nexport const a = [Logger] as LogFields[]\n",
        output: "import { Logger, type LogFields } from '@modules/platform/logging'\nexport const a = [Logger] as LogFields[]\n",
        errors: [{ messageId: "duplicate" }],
      },
      { code: "import type { A } from 'x'\nimport type { B } from 'x'\nexport type C = A | B", output: "import type { A, B } from 'x'\nexport type C = A | B", errors: [{ messageId: "duplicate" }] },
      { code: "import * as x from 'x'\nimport { a } from 'x'\nexport const b = [x, a]", errors: [{ messageId: "duplicate" }] },
    ],
  }) })
})

test("text:S6389: a bidirectional control character is refused anywhere with its escape", () => {
  const controls = [0x202a, 0x202e, 0x2066, 0x2069].map((code) => String.fromCodePoint(code))
  assert.doesNotThrow(() => { tester.run("no-bidirectional-character", rule("no-bidirectional-character"), {
    valid: ["const a = '\\u202E'", "// the escape \\u2066 written as text\nexport const b = 1"],
    invalid: [
      ...controls.map((control) => ({ code: `const a = 'x${control}y'`, errors: [{ messageId: "raw" }] })),
      { filename: "src/a.service.spec.ts", code: `/* ${String.fromCodePoint(0x202e)} */ export const d = 1`, errors: [{ messageId: "raw" }] },
    ],
  }) })
})

test("S3863: a merged import longer than the print width is laid out one specifier a line", () => {
  assert.doesNotThrow(() => { tester.run("no-duplicate-import", rule("no-duplicate-import"), { valid: [], invalid: [{ code: "import { SpecifierNumber1Long, SpecifierNumber2Long, SpecifierNumber3Long, SpecifierNumber4Long, SpecifierNumber5Long, SpecifierNumber6Long } from \"@modules/platform/logging\"\nimport type { SpecifierNumber7Long, SpecifierNumber8Long, SpecifierNumber9Long, SpecifierNumber10Long, SpecifierNumber11Long, SpecifierNumber12Long } from \"@modules/platform/logging\"\nexport const a = 1\n", output: "import {\n    SpecifierNumber1Long,\n    SpecifierNumber2Long,\n    SpecifierNumber3Long,\n    SpecifierNumber4Long,\n    SpecifierNumber5Long,\n    SpecifierNumber6Long,\n    type SpecifierNumber7Long,\n    type SpecifierNumber8Long,\n    type SpecifierNumber9Long,\n    type SpecifierNumber10Long,\n    type SpecifierNumber11Long,\n    type SpecifierNumber12Long,\n} from \"@modules/platform/logging\"\nexport const a = 1\n", errors: [{ messageId: "duplicate" }] }] }) })
})

test("S1135: a leftover TODO marker is refused; the word as a noun of prose or a name is not a marker", () => {
  assert.doesNotThrow(() => { tester.run("todo-tag", rule("todo-tag"), {
    valid: ["/** The kinds of line a todo can be, each a key of the `guide.todo` catalog. */\nexport const a = 1", "// TODO PROJ-12 tracked\nexport const a = 1"],
    invalid: [{ code: "// TODO: later\nexport const a = 1", errors: [{ messageId: "todo" }] }, { code: "// todo(cuong) later\nexport const a = 1", errors: [{ messageId: "todo" }] }],
  }) })
})
