/**
 * The Fragment inventory lists every `<Fragment reason="...">` region as information: positions, reasons and the libraries used.
 *
 *   node --test src/fragment-inventory.spec.ts
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"
import { fragmentInventory, fragmentUsesOf, formatFragmentInventory } from "./lib/fragment-inventory.ts"

const SOURCE = [
  "import { Fragment, SurfaceCard } from \"@starci/grammar/core\"",
  "import * as G from \"@starci/grammar/core\"",
  "import { ReactFlow } from \"@xyflow/react\"",
  "import { helper } from \"./helper\"",
  "export const A = () => (",
  "  <SurfaceCard>",
  "    <Fragment reason=\"workflow graph\"><ReactFlow />{helper()}</Fragment>",
  "    <G.Fragment reason={`art`} />",
  "    <Fragment />",
  "  </SurfaceCard>",
  ")",
].join("\n")

test("every region is listed with its element, reason and libraries", () => {
  const uses = fragmentUsesOf(SOURCE, "a.tsx")
  assert.deepEqual(uses.map(({ line, reason, libraries }) => ({ line, reason, libraries })), [
    { line: 7, reason: "workflow graph", libraries: ["@xyflow/react"] },
    { line: 8, reason: "art", libraries: [] },
    { line: 9, reason: null, libraries: [] },
  ])
})

test("a file that does not import Fragment from the Grammar lists nothing", () => {
  assert.deepEqual(fragmentUsesOf("const Fragment = () => null\nexport const A = () => <Fragment reason=\"x\" />", "a.tsx"), [])
  assert.deepEqual(fragmentUsesOf("export const A = () => null", "a.tsx"), [])
})

const root = mkdtempSync(join(tmpdir(), "fragment-inventory-"))
after(() => rmSync(root, { recursive: true, force: true }))

test("a folder is scanned, dependencies and specs aside, and the report is information", () => {
  mkdirSync(join(root, "src"))
  mkdirSync(join(root, "node_modules"))
  writeFileSync(join(root, "src", "a.tsx"), SOURCE)
  writeFileSync(join(root, "src", "a.spec.tsx"), SOURCE)
  writeFileSync(join(root, "node_modules", "b.tsx"), SOURCE)
  const uses = fragmentInventory(root)
  assert.equal(uses.length, 3)
  assert.ok(uses.every((use) => use.file === "src/a.tsx"))
  const text = formatFragmentInventory(uses)
  assert.match(text, /^Fragment inventory: 3 regions in 1 file \(information, not findings\)/u)
  assert.match(text, /src\/a\.tsx:7:5 {2}"workflow graph" {2}\[@xyflow\/react\]/u)
  assert.match(formatFragmentInventory([]), /0 regions in 0 files/u)
})

test("the Grammar's Fragment is followed through its alias; React's Fragment and <> are not regions", () => {
  const aliased = [
    "import { Fragment } from \"react\"",
    "import { Fragment as GrammarFragment } from \"@starci/grammar\"",
    "export const A = () => <Fragment><GrammarFragment reason=\"graph\" /><></></Fragment>",
  ].join("\n")
  assert.deepEqual(fragmentUsesOf(aliased, "a.tsx").map(({ line, reason }) => ({ line, reason })), [{ line: 3, reason: "graph" }])
  assert.deepEqual(fragmentUsesOf("import { Fragment } from \"react\"\nexport const A = () => <Fragment reason=\"x\" />", "a.tsx"), [])
})
