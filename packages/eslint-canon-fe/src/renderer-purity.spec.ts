/**
 * Twin tests for RENDERER-PURITY-1: a renderer (a .tsx file) of a root workspace package holds presentation only.
 *
 *   node --test src/renderer-purity.spec.ts
 */
// proves: FE_RENDERER_LOGIC@lite FE_RENDERER_LOGIC@full
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { RuleTester } from "eslint"
import { canonTester } from "../fixtures/typed/tester.ts"
import { why } from "./lib/why.ts"
import { isRootPackageRenderer, recommended, rules } from "./renderer-purity.ts"

const rule = rules["renderer-presentation-only"]
const tester = canonTester(new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } }))
const RENDERER = "packages/widgets/src/client/panel/SummaryBlock.tsx"

const valid = (code: string, filename = RENDERER) => ({ code, filename })
const invalid = (code: string, messageId: string, filename = RENDERER) => ({ code, filename, errors: [{ messageId }] })
const body = (inner: string): string => `export const Block = (props: { rows: Row[]; total: number; due: Date }): JSX.Element => {\n${inner}\n  return <div />\n}`

test("RENDERER-PURITY-1: the rule carries its finding code and is published at error", () => {
  assert.equal(why["renderer-presentation-only"].code, "FE_RENDERER_LOGIC")
  assert.deepEqual(recommended, { "starci-fe/renderer-presentation-only": "error" })
})

test("RENDERER-PURITY-1: every .tsx file of a root package is judged, whatever its folder, and nothing else", () => {
  assert.equal(isRootPackageRenderer("C:\\app\\packages\\ui-kit\\src\\client\\x\\A.tsx"), true)
  assert.equal(isRootPackageRenderer("/app/packages/ui-kit/src/client/A.tsx"), true)
  assert.equal(isRootPackageRenderer("/app/packages/ui-kit/src/client/A.ts"), false, "a .ts is measured logic")
  assert.equal(isRootPackageRenderer("/app/packages/ui-kit/src/rules/A.tsx"), true, "no folder name decides")
  assert.equal(isRootPackageRenderer("/app/packages/ui-kit/src/A.tsx"), true)
  assert.equal(isRootPackageRenderer("/app/fe/packages/ui/src/client/A.tsx"), false, "a front-end package keeps the front-end canon alone")
  const logic = body("  const sum = props.rows.reduce((a, r) => a + r.amount, 0)")
  assert.doesNotThrow(() => tester.run("outside-scope", rule, { valid: [valid(logic, "fe/packages/ui/src/Sum.tsx"), valid(logic, "fe/apps/web/src/Sum.tsx"), valid("export const sum = (rows: Row[]): number => rows.reduce((a, r) => a + r.amount, 0)", "packages/ui-kit/src/client/sum.ts")], invalid: [] }))
})

test("RENDERER-PURITY-1: presentation is allowed: mapping, choosing a view, formatting, a declared action", () => {
  assert.doesNotThrow(() =>
    tester.run("allowed", rule, {
      valid: [
        valid(body("  const items = props.rows.map((row) => ({ id: row.id, title: row.name }))")),
        valid(body("  const shown = props.rows.filter((row) => row.visible).map((row) => row.name)")),
        valid(body("  const title = props.rows.length === 0 ? 'empty' : 'list'")),
        valid(body("  const label = props.total > 0 ? 'owed' : 'settled'")),
        valid(body("  const next = props.rows.length + 1\n  const percent = props.total * 100\n  const prev = props.total - 1")),
        valid(body("  const isLast = props.rows.length > 0 && props.rows.at(-1) !== undefined\n  const tail = props.rows.map((row, index) => index < props.rows.length - 1)")),
        valid(body("  const text = `${props.total} of ${props.rows.length}`")),
        valid(body("  const rows = [...props.rows].sort((a, b) => a.name.localeCompare(b.name))")),
        valid(body("  const byAmount = [...props.rows].sort((a, b) => a.amount - b.amount)")),
        valid(body("  const names: string[] = []\n  for (const row of props.rows) names.push(row.name)")),
        valid(body("  const draft = {} as Record<string, string>\n  draft.title = 'x'")),
        valid(body("  const ref = useRef(0)\n  ref.current += 1")),
        valid(body("  const [open, setOpen] = useState(false)\n  const toggle = () => setOpen(!open)")),
        valid(body("  const run = (handle: { run: (input: object) => Promise<unknown> }) => handle.run({ id: props.rows[0]?.id })")),
        valid(body("  const stored = localStorage.getItem('density')")),
        valid("import { format } from 'date-fns'\nexport const when = (d: Date): string => format(d, 'dd/MM')"),
      ],
      invalid: [],
    }),
  )
})

test("RENDERER-PURITY-1: data computation, aggregation and date math are refused", () => {
  assert.doesNotThrow(() =>
    tester.run("computation", rule, {
      valid: [],
      invalid: [
        invalid(body("  const line = props.rows[0].price * props.rows[0].quantity"), "arithmetic"),
        invalid(body("  const left = props.total - props.rows[0].paid"), "arithmetic"),
        invalid(body("  const share = getTotal() / getCount()"), "arithmetic"),
        invalid(body("  let total = 0\n  for (const row of props.rows) total += row.amount"), "accumulation"),
        invalid(body("  const total = props.rows.reduce((sum, row) => sum + row.amount, 0)"), "aggregation"),
        invalid(body("  const max = Math.max(...props.rows.map((row) => row.amount))"), "aggregation"),
        invalid(body("  const open = props.rows.filter((row) => row.open).filter((row) => row.visible)"), "chain"),
        invalid(body("  const top = props.rows.filter((row) => row.open).sort((a, b) => a.amount - b.amount)"), "chain"),
        invalid(body("  const age = Date.now() - props.due.getTime()"), "dateMath"),
        invalid(body("  const left = new Date(props.rows[0].due) - new Date()"), "dateMath"),
        invalid(body("  const soon = props.due\n  soon.setDate(soon.getDate() + 3)"), "dateMath"),
        invalid("import { addDays } from 'date-fns'\nexport const later = (d: Date): Date => addDays(d, 3)", "dateFns"),
        invalid("import { differenceInDays as days } from 'date-fns/differenceInDays'\nexport const n = days(new Date(), new Date())", "dateFns"),
      ],
    }),
  )
})

test("RENDERER-PURITY-1: a domain comparison and a mutation outside a declared action are refused", () => {
  assert.doesNotThrow(() =>
    tester.run("rules-and-writes", rule, {
      valid: [],
      invalid: [
        invalid(body("  const overdue = props.rows[0].due < props.rows[0].paidOn"), "domainRule"),
        invalid(body("  const over = props.total >= getLimit()"), "domainRule"),
        invalid(body("  props.rows.push({ id: 'new' } as Row)"), "mutation"),
        invalid(body("  props.rows.sort((a, b) => a.amount - b.amount)"), "mutation"),
        invalid(body("  props.rows[0].status = 'paid'"), "mutation"),
        invalid(body("  props.rows[0].count++"), "mutation"),
        invalid(body("  delete props.rows[0].note"), "mutation"),
        invalid("export const Block = ({ rows }: { rows: Row[] }): JSX.Element => {\n  rows.reverse()\n  return <div />\n}", "mutation"),
        invalid(body("  const alias = props.rows\n  alias.splice(0, 1)"), "mutation"),
        invalid(body("  void fetch('/api/pay', { method: 'POST' })"), "network"),
        invalid(body("  localStorage.setItem('paid', '1')"), "network"),
        invalid(body("  sessionStorage.clear()"), "network"),
        invalid(body("  navigator.sendBeacon('/log', 'x')"), "network"),
      ],
    }),
  )
})
