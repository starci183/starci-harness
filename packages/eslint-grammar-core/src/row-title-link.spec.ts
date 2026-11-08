/**
 * Twin tests for the row title link law (`FE_ROW_TITLE_LINK`).
 *
 *   node --test src/row-title-link.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended, rowTitleLink, rules } from "./row-title-link.ts"

const BLOCK = at("apps/web/src/components/blocks/Runs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORT = "import { DataTable, Link, ListRow, Section, Text } from \"@starci/grammar\"\n"
const COLUMNS = "columns={[{ id: \"name\", label: \"Name\", isRowHeader: true }, { id: \"owner\", label: \"Owner\" }]}"
const TABLE = (props: string, render: string): string => IMPORT + `export const A = () => <DataTable label="Runs" rows={rows} ${COLUMNS} emptyContent={null} ${props} renderCell={${render}} />`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["row-title-link"])
  assert.deepEqual(recommended, { "starci-grammar/row-title-link": "error" })
})

test("FE_ROW_TITLE_LINK: a Link as the title of a row that already opens is red", () => {
  slotTester().run("row-title-link", rowTitleLink, {
    valid: [
      // a row that opens, with a plain title
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={[{ id: \"a\", title: \"A\", href: \"/a\" }]} />" },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={rows.map((r) => ({ id: r.id, title: <Text isStrong>{r.name}</Text>, onPress: () => open(r) }))} />" },
      // a row that does not open may hold a link in its title
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={[{ id: \"a\", title: <Link href=\"/a\">A</Link>, description: \"x\" }]} />" },
      // a Link in the description is not the title
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={[{ id: \"a\", title: \"A\", href: \"/a\", description: <Link href=\"/b\">B</Link> }]} />" },
      // a table whose rows do not open may link its first column
      { filename: BLOCK, code: TABLE("", "(row) => <Link href={row.href}>{row.name}</Link>") },
      // a Link in another column of a table whose rows open
      { filename: BLOCK, code: TABLE("onRowAction={open}", "(row, id) => id === \"owner\" ? <Link href={row.ownerHref}>{row.owner}</Link> : <Text isStrong>{row.name}</Text>") },
      { filename: BLOCK, code: TABLE("onRowAction={open}", "(row, id) => { switch (id) { case \"owner\": return <Link href={row.ownerHref}>{row.owner}</Link>; default: return <Text>{row.name}</Text> } }") },
      // a local Link is not the Grammar Link
      { filename: BLOCK, code: "const Link = (p) => p.children\nexport const A = () => <Section kind=\"list\" items={[{ id: \"a\", title: <Link>A</Link>, href: \"/a\" }]} />" },
      { filename: SCRIPT, code: IMPORT + "export const A = () => <Section kind=\"list\" items={[{ id: \"a\", title: <Link href=\"/a\">A</Link>, href: \"/a\" }]} />" },
    ],
    invalid: [
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={[{ id: \"a\", title: <Link href=\"/a\">A</Link>, href: \"/a\" }]} />", errors: [{ messageId: "row" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <Section kind=\"list\" items={rows.map((r) => ({ id: r.id, title: <Link href={r.url}>{r.name}</Link>, onPress: () => open(r) }))} />", errors: [{ messageId: "row" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <ListRow row={{ id: \"a\", title: <Text><Link href=\"/a\">A</Link></Text>, chevron: true }} />", errors: [{ messageId: "row" }] },
      { filename: BLOCK, code: TABLE("onRowAction={open}", "(row) => <Link href={row.href}>{row.name}</Link>"), errors: [{ messageId: "cell" }] },
      { filename: BLOCK, code: TABLE("onRowAction={open}", "(row, id) => id === \"name\" ? <Link href={row.href}>{row.name}</Link> : <Text>{row.owner}</Text>"), errors: [{ messageId: "cell" }] },
      { filename: BLOCK, code: TABLE("onRowAction={open}", "(row, id) => { switch (id) { case \"name\": return <Link href={row.href}>{row.name}</Link>; default: return null } }"), errors: [{ messageId: "cell" }] },
      { filename: BLOCK, code: IMPORT + "export const A = () => <DataTable label=\"Runs\" rows={rows.map((r) => ({ id: r.id, href: r.url }))} columns={[{ id: \"name\", label: \"Name\" }]} emptyContent={null} renderCell={(row) => <Link href={row.href}>{row.name}</Link>} />", errors: [{ messageId: "cell" }] },
    ],
  })
})
