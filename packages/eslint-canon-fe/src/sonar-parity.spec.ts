/**
 * Tests for the Sonar parity law (R235 SCAN_SMELL) on the front end: the rule only this axis publishes, and the registration of the shared ones.
 *
 *   node --test src/sonar-parity.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { SONAR_SYNTAX_RULES } from "#runtime/scripts/lib/sonar-syntax-rules.mjs"
import { canonTester } from "../fixtures/typed/tester.ts"
import type { Rule } from "./lib/rule.ts"
import { recommended, rules } from "./sonar-parity.ts"

const tester = canonTester(new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
}))

test("the law publishes the shared rules at error under their own names", () => {
  for (const [name, rule] of Object.entries(rules)) {
    assert.equal(rule, SONAR_SYNTAX_RULES[name])
    assert.equal(recommended[`starci-fe/${name}`], "error")
  }
  assert.ok(!("async-needs-await" in rules), "S7503 is the borrowed typescript-eslint rule")
  assert.ok("no-unused-prop-types" in rules)
})

const rule = (name: string): Rule => {
  const found = SONAR_SYNTAX_RULES[name]
  if (found === undefined) throw new Error(`the runtime Sonar syntax rules publish no ${name}`)
  return found
}
const LOOP = "async function a(items) { for (const item of items) await send(item) }"

test("S9382: no await in a loop; an endless loop and a spec are outside", () => {
  assert.doesNotThrow(() => tester.run("no-await-in-loop", rule("no-await-in-loop"), {
    valid: ["async function a(items) { await Promise.all(items.map((item) => send(item))) }", "async function b() { for (;;) { await tick() } }", { filename: "src/a.spec.tsx", code: LOOP }],
    invalid: [{ code: LOOP, errors: [{ messageId: "loop" }] }],
  }))
})

test("S7758: codePointAt instead of charCodeAt", () => {
  assert.doesNotThrow(() => tester.run("prefer-code-point", rule("prefer-code-point"), {
    valid: ["const a = char.codePointAt(0)"],
    invalid: [{ code: "const a = char.charCodeAt(0)", errors: [{ messageId: "codePoint" }] }],
  }))
})

test("S7780: a string that only escapes backslashes is written with String.raw; a Next matcher keeps its escapes", () => {
  assert.doesNotThrow(() => tester.run("prefer-string-raw", rule("prefer-string-raw"), {
    valid: [String.raw`const a = "no escapes"`, String.raw`export const config = { matcher: ["/((?!api|.*\\..*).*)"] }`],
    invalid: [{ code: String.raw`const a = "a\\dir\\file"`, errors: [{ messageId: "raw" }] }],
  }))
})

test("S3358: a conditional expression is not nested in another", () => {
  assert.doesNotThrow(() => tester.run("no-nested-conditional", rule("no-nested-conditional"), {
    valid: ["const a = x ? 1 : 2"],
    invalid: [{ code: "const a = x ? 1 : y ? 2 : 3", errors: [{ messageId: "nested" }] }],
  }))
})

test("S3735: void is kept only on a call", () => {
  assert.doesNotThrow(() => tester.run("no-void-operator", rule("no-void-operator"), {
    valid: ["void attempts.mutate()"],
    invalid: [{ code: "void principal", errors: [{ messageId: "void" }] }],
  }))
})

test("S1128: an import nothing reads is removed", () => {
  assert.doesNotThrow(() => tester.run("no-unused-import", rule("no-unused-import"), {
    valid: ["import { a } from 'x'\nexport const b = a()", "import type { T } from 'x'\nexport const b: T = 1"],
    invalid: [{ code: "import { Order, Handoff } from 'x'\nexport const b: Handoff = 1", errors: [{ messageId: "unused", data: { name: "Order" } }] }],
  }))
})

test("S7763: an import that is only handed on is re-exported with export from", () => {
  assert.doesNotThrow(() => tester.run("prefer-export-from", rule("prefer-export-from"), {
    valid: ["export { a } from 'x'", "import { a } from 'x'\nexport const b = a()\nexport { a }"],
    invalid: [{ code: "import { appHomeMetadata } from 'x'\nexport const generateMetadata = appHomeMetadata", errors: [{ messageId: "reexport" }] }],
  }))
})

test("S6767: a member of the props type that the component never reads is removed", () => {
  assert.doesNotThrow(() => tester.run("no-unused-prop-types", rule("no-unused-prop-types"), {
    valid: [
      // every member is read, through the parameter or through a destructuring
      "type Props = { readonly title: string; readonly on: { go: () => void } }\nconst Block = (props: Props) => <h1 onClick={props.on.go}>{props.title}</h1>",
      "type Props = { readonly title: string; readonly note: string }\nconst Block = ({ title, note }: Props) => <h1 title={note}>{title}</h1>",
      "interface Props { readonly title: string }\nconst Block = (props: Props) => { const { title } = props; return <h1>{title}</h1> }",
      // the parameter escapes whole, or is rest-destructured: every member counts as read
      "type Props = { readonly a: string; readonly b: string }\nconst Block = (props: Props) => <Inner {...props} />",
      "type Props = { readonly a: string; readonly b: string }\nconst Block = ({ a, ...rest }: Props) => <Inner a={a} {...rest} />",
      // a type declared elsewhere cannot be seen, and a function without JSX is not a component
      "const Block = (props: Props) => <h1>{props.title}</h1>",
      "type Props = { readonly unused: string }\nconst helper = (props: Props) => 1",
    ],
    invalid: [
      {
        code: "type Props = { readonly state: 'list'; readonly props: { title: string } }\nconst Block = (props: Props) => <h1>{props.props.title}</h1>",
        errors: [{ messageId: "unused", data: { name: "state" } }],
      },
      {
        code: "type Props = { readonly title: string; readonly note: string }\nconst Block = ({ title }: Props) => <h1>{title}</h1>",
        errors: [{ messageId: "unused", data: { name: "note" } }],
      },
      {
        code: "interface Props { readonly title: string; readonly note: string }\nfunction Block(props: Readonly<Props>) { return <h1>{props.title}</h1> }",
        errors: [{ messageId: "unused", data: { name: "note" } }],
      },
    ],
  }))
})

test("S4084: a video or audio element carries a captions track or is muted", () => {
  assert.doesNotThrow(() => tester.run("media-has-caption", rule("media-has-caption"), {
    valid: [
      'const A = () => <video src="a.mp4"><track kind="captions" src="a.vtt" /></video>',
      'const B = () => <video src="loop.mp4" muted autoPlay />',
      'const C = () => <Video src="a.mp4" />',
      { filename: "src/a.spec.tsx", code: 'const D = () => <audio src="a.mp3" />' },
    ],
    invalid: [
      { code: 'const E = () => <video src="a.mp4" />', errors: [{ messageId: "caption" }] },
      { code: 'const F = () => <audio src="a.mp3"><track kind="subtitles" src="a.vtt" /></audio>', errors: [{ messageId: "caption" }] },
    ],
  }))
})

test("scanner line breaks: a raw U+2028, U+2029 or U+0085 anywhere in a file is refused with the escape to write, specs included", () => {
  assert.doesNotThrow(() => { tester.run("no-line-separator-literal", rule("no-line-separator-literal"), {
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

test("S3358: a conditional is nested in a branch, a test, an argument, a template or a cast; an array, object, function or JSX expression starts a new reading", () => {
  assert.doesNotThrow(() => tester.run("no-nested-conditional", rule("no-nested-conditional"), {
    valid: [
      "const a = x ? () => (y ? 1 : 2) : 3",
      "const b = x ? { c: y ? 1 : 2 } : 3",
      "const c = x ? [y ? 1 : 2] : 3",
      "const d = x ? <div>{y ? 1 : 2}</div> : null",
      { filename: "src/a.spec.tsx", code: "const e = x ? 1 : y ? 2 : 3" },
    ],
    invalid: [
      { code: "const a = x ? foo(y ? 1 : 2) : 3", errors: [{ messageId: "nested" }] },
      { code: "const b = x ? `${y ? 1 : 2}` : 3", errors: [{ messageId: "nested" }] },
      { code: "const c = (x ? p : q) ? 2 : 3", errors: [{ messageId: "nested" }] },
      { code: "const d = x ? (y ? 1 : 2) as number : 3", errors: [{ messageId: "nested" }] },
      { code: "const e = x ? 1 : y ? 2 : z ? 3 : 4", errors: [{ messageId: "nested" }, { messageId: "nested" }] },
    ],
  }))
})

test("S7780: a String.raw template with no backslash is a plain template", () => {
  assert.doesNotThrow(() => tester.run("prefer-string-raw", rule("prefer-string-raw"), {
    valid: ["const a = String.raw`a\\b`", "const b = `plain ${x}`"],
    invalid: [
      { code: "const a = String.raw`plain ${x} text`", output: "const a = `plain ${x} text`", errors: [{ messageId: "needless" }] },
      { code: "const b = String.raw`one`", output: "const b = `one`", errors: [{ messageId: "needless" }] },
    ],
  }))
})

test("S3863: one module is imported once, and --fix merges a value import and a type import", () => {
  assert.doesNotThrow(() => tester.run("no-duplicate-import", rule("no-duplicate-import"), {
    valid: [
      "import { a } from 'x'\nimport { b } from 'y'",
      "import { a, type B } from 'x'",
      "import 'x'\nimport { a } from 'x'",
      "import { a } from 'x' with { type: 'json' }\nimport { b } from 'x'",
      { filename: "src/a.spec.ts", code: "import { a } from 'x'\nimport type { B } from 'x'" },
    ],
    invalid: [
      {
        code: "import { gql } from '@apollo/client'\nimport type { TypedDocumentNode } from '@apollo/client'\nexport const q = gql``\n",
        output: "import { gql, type TypedDocumentNode } from '@apollo/client'\nexport const q = gql``\n",
        errors: [{ messageId: "duplicate" }],
      },
      { code: "import type { A } from 'x'\nimport type { B } from 'x'\nexport type C = A | B", output: "import type { A, B } from 'x'\nexport type C = A | B", errors: [{ messageId: "duplicate" }] },
      { code: "import a from 'x'\nimport { b } from 'x'\nimport type { C } from 'x'\nexport default [a, b] as C[]", output: "import a, { b, type C } from 'x'\nexport default [a, b] as C[]", errors: [{ messageId: "duplicate" }, { messageId: "duplicate" }] },
      { code: "import { a } from 'x';\nimport { b as c } from 'x';\nexport const d = a + c", output: "import { a, b as c } from 'x';\nexport const d = a + c", errors: [{ messageId: "duplicate" }] },
      // a namespace import cannot be merged: reported, left for the author
      { code: "import * as x from 'x'\nimport { a } from 'x'\nexport const b = [x, a]", errors: [{ messageId: "duplicate" }] },
      // a type-only default import cannot be written inline
      { code: "import type D from 'x'\nimport { a } from 'x'\nexport const b = [a] as D[]", errors: [{ messageId: "duplicate" }] },
    ],
  }))
})

test("S6749: a fragment around nothing or one child is removed; a keyed or multi-child fragment stays", () => {
  assert.doesNotThrow(() => tester.run("no-useless-fragment", rule("no-useless-fragment"), {
    valid: [
      "const a = () => <><b /><c /></>",
      "const b = () => <Fragment key={1}><a /></Fragment>",
      "const c = () => <>text</>",
      "const d = () => <><a />text</>",
      { filename: "src/a.spec.tsx", code: "const e = () => <><a /></>" },
    ],
    invalid: [
      { code: "const a = () => <><b /></>", output: "const a = () => <b />", errors: [{ messageId: "single" }] },
      { code: "const a = () => <div><><b /></></div>", output: "const a = () => <div><b /></div>", errors: [{ messageId: "single" }] },
      { code: "const a = () => <React.Fragment><b /></React.Fragment>", output: "const a = () => <b />", errors: [{ messageId: "single" }] },
      { code: "const a = () => <>{value}</>", errors: [{ messageId: "single" }] },
      { code: "const a = () => <div><>text</></div>", errors: [{ messageId: "single" }] },
      { code: "const a = () => <></>", errors: [{ messageId: "empty" }] },
    ],
  }))
})

test("S6478: a component declared inside a component is a new type on every render", () => {
  assert.doesNotThrow(() => tester.run("no-nested-component", rule("no-nested-component"), {
    valid: [
      "const Row = () => <tr />\nconst Table = () => <table><Row /></table>",
      "const Table = () => { const renderRow = () => <tr />; return <table>{renderRow()}</table> }",
      "const Table = () => { const Helper = () => 1; return <table>{Helper()}</table> }",
      "const withAuth = (C) => function Wrapped(props) { return <C {...props} /> }",
      { filename: "src/a.spec.tsx", code: "const Table = () => { const Row = () => <tr />; return <table><Row /></table> }" },
    ],
    invalid: [
      { code: "const Table = () => { const Row = () => <tr />; return <table><Row /></table> }", errors: [{ messageId: "nested", data: { name: "Row", outer: "Table" } }] },
      { code: "function Table() { function Row() { return <tr /> } return <table><Row /></table> }", errors: [{ messageId: "nested", data: { name: "Row", outer: "Table" } }] },
      { code: "const Table = memo(() => { const Row = forwardRef(() => <tr />); return <table><Row /></table> })", errors: [{ messageId: "nested" }] },
    ],
  }))
})

test("S6748: children are nested between the tags, and a slot passed to a pure component has a name of its own", () => {
  assert.doesNotThrow(() => tester.run("no-children-prop", rule("no-children-prop"), {
    valid: [
      "const a = () => <Card>body</Card>",
      "const b = () => <Card content={<p />} />",
      "const c = () => createElement(Card, { content: 1 })",
    ],
    invalid: [
      { code: "const a = () => <Card children={<p />} />", errors: [{ messageId: "children" }] },
      { code: "const b = () => createElement(Card, { children: 1 })", errors: [{ messageId: "children" }] },
      { code: "const c = () => React.createElement(Card, { 'children': 1 })", errors: [{ messageId: "children" }] },
    ],
  }))
  const message = rule("no-children-prop").meta?.messages?.["children"]
  assert.match(message ?? "", /FE_CONNECTED_BLOCK_RENDER_PAIR/)
  assert.match(message ?? "", /another name/)
})

test("S6754: useState is destructured into a value and a setter named after it", () => {
  assert.doesNotThrow(() => tester.run("use-state-destructured", rule("use-state-destructured"), {
    valid: ["const [open, setOpen] = useState(false)", "const [value, setValue] = React.useState(0)", "const stored = useStore()"],
    invalid: [
      { code: "const state = useState(0)", errors: [{ messageId: "pair" }] },
      { code: "const [open] = useState(false)", errors: [{ messageId: "pair" }] },
      { code: "const [open, toggle] = useState(false)", errors: [{ messageId: "symmetric", data: { value: "open", Value: "Open" } }] },
    ],
  }))
})

test("S6819: a host element carries its ARIA role as the native element", () => {
  assert.doesNotThrow(() => tester.run("prefer-tag-over-role", rule("prefer-tag-over-role"), {
    valid: [
      "const a = () => <output>saved</output>",
      'const b = () => <ul role="list" />',
      'const c = () => <div role="presentation" />',
      'const d = () => <svg role="img" />',
      'const e = () => <Banner role="status" />',
      "const f = () => <div role={kind} />",
    ],
    invalid: [
      { code: 'const a = () => <div role="status">saved</div>', errors: [{ messageId: "tag", data: { tag: "output", role: "status", name: "div" } }] },
      { code: 'const b = () => <div role="button" />', errors: [{ messageId: "tag", data: { tag: "button", role: "button", name: "div" } }] },
      { code: 'const c = () => <span role={"navigation"} />', errors: [{ messageId: "tag", data: { tag: "nav", role: "navigation", name: "span" } }] },
    ],
  }))
})

test("text:S6389: a bidirectional control character is refused anywhere with its escape", () => {
  const controls = [0x202a, 0x202e, 0x2066, 0x2069].map((code) => String.fromCodePoint(code))
  assert.doesNotThrow(() => tester.run("no-bidirectional-character", rule("no-bidirectional-character"), {
    valid: ["const a = '\\u202E'", "// the escape \\u2066 written as text\nexport const b = 1"],
    invalid: [
      ...controls.map((control) => ({ code: `const a = 'x${control}y'`, errors: [{ messageId: "raw" }] })),
      { filename: "src/a.service.spec.ts", code: `/* ${String.fromCodePoint(0x202e)} */ export const d = 1`, errors: [{ messageId: "raw" }] },
    ],
  }))
})

test("S3863: a merged import longer than the print width is laid out one specifier a line", () => {
  assert.doesNotThrow(() => tester.run("no-duplicate-import", rule("no-duplicate-import"), { valid: [], invalid: [{ code: "import { SpecifierNumber1Long, SpecifierNumber2Long, SpecifierNumber3Long, SpecifierNumber4Long, SpecifierNumber5Long, SpecifierNumber6Long } from \"@modules/platform/logging\"\nimport type { SpecifierNumber7Long, SpecifierNumber8Long, SpecifierNumber9Long, SpecifierNumber10Long, SpecifierNumber11Long, SpecifierNumber12Long } from \"@modules/platform/logging\"\nexport const a = 1\n", output: "import {\n    SpecifierNumber1Long,\n    SpecifierNumber2Long,\n    SpecifierNumber3Long,\n    SpecifierNumber4Long,\n    SpecifierNumber5Long,\n    SpecifierNumber6Long,\n    type SpecifierNumber7Long,\n    type SpecifierNumber8Long,\n    type SpecifierNumber9Long,\n    type SpecifierNumber10Long,\n    type SpecifierNumber11Long,\n    type SpecifierNumber12Long,\n} from \"@modules/platform/logging\"\nexport const a = 1\n", errors: [{ messageId: "duplicate" }] }] }))
})

test("S1135: a leftover TODO marker is refused in any comment; the word as a noun of prose or a name is not a marker", () => {
  assert.doesNotThrow(() => tester.run("todo-tag", rule("todo-tag"), {
    valid: [
      "/** The kinds of line a todo can be, each a key of the `guide.todo` catalog. */\nexport type GuideTodoKey = 'open' | 'done'",
      "// the todo list of the guide\nexport const a = 1",
      "// Todo lines are drawn by the guide\nexport const a = 1",
      "/** A todo (an open line of the guide) is kept in `guide.todo`. */\nexport const a = 1",
      "// TODO_KEY and todoCount name the catalog\nexport const a = 1",
      "// TODO PROJ-12 tracked in the issue board\nexport const a = 1",
      "// eslint-disable-next-line no-console\nexport const a = 1",
      { filename: "src/a.spec.ts", code: "// TODO: later\nexport const a = 1" },
      "export const todo = 'TODO'",
    ],
    invalid: [
      { code: "// TODO\nexport const a = 1", errors: [{ messageId: "todo", line: 1, column: 4 }] },
      { code: "// TODO: handle the empty list\nexport const a = 1", errors: [{ messageId: "todo" }] },
      { code: "// TODO(cuong) handle the empty list\nexport const a = 1", errors: [{ messageId: "todo" }] },
      { code: "// todo: handle the empty list\nexport const a = 1", errors: [{ messageId: "todo" }] },
      { code: "/**\n * Draws the list.\n * TODO handle the empty list\n */\nexport const a = 1", errors: [{ messageId: "todo", line: 3, column: 4 }] },
      { code: "const a = 1 /* fix this. TODO: later */", errors: [{ messageId: "todo" }] },
    ],
  }))
})
