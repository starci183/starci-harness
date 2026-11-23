/**
 * The Button pass of v0550: one variant, primary, border or danger.
 *
 *   node --test codemods/v0550/button.spec.mts
 */
import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { transformApiSource } from "./api.mts"
import { BUTTON_MARK, BUTTON_VARIANT_MAP, INTENT_MAP } from "./button.mts"

/** The Grammar imports the snippets read their elements from (the codemod touches only a Grammar element), at the end so the lines of a snippet stay its own. */
const GRAMMAR = `
import * as G from "@starci/grammar"
import { Alert, Avatar, AvatarButton, AvatarGroup, Button, ButtonGroup, EmptyNotice, ExpandableText, FilterButtonGroup, GrammarRoot, IconButton, IconTile, ListRow, Stepper, Text, Timeline } from "@starci/grammar/core"
import { BarChart, Sparkline } from "@starci/grammar/core/ext/recharts"
`
const withGrammar = (out: ReturnType<typeof transformApiSource>) => ({ ...out, text: out.text.endsWith(GRAMMAR) ? out.text.slice(0, -GRAMMAR.length) : out.text })
const bare = (code: string) => transformApiSource(ts, "apps/web/src/components/blocks/Foo/index.tsx", code)
const run = (code: string) => withGrammar(transformApiSource(ts, "apps/web/src/components/blocks/Foo/index.tsx", code + GRAMMAR))
const IMPORT = 'import { Button, IconButton, EmptyNotice, ListRow } from "@starci/grammar/core"\n'
const one = (before: string): string => run(`export const A = () => ${before}\n`).text.replace(/^export const A = \(\) => /u, "").replace(/\n$/u, "")

test("the mapping is the owner's: commit primary; ghost, tertiary, neutral, dismiss, secondary, outline and retry border; danger and danger-soft danger", () => {
    const expected: Readonly<Record<string, string>> = {
        commit: "primary", primary: "primary",
        neutral: "border", alternative: "border", dismiss: "border", retry: "border", secondary: "border", tertiary: "border", outline: "border", ghost: "border", flat: "border", border: "border",
        destructive: "danger", danger: "danger", "danger-soft": "danger",
    }
    assert.deepEqual({ ...BUTTON_VARIANT_MAP }, expected)
    assert.deepEqual(Object.keys(INTENT_MAP).sort(), ["alternative", "commit", "destructive", "dismiss", "neutral", "retry"])
})

test("every literal intent and vendor variant becomes the one variant, on a bare or member element", () => {
    const cases: readonly [string, string][] = [
        ['<Button intent="commit">Save</Button>', '<Button variant="primary">Save</Button>'],
        ['<Button intent="neutral" size="sm">Edit</Button>', '<Button variant="border" size="sm">Edit</Button>'],
        ['<Button intent="alternative">Back</Button>', '<Button variant="border">Back</Button>'],
        ['<Button intent="dismiss">Cancel</Button>', '<Button variant="border">Cancel</Button>'],
        ['<Button intent={"retry"}>Try again</Button>', '<Button variant="border">Try again</Button>'],
        ['<Button intent="destructive" step="entry">Delete</Button>', '<Button variant="danger">Delete</Button>'],
        ['<Button intent="destructive" step="confirm">Delete for good</Button>', '<Button variant="danger">Delete for good</Button>'],
        ['<Button variant="ghost">More</Button>', '<Button variant="border">More</Button>'],
        ['<Button variant="tertiary">More</Button>', '<Button variant="border">More</Button>'],
        ['<Button variant="secondary">More</Button>', '<Button variant="border">More</Button>'],
        ['<Button variant="outline">More</Button>', '<Button variant="border">More</Button>'],
        ['<Button variant="danger-soft">Remove</Button>', '<Button variant="danger">Remove</Button>'],
        ['<G.Button intent="commit" href="/next">Next</G.Button>', '<G.Button variant="primary" href="/next">Next</G.Button>'],
        ['<IconButton intent="dismiss" label="Close" />', '<IconButton variant="border" label="Close" />'],
        ['<IconButton intent="destructive" step="entry" glyph="trash" label="Remove" />', '<IconButton variant="danger" glyph="trash" label="Remove" />'],
        ['<IconButton variant="ghost" glyph="more" label="More" />', '<IconButton variant="border" glyph="more" label="More" />'],
    ]
    for (const [before, after] of cases) {
        const out = run(`${IMPORT}export const A = () => ${before}\n`)
        assert.equal(out.text, `${IMPORT}export const A = () => ${after}\n`, before)
        assert.equal(out.findings.filter((f) => f.step === "button-variant").length, 1, before)
    }
})

test("intent wins over a stray variant, and a conditional between literals is mapped branch by branch", () => {
    assert.equal(one('<Button intent="commit" variant="ghost">Go</Button>'), '<Button variant="primary">Go</Button>')
    assert.equal(one('<Button intent={popular ? "commit" : "neutral"}>Pick</Button>'), '<Button variant={popular ? "primary" : "border"}>Pick</Button>')
    assert.equal(one('<Button intent={a ? "neutral" : "dismiss"}>X</Button>'), '<Button variant="border">X</Button>')
    // a const of the same file is followed
    const out = run('const LOOK = "alternative" as const\nexport const A = () => <Button intent={LOOK}>Back</Button>\n')
    assert.match(out.text, /<Button variant="border">Back<\/Button>/u)
})

test("a tone colours a primary: a toned Button becomes a toned primary, a danger tone is the danger look", () => {
    assert.equal(one('<Button intent="alternative" tone="warning">Fix</Button>'), '<Button variant="primary" tone="warning">Fix</Button>')
    assert.equal(one('<Button tone="info">Open</Button>'), '<Button variant="primary" tone="info">Open</Button>')
    assert.equal(one('<Button intent="alternative" tone="danger">Retry</Button>'), '<Button variant="danger">Retry</Button>')
    assert.equal(one('<Button tone="danger">Stop</Button>'), '<Button variant="danger">Stop</Button>')
})

test("a value it cannot decide is marked TODO(button), never guessed, and the mark is not doubled", () => {
    const once = run('export const A = ({ i }) => (\n    <div>\n        <Button intent={i} step="entry">Go</Button>\n    </div>\n)\n')
    assert.match(once.text, /\{\/\* TODO\(button\): the look is not a literal/u)
    assert.match(once.text, /<Button intent=\{i\}>Go<\/Button>/u, "the step is still dropped; the intent stays for a person")
    assert.equal(once.findings.some((f) => f.reason !== undefined && f.step === "button-variant"), true)
    assert.equal(run(once.text).text, once.text)
    assert.ok(BUTTON_MARK === "TODO(button)")
})

test("the new API is left as it is", () => {
    for (const code of ['<Button variant="primary" tone="info">Go</Button>', '<Button>Go</Button>', '<Button variant="danger">Delete</Button>', '<IconButton label="Close" />']) {
        const out = run(`export const A = () => ${code}\n`)
        assert.equal(out.text, `export const A = () => ${code}\n`, code)
        assert.equal(out.findings.length, 0, code)
    }
})

test("EmptyNotice actionIntent is actionVariant", () => {
    assert.equal(one('<EmptyNotice message="m" actionLabel="Add" actionIntent="neutral" onAction={f} />'), '<EmptyNotice message="m" actionLabel="Add" actionVariant="border" onAction={f} />')
    assert.equal(one('<EmptyNotice message="m" actionLabel="Add" actionIntent="commit" onAction={f} />'), '<EmptyNotice message="m" actionLabel="Add" actionVariant="primary" onAction={f} />')
    assert.match(one('<EmptyNotice message="m" actionLabel="Add" actionIntent={x} onAction={f} />'), /TODO\(button\)/u)
})

test("an action object's intent is its variant in a Grammar file, isPrimary is dropped, and a word elsewhere is left", () => {
    const code = `${IMPORT}const rows = [{ id: "a", action: { label: "Continue", intent: "commit", isPrimary: true, press } }, { id: "b", action: { label: "Remove", intent: "destructive", press } }]\n`
    assert.equal(run(code).text, `${IMPORT}const rows = [{ id: "a", action: { label: "Continue", variant: "primary", press } }, { id: "b", action: { label: "Remove", variant: "danger", press } }]\n`)
    // `intent: "primary"` is not an intent: left; a file without the Grammar is left.
    const other = `${IMPORT}const x = { intent: "primary", mode: 1 }\n`
    assert.equal(run(other).text, other)
    const plain = 'const rows = [{ label: "Continue", intent: "commit" }]\n'
    assert.equal(bare(plain).text, plain)
    // a dynamic action intent is marked
    assert.match(run(`${IMPORT}const a = { label: "Go", intent: pick() }\n`).text, /\/\* TODO\(button\): the action's intent is not a literal/u)
})

test("an import of a deleted intent export is marked", () => {
    const out = run('import { Button, type ButtonIntent } from "@starci/grammar/core"\n')
    assert.match(out.text, /^\/\/ TODO\(grammar-0\.55\): ButtonIntent is deleted in 0\.55\.0; use ButtonVariant/u)
})
