/**
 * Twin tests for the table and row type law (`FE_TABLE_CELL_TYPE`).
 *
 *   node --test src/table-cell-type.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rules, tableCellType } from "./table-cell-type.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { DataTable, Heading, Label, ListRow, Section, SurfaceCard, Text } from \"@starci/grammar\"\n"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["table-cell-type"])
  assert.deepEqual(recommended, { "starci-grammar/table-cell-type": "error" })
})

test("FE_TABLE_CELL_TYPE: a heading-size Text in a cell or a row is red", () => {
  slotTester().run("table-cell-type", tableCellType, {
    valid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row) => <Text isStrong>{row.name}</Text>} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row) => <Text size=\"sm\" tone=\"muted\">{row.name}</Text>} />" },
      // a figure outside a cell is a figure (a KPI)
      { filename: BLOCK, code: IMPORT + "export const A = () => <Text size=\"figure\">12</Text>" },
      // 14 (md, sm, absent) and 12 (xs) are the cell sizes
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row) => <Text size=\"xs\" tone=\"muted\">{row.name}</Text>} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row) => <Text size=\"md\">{row.name}</Text>} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Heading level={2}>Runs</Heading>" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={rows.map((r) => ({ id: r.id, title: r.name, description: r.note }))} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <SurfaceCard collection={{ kind: \"list\", items: [{ id: \"a\", title: <Text isStrong>A</Text>, description: <Text size=\"sm\" tone=\"muted\">b</Text> }], empty: null }} />" },
      // a heading beside the row object, not in its title or description
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={[{ id: \"a\", title: \"A\", detail: <Heading level={3}>x</Heading> }]} />" },
      // a non-list object is not a row
      { filename: BLOCK, code: IMPORT + "export const A = { title: <Heading level={2}>x</Heading> }" },
      // a local Text is not the Grammar Text
      { filename: BLOCK, code: "const Text = (p) => p.children\nexport const A = () => <DataTable renderCell={() => <Text size=\"figure\">1</Text>} />" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <DataTable renderCell={() => <Heading>x</Heading>} />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row) => <Text size=\"figure\">{row.name}</Text>} />", errors: [{ messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row) => <Text size=\"lg\">{row.name}</Text>} />", errors: [{ messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row) => <Heading level={3}>{row.name}</Heading>} />", errors: [{ messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={(row, id) => id === \"name\" ? <h3>{row.name}</h3> : <Label>{row.x}</Label>} />", errors: [{ messageId: "heading" }, { messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "const cell = (row) => <Text size=\"figure\">{row.name}</Text>\nexport const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={cell} />", errors: [{ messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "function cell(row) { return <Text size=\"figure\">{row.name}</Text> }\nexport const A = () => <DataTable label=\"Runs\" rows={rows} columns={cols} emptyContent={null} renderCell={cell} />", errors: [{ messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows} emptyContent={null} renderCell={() => null} columns={[{ id: \"n\", label: \"N\", editor: (row) => <Heading>{row.n}</Heading> }]} />", errors: [{ messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={rows.map((r) => ({ id: r.id, title: <Text size=\"figure\">{r.name}</Text> }))} />", errors: [{ messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <SurfaceCard collection={{ kind: \"list\", items: [{ id: \"a\", title: <Heading level={3}>A</Heading>, description: <h4>b</h4> }], empty: null }} />", errors: [{ messageId: "heading" }, { messageId: "heading" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ListRow row={{ id: \"a\", title: <Text size=\"figure\">A</Text> }} />", errors: [{ messageId: "heading" }] },
    ],
  })
})
