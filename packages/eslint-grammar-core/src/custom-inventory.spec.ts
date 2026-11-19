/**
 * The Custom inventory lists every `<Custom reason="...">` region as information: positions, `as`, reasons and the libraries used.
 *
 *   node --test src/custom-inventory.spec.ts
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"
import { customInventory, customUsesOf, formatCustomInventory } from "./lib/custom-inventory.ts"

const SOURCE = [
  "import { Custom, SurfaceCard } from \"@starci/grammar/core\"",
  "import * as G from \"@starci/grammar/core\"",
  "import { ReactFlow } from \"@xyflow/react\"",
  "import { helper } from \"./helper\"",
  "export const A = () => (",
  "  <SurfaceCard>",
  "    <Custom reason=\"workflow graph\" as=\"section\"><ReactFlow />{helper()}</Custom>",
  "    <G.Custom reason={`art`} />",
  "    <Custom />",
  "  </SurfaceCard>",
  ")",
].join("\n")

test("every region is listed with its element, reason and libraries", () => {
  const uses = customUsesOf(SOURCE, "a.tsx")
  assert.deepEqual(uses.map(({ line, as, reason, libraries }) => ({ line, as, reason, libraries })), [
    { line: 7, as: "section", reason: "workflow graph", libraries: ["@xyflow/react"] },
    { line: 8, as: "div", reason: "art", libraries: [] },
    { line: 9, as: "div", reason: null, libraries: [] },
  ])
})

test("a file that does not import Custom from the Grammar lists nothing", () => {
  assert.deepEqual(customUsesOf("const Custom = () => null\nexport const A = () => <Custom reason=\"x\" />", "a.tsx"), [])
  assert.deepEqual(customUsesOf("export const A = () => null", "a.tsx"), [])
})

const root = mkdtempSync(join(tmpdir(), "custom-inventory-"))
after(() => rmSync(root, { recursive: true, force: true }))

test("a folder is scanned, dependencies and specs aside, and the report is information", () => {
  mkdirSync(join(root, "src"))
  mkdirSync(join(root, "node_modules"))
  writeFileSync(join(root, "src", "a.tsx"), SOURCE)
  writeFileSync(join(root, "src", "a.spec.tsx"), SOURCE)
  writeFileSync(join(root, "node_modules", "b.tsx"), SOURCE)
  const uses = customInventory(root)
  assert.equal(uses.length, 3)
  assert.ok(uses.every((use) => use.file === "src/a.tsx"))
  const text = formatCustomInventory(uses)
  assert.match(text, /^Custom inventory: 3 regions in 1 file \(information, not findings\)/u)
  assert.match(text, /src\/a\.tsx:7:5 {2}<section> {2}"workflow graph" {2}\[@xyflow\/react\]/u)
  assert.match(formatCustomInventory([]), /0 regions in 0 files/u)
})
