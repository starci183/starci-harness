/**
 * Twin tests for `starci-grammar/status-text-uses-soft-foreground`.
 *
 *   node --test src/status-colors.spec.ts
 *
 * The rule is the status pair rule: content on a `bg-<tone>-soft` tint takes the soft foreground, a mark with no tint behind
 * it takes the tone. The violating cases are the shapes the wrong pair hides in: a plain className, a `cn()` call, a conditional,
 * a variant prefix, an opacity suffix, a hoisted constant, a `classes` entry and a tint on an enclosing element. The passing
 * cases are the pair on its tint, the bare tone, the solid fill with its own ink, and every neighbour that shares a prefix.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { solidTextClasses, softTextClasses, softBackgroundTones, rules, statusTextUsesSoftForeground } from "./status-colors.ts"
import { STATUS_TONES } from "./lib/status-tones.generated.ts"
// proves: FE_STYLE_TOKEN_ONLY@lite
// proves: FE_STYLE_TOKEN_ONLY@full
import { fixtureHfs } from "../../eslint-canon-fe/fixtures/typed/tester.ts"

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
})

const FILE = "src/components/leaves/StatusText/index.tsx"
const onTint = { messageId: "onTint" }
const alone = { messageId: "alone" }

for (const lite of [false, true]) {
  const edition = lite ? "lite" : "full"
  test(`FE_STYLE_TOKEN_ONLY: ${edition} status ink follows the pair rule`, () => {
    const hfs = fixtureHfs(undefined, { lite })
    assert.equal(hfs.edition, edition)
    new RuleTester({
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
      settings: { starci: { hfs } },
    }).run("status-text-uses-soft-foreground", statusTextUsesSoftForeground, {
      valid: [
        { filename: FILE, code: 'const E = () => <span className="bg-success-soft text-success-soft-foreground" />' },
        { filename: FILE, code: 'const E = () => <span className="text-success" />' },
      ],
      invalid: [
        { filename: FILE, code: 'const E = () => <span className="bg-success-soft text-success" />', errors: [onTint] },
        { filename: FILE, code: 'const E = () => <span className="text-success-soft-foreground" />', errors: [alone] },
      ],
    })
  })
}

test("the rule is exported under its published name", () => {
  assert.deepEqual(Object.keys(rules), ["status-text-uses-soft-foreground"])
})

test("the tones are the grammar's status tones, info included", () => {
  assert.deepEqual(STATUS_TONES, ["success", "warning", "danger", "info"])
})

test("solidTextClasses reads variants, opacity, important and every painting family, and nothing else", () => {
  const found = (text: string): string[] => solidTextClasses(text).map((entry) => entry.token)
  assert.deepEqual(found("text-success fill-danger stroke-warning decoration-info"), ["text-success", "fill-danger", "stroke-warning", "decoration-info"])
  assert.deepEqual(found("md:hover:text-success dark:text-danger/60 [&>svg]:fill-info !text-warning text-success/[.4]"), [
    "md:hover:text-success",
    "dark:text-danger/60",
    "[&>svg]:fill-info",
    "!text-warning",
    "text-success/[.4]",
  ])
  assert.deepEqual(
    found("text-success-soft-foreground bg-success-soft bg-success text-success-foreground border-danger ring-warning text-successful text-accent text-foreground fill-current"),
    [],
  )
  assert.deepEqual(found("[&:hover]:bg-success"), [])
})

test("softTextClasses and softBackgroundTones read the soft pair with variants and opacity, and nothing else", () => {
  const soft = (text: string): string[] => softTextClasses(text).map((entry) => entry.token)
  assert.deepEqual(soft("text-success-soft-foreground dark:fill-danger-soft-foreground/60 !stroke-info-soft-foreground"), [
    "text-success-soft-foreground",
    "dark:fill-danger-soft-foreground/60",
    "!stroke-info-soft-foreground",
  ])
  assert.deepEqual(soft("text-success text-accent-soft-foreground text-success-foreground bg-success-soft text-successful-soft-foreground"), [])
  assert.deepEqual(softBackgroundTones("bg-success-soft hover:bg-danger-soft-hover bg-warning-soft/50 !bg-info-soft"), ["success", "danger", "warning", "info"])
  assert.deepEqual(softBackgroundTones("bg-success text-success-soft-foreground bg-accent-soft bg-success-soft-foreground"), [])
})

test("offset-pop: the lone soft foreground is not judged, the solid tone on a tint still is", () => {
  const settings = { starci: { hfs: { grammar: "offset-pop" } } }
  new RuleTester({
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings,
  }).run("status-text-uses-soft-foreground", statusTextUsesSoftForeground, {
    valid: [
      { filename: FILE, code: 'const E = () => <span className="text-success-soft-foreground" />' },
      { filename: FILE, code: 'const E = () => <span className="text-success" />' },
    ],
    invalid: [{ filename: FILE, code: 'const E = () => <span className="bg-success-soft text-success" />', errors: [onTint] }],
  })
})

test("status-text-uses-soft-foreground", () => {
  tester.run("status-text-uses-soft-foreground", statusTextUsesSoftForeground, {
    valid: [
      // the soft pair on its tint
      { filename: FILE, code: 'const E = () => <span className="bg-success-soft text-success-soft-foreground px-2" />' },
      { filename: FILE, code: 'const E = () => <svg className="bg-danger-soft fill-danger-soft-foreground stroke-danger-soft-foreground" />' },
      // a mark that stands alone takes the tone itself
      { filename: FILE, code: 'const E = () => <span className="text-success" />' },
      { filename: FILE, code: 'const E = () => <svg className="fill-danger stroke-warning size-4" />' },
      { filename: FILE, code: 'const E = () => <a className="underline decoration-info" />' },
      { filename: FILE, code: 'const E = () => <p className="md:hover:text-success dark:text-danger/60 [&>svg]:fill-info" />' },
      // a tone beside a tint of ANOTHER tone is its own mark
      { filename: FILE, code: 'const E = () => <span className="bg-success-soft text-danger" />' },
      // the soft foreground on the tint an enclosing element sets
      { filename: FILE, code: 'const E = () => <div className="bg-success-soft"><span className="text-success-soft-foreground" /></div>' },
      { filename: FILE, code: 'const E = () => <div className={cn("p-2", ok && "bg-danger-soft")}><p><b className="text-danger-soft-foreground" /></p></div>' },
      // a solid button: the tone as the fill, its own ink on it
      { filename: FILE, code: 'const E = () => <button className="bg-success text-success-foreground hover:bg-success-hover" />' },
      // a boundary is not text
      { filename: FILE, code: 'const E = () => <div className="border-danger ring-2 ring-warning outline-info bg-info/10" />' },
      // neighbours that share a prefix
      { filename: FILE, code: 'const E = () => <p className="text-successful text-foreground text-muted text-accent-soft-foreground" />' },
      // conditionals and cn() that keep each tone on its own side
      { filename: FILE, code: 'const E = ({ ok }) => <p className={cn("text-sm", ok ? "text-success" : "text-danger")} />' },
      // a constant or classes entry is not judged for the soft foreground: the element that wears it is not in view
      { filename: FILE, code: 'const TONE = "text-success-soft-foreground"' },
      { filename: FILE, code: 'const C = { x: { classes: ["flex", "text-warning-soft-foreground"] } }' },
      // strings that are not class strings
      { filename: FILE, code: 'const E = () => <p title="text-success" data-id="bg-success-soft fill-danger">{"text-success"}</p>' },
    ],
    invalid: [
      // solid text on its own tint
      { filename: FILE, code: 'const E = () => <span className="bg-success-soft text-success" />', errors: [onTint] },
      { filename: FILE, code: 'const E = () => <span class="bg-danger-soft text-danger font-medium" />', errors: [onTint] },
      { filename: FILE, code: 'const E = () => <svg className="bg-warning-soft fill-warning size-4" />', errors: [onTint] },
      { filename: FILE, code: 'const E = () => <svg className="bg-info-soft stroke-info" />', errors: [onTint] },
      { filename: FILE, code: 'const E = () => <a className="bg-danger-soft underline decoration-danger" />', errors: [onTint] },
      // variants and opacity do not launder the tone: one finding per class token
      { filename: FILE, code: 'const E = () => <p className="bg-success-soft md:hover:text-success dark:text-success/60 [&>svg]:fill-success" />', errors: [onTint, onTint, onTint] },
      // the tint may be a hover or an opacity variant
      { filename: FILE, code: 'const E = () => <p className="hover:bg-success-soft/50 text-success" />', errors: [onTint] },
      // through cn(), a conditional and a logical expression
      { filename: FILE, code: 'const E = ({ ok }) => <p className={cn("bg-success-soft", ok ? "text-success" : "text-danger")} />', errors: [onTint] },
      { filename: FILE, code: 'const E = ({ bad }) => <p className={clsx("bg-danger-soft", bad && "text-danger")} />', errors: [onTint] },
      { filename: FILE, code: 'const E = ({ bad }) => <p className={clsx("bg-warning-soft", { "text-warning": bad })} />', errors: [onTint] },
      { filename: FILE, code: "const E = () => <p className={`bg-info-soft text-info ${x}`} />", errors: [onTint] },
      // the shapes that hide from a JSX-only reader: a constant, an array, a classes entry
      { filename: FILE, code: 'const OK = "inline-flex bg-success-soft text-success"', errors: [onTint] },
      { filename: FILE, code: 'const TONES = { ok: ["bg-success-soft", "text-success"] }', errors: [onTint] },
      { filename: FILE, code: 'const C = { x: { classes: ["flex", "bg-warning-soft", "text-warning"] } }', errors: [onTint] },
      // the soft foreground with no tint of its tone behind it
      { filename: FILE, code: 'const E = () => <span className="text-success-soft-foreground" />', errors: [alone] },
      { filename: FILE, code: 'const E = () => <svg className="fill-danger-soft-foreground stroke-warning-soft-foreground" />', errors: [alone, alone] },
      { filename: FILE, code: 'const E = () => <div className="bg-danger-soft"><span className="text-success-soft-foreground" /></div>', errors: [alone] },
      { filename: FILE, code: 'const E = ({ ok }) => <p className={cn("text-sm", ok ? "text-success-soft-foreground" : "text-danger")} />', errors: [alone] },
      { filename: FILE, code: 'const E = () => <p className="md:text-info-soft-foreground/70" />', errors: [alone] },
      // a tint on a sibling or a child is not behind the mark
      { filename: FILE, code: 'const E = () => <div><i className="bg-success-soft" /><span className="text-success-soft-foreground" /></div>', errors: [alone] },
      { filename: FILE, code: 'const E = () => <span className="text-success-soft-foreground"><i className="bg-success-soft" /></span>', errors: [alone] },
      // the messages name the pair or the tone to use
      {
        filename: FILE,
        code: 'const E = () => <span className="bg-success-soft text-success" />',
        errors: [{ message: /`text-success` paints text or an icon with the solid `success` tone on a `bg-success-soft` tint.*`text-success-soft-foreground` on `bg-success-soft`/ }],
      },
      {
        filename: FILE,
        code: 'const E = () => <span className="text-success-soft-foreground" />',
        errors: [{ message: /no `bg-success-soft` is behind it.*takes the tone itself: `text-success`/ }],
      },
    ],
  })
})
