/**
 * Twin tests for the flat table law (DATA-TABLE-SURFACE): `surface` is removed from `DataTable`; the fix drops the attribute.
 *
 *   node --test src/data-table-surface.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { dataTableSurface, recommended, rules } from "./data-table-surface.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS = "import * as G from \"@starci/grammar/core\"\nimport { DataTable, Pane, Section } from \"@starci/grammar/core\"\n"
const code = (body: string): string => `${IMPORTS}export const A = () => ${body}`
const surface = { messageId: "surface" }

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["data-table-surface"])
  assert.deepEqual(recommended, { "starci-grammar/data-table-surface": "error" })
  assert.equal(dataTableSurface.meta?.fixable, "code")
})

test("DATA-TABLE-SURFACE: a surface on a DataTable is refused and removed", () => {
  slotTester().run("data-table-surface", dataTableSurface, {
    valid: [
      { filename: BLOCK, code: code("<Section title=\"Runs\"><DataTable label=\"Runs\" columns={c} rows={r} /></Section>") },
      // `surface` is its own prop on another component
      { filename: BLOCK, code: code("<Pane surface area=\"room\" />") },
      // not the Grammar's DataTable
      { filename: BLOCK, code: "import { DataTable } from \"./mine\"\nexport const A = () => <DataTable surface=\"card\" />" },
      // a script is not product source
      { filename: SCRIPT, code: code("<DataTable surface=\"card\" columns={c} rows={r} />") },
    ],
    invalid: [
      { filename: BLOCK, code: code("<DataTable label=\"Runs\" surface=\"card\" columns={c} rows={r} />"), output: code("<DataTable label=\"Runs\" columns={c} rows={r} />"), errors: [surface] },
      { filename: BLOCK, code: code("<DataTable surface=\"none\" label=\"Runs\" columns={c} rows={r} />"), output: code("<DataTable label=\"Runs\" columns={c} rows={r} />"), errors: [surface] },
      { filename: BLOCK, code: code("<DataTable label=\"Runs\" columns={c} rows={r} surface={\"frame\"} />"), output: code("<DataTable label=\"Runs\" columns={c} rows={r} />"), errors: [surface] },
      { filename: BLOCK, code: code("<DataTable label=\"Runs\" surface={tone} columns={c} rows={r} />"), output: code("<DataTable label=\"Runs\" columns={c} rows={r} />"), errors: [surface] },
      { filename: BLOCK, code: code("<DataTable\n  label=\"Runs\"\n  surface=\"card\"\n  columns={c}\n  rows={r}\n/>"), output: code("<DataTable\n  label=\"Runs\"\n  columns={c}\n  rows={r}\n/>"), errors: [surface] },
      { filename: BLOCK, code: code("<G.DataTable surface=\"card\" columns={c} rows={r} />"), output: code("<G.DataTable columns={c} rows={r} />"), errors: [surface] },
    ],
  })
})

test("DATA-TABLE-SURFACE: the message names the fix", () => {
  assert.match(dataTableSurface.meta?.messages?.surface ?? "", /^`DataTable surface` is removed: a table has one flat look\. Drop the `surface` attribute and put the table under its `Section`/)
})
