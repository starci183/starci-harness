/**
 * Twin tests for the pane laws (R345 to R348): a PaneGrid holds Panes, a Pane holds PaneSections, a section's outermost
 * elements carry no padding or margin utility, and a PaneGrid stands in `Page chrome="panes"` or in a Pane.
 *
 *   node --test src/pane.spec.ts
 */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ESLint } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { why } from "./lib/why.ts"
import { noPaneSectionPadding, paneChildren, paneGridChildren, paneGridPage, recommended, rules } from "./pane.ts"

const BLOCK = at("apps/web/src/components/blocks/Category/component.tsx")
const SCRIPT = at("scripts/render.tsx")
const IMPORTS =
  "import { Freestyle, FillViewport, Divider, Page, Pane, PaneGrid, PaneSection, SearchField, SurfaceCard } from \"@starci/grammar/core\"\n" +
  "import { CategoryPane } from \"./CategoryPane\"\n"

test("the law publishes four rules, each an error, each with its failure code", () => {
  assert.deepEqual(Object.keys(rules), ["pane-grid-children", "pane-children", "no-pane-section-padding", "pane-grid-page"])
  for (const name of Object.keys(rules)) assert.equal(recommended[`starci-grammar/${name}`], "error")
  assert.equal(why["pane-grid-children"]?.code, "FE_PANE_GRID_CHILD_NOT_PANE")
  assert.equal(why["pane-children"]?.code, "FE_PANE_CHILD_NOT_SECTION")
  assert.equal(why["no-pane-section-padding"]?.code, "FE_PANE_SECTION_PADDING")
  assert.equal(why["pane-grid-page"]?.code, "FE_PANE_GRID_FRAME")
})

test("R345: a PaneGrid child is a Pane element", () => {
  slotTester().run("pane-grid-children", paneGridChildren, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a b\"] }}><Pane area=\"a\"><PaneSection><SearchField /></PaneSection></Pane><Pane area=\"b\" /></PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a b\"] }}><Pane area=\"a\" />{p.open ? <Pane area=\"b\" /> : null}</PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a b\"] }}><Pane area=\"a\" />{p.open && <Pane area=\"b\" />}</PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.items.map((item) => <Pane key={item.id} area=\"a\" />)}</PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.items.map((item) => { if (item.hidden) return null; return <Pane key={item.id} area=\"a\" /> })}</PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.open ? <Pane area=\"a\" /> : p.other ? <Pane area=\"a\" /> : false}</PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a\"] }}>{/* the only pane */}<Pane area=\"a\" /></PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <G.PaneGrid areas={{ base: [\"a\"] }}><G.Pane area=\"a\" /></G.PaneGrid>" },
      // a Pane inside a Pane's own nested grid is that grid's child, judged on its own
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a\"] }}><Pane area=\"a\" inset=\"flush\"><PaneGrid areas={{ base: [\"b\"] }}><Pane area=\"b\" /></PaneGrid></Pane></PaneGrid>" },
      // a Freestyle subtree is the app's own: its raw wrapper is not judged
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"legacy canvas\"><PaneGrid areas={{ base: [\"a\"] }}><div /></PaneGrid></Freestyle>" },
      // another element's children are not a grid's
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><CategoryPane /></div>" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a\"] }}><CategoryPane /></PaneGrid>" },
    ],
    invalid: [
      // the CategoryPane wrapper PaneGrid dropped: a blank pane
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"list main\"] }}><Pane area=\"list\" /><CategoryPane area=\"main\" /></PaneGrid>", errors: [{ messageId: "notPane", data: { what: "`<CategoryPane>`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a\"] }}><div /></PaneGrid>", errors: [{ messageId: "notPane", data: { what: "`<div>`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a b\"] }}><><Pane area=\"a\" /><Pane area=\"b\" /></></PaneGrid>", errors: [{ messageId: "notPane", data: { what: "A fragment" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.pane}</PaneGrid>", errors: [{ messageId: "notPane", data: { what: "An expression" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{renderPanes(p)}</PaneGrid>", errors: [{ messageId: "notPane" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.open ? <CategoryPane /> : null}</PaneGrid>", errors: [{ messageId: "notPane" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.open && <CategoryPane />}</PaneGrid>", errors: [{ messageId: "notPane" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.items.map((item) => <CategoryPane key={item.id} />)}</PaneGrid>", errors: [{ messageId: "notPane" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.items.map((item) => { return <div key={item.id} /> })}</PaneGrid>", errors: [{ messageId: "notPane" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneGrid areas={{ base: [\"a\"] }}>{p.items.map(renderPane)}</PaneGrid>", errors: [{ messageId: "notPane" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a\"] }}><SurfaceCard label=\"x\" /></PaneGrid>", errors: [{ messageId: "notPane", data: { what: "`<SurfaceCard>`" } }] },
    ],
  })
})

test("R346: a Pane holds PaneSections or one PaneGrid", () => {
  slotTester().run("pane-children", paneChildren, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"a\"><PaneSection><SearchField /></PaneSection><PaneSection grow scroll={{ label: \"x\" }}><div /></PaneSection></Pane>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"a\" inset=\"flush\"><PaneGrid areas={{ base: [\"b\"] }}><Pane area=\"b\" /></PaneGrid></Pane>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Pane area=\"a\">{p.head ? <PaneSection align=\"center\" /> : null}{p.open && <PaneSection />}{p.rows.map((row) => <PaneSection key={row.id} />)}</Pane>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"a\"><><PaneSection /><PaneSection /></></Pane>" },
      // a project component is judged in its own file
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"a\"><CategoryPane /></Pane>" },
      // an expression this rule cannot follow is judged where it is built
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Pane area=\"a\">{p.sections}</Pane>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><SearchField /></div>" },
      // the Freestyle region is the escape hatch, with its own reason law
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"a\"><Freestyle reason=\"brand art\"><div /></Freestyle></Pane>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"legacy\"><Pane area=\"a\"><div /></Pane></Freestyle>" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <Pane area=\"a\"><div /></Pane>" },
    ],
    invalid: [
      // the nivo shape: the search bar hand-wrapped in a band
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"list\"><div className=\"shrink-0 px-4 pt-3 pb-2\"><SearchField label=\"Search\" /></div></Pane>", errors: [{ messageId: "notSection", data: { what: "The raw `<div>`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"list\"><SearchField label=\"Search\" /></Pane>", errors: [{ messageId: "notSection", data: { what: "The Grammar component `<SearchField>`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"list\"><PaneSection /><Divider /></Pane>", errors: [{ messageId: "notSection" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Pane area=\"list\">{p.open ? <section /> : null}</Pane>", errors: [{ messageId: "notSection" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Pane area=\"list\">{p.rows.map((row) => <li key={row.id} />)}</Pane>", errors: [{ messageId: "notSection" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"list\"><><SearchField /><PaneSection /></></Pane>", errors: [{ messageId: "notSection" }] },
      { filename: BLOCK, code: IMPORTS + "import * as G from \"@starci/grammar/core\"\nexport const A = () => <Pane area=\"list\"><G.SearchField /></Pane>", errors: [{ messageId: "notSection" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"list\"><Freestyle reason=\"x\"><div /></Freestyle><div /></Pane>", errors: [{ messageId: "notSection" }] },
    ],
  })
})

test("R347: a PaneSection's outermost elements carry no padding or margin utility", () => {
  slotTester().run("no-pane-section-padding", noPaneSectionPadding, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><SearchField /></PaneSection>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection gap=\"section\"><div className=\"flex min-w-0 items-center gap-2\"><span /></div></PaneSection>" },
      // padding on an element inside the outermost one is the box's own anatomy
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"flex\"><div className=\"px-3 py-2\" /></div></PaneSection>" },
      // zero and auto reset or place; they inset nothing
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"mx-auto max-w-4xl p-0 sm:mt-auto\" /></PaneSection>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"[margin:0] [padding-inline:0px]\" /></PaneSection>" },
      // a class that only looks like a spacing utility
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"pointer-events-none placeholder-muted min-w-0\" /></PaneSection>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneSection>{p.open ? <div className=\"gap-2\" /> : null}</PaneSection>" },
      // a component of the file whose root is clean
      { filename: BLOCK, code: IMPORTS + "const Head = () => <div className=\"flex items-center\" />\nexport const A = () => <PaneSection><Head /></PaneSection>" },
      // a component of another file is judged there
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><CategoryPane className=\"gap-2\" /></PaneSection>" },
      // the padding is outside any section
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div className=\"px-4\"><SearchField /></div>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"legacy band\"><PaneSection><div className=\"px-4\" /></PaneSection></Freestyle>" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <PaneSection><div className=\"px-4\" /></PaneSection>" },
    ],
    invalid: [
      // the nivo shape: a hand-built band around the search field
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"shrink-0 px-4 pt-3 pb-2\"><SearchField label=\"Search\" /></div></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className={\"p-4\"} /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className={`flex ${\"mt-3\"}`} /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"sm:px-6 flex\" /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"!pb-2\" /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"-mx-4\" /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"[padding-inline:1rem]\" /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><div className=\"[margin-top:12px]\" /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneSection><div className={cn(\"flex\", p.dense && \"py-2\")} /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneSection><div className={p.dense ? \"px-2\" : \"px-4\"} /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "const BAND = \"px-4 py-3\"\nexport const A = () => <PaneSection><div className={BAND} /></PaneSection>", errors: [{ messageId: "padding" }] },
      // a Grammar component's own className is an outer inset too
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><SearchField className=\"mx-3\" /></PaneSection>", errors: [{ messageId: "padding" }] },
      // through a conditional, a map and a fragment
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneSection>{p.open ? <div className=\"px-4\" /> : null}</PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <PaneSection>{p.rows.map((row) => <div key={row.id} className=\"px-4\" />)}</PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneSection><><div className=\"px-4\" /></></PaneSection>", errors: [{ messageId: "padding" }] },
      // a component of the file, returned as a section child: its root is the section's outermost element
      { filename: BLOCK, code: IMPORTS + "const Head = () => <div className=\"px-4 py-3\"><SearchField /></div>\nexport const A = () => <PaneSection><Head /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "function Head() { return <div className=\"px-4\" /> }\nexport const A = () => <PaneSection><Head /></PaneSection>", errors: [{ messageId: "padding" }] },
      { filename: BLOCK, code: IMPORTS + "const Head = () => { if (x) return null; return <div className=\"pt-2\" /> }\nexport const A = () => <PaneSection><Head /></PaneSection>", errors: [{ messageId: "padding" }] },
      // one finding per element, however many sections reach it
      { filename: BLOCK, code: IMPORTS + "const Head = () => <div className=\"px-4\" />\nexport const A = () => <><PaneSection><Head /></PaneSection><PaneSection><Head /></PaneSection></>", errors: [{ messageId: "padding" }] },
    ],
  })
})

test("R348: a PaneGrid stands in Page chrome=\"panes\" or in a Pane", () => {
  slotTester().run("pane-grid-page", paneGridPage, {
    valid: [
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Page chrome=\"panes\" header={{ title: \"x\" }}><PaneGrid areas={{ base: [\"a\"] }}><Pane area=\"a\" /></PaneGrid></Page>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Page chrome={'panes'}><PaneGrid areas={{ base: [\"a\"] }} /></Page>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Page chrome={`panes`}>{<PaneGrid areas={{ base: [\"a\"] }} />}</Page>" },
      // a grid nested in a pane, directly or inside its sections
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"main\" inset=\"flush\"><PaneGrid areas={{ base: [\"a\"] }}><Pane area=\"a\" /></PaneGrid></Pane>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"main\"><PaneSection><div><PaneGrid areas={{ base: [\"a\"] }} /></div></PaneSection></Pane>" },
      // the frame lives in another file: not judged here
      { filename: BLOCK, code: IMPORTS + "export const A = () => <PaneGrid areas={{ base: [\"a\"] }}><Pane area=\"a\" /></PaneGrid>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <div><PaneGrid areas={{ base: [\"a\"] }} /></div>" },
      // a chrome computed at run time is not judged
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Page chrome={p.chrome}><PaneGrid areas={{ base: [\"a\"] }} /></Page>" },
      { filename: BLOCK, code: IMPORTS + "export const A = (p: P) => <Page {...p}><PaneGrid areas={{ base: [\"a\"] }} /></Page>" },
      // the Freestyle region is the app's own
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Freestyle reason=\"legacy canvas\"><SurfaceCard label=\"x\"><PaneGrid areas={{ base: [\"a\"] }} /></SurfaceCard></Freestyle>" },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"x\"><Freestyle reason=\"legacy canvas\"><PaneGrid areas={{ base: [\"a\"] }} /></Freestyle></SurfaceCard>" },
      { filename: SCRIPT, code: IMPORTS + "export const A = () => <FillViewport><PaneGrid areas={{ base: [\"a\"] }} /></FillViewport>" },
    ],
    invalid: [
      // the nivo shapes: FillViewport wrapping a PaneGrid, a PaneGrid inside a SurfaceCard
      { filename: BLOCK, code: IMPORTS + "export const A = () => <FillViewport><PaneGrid areas={{ base: [\"a\"] }}><Pane area=\"a\" /></PaneGrid></FillViewport>", errors: [{ messageId: "frame", data: { where: "a `FillViewport`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard composition=\"joined\" label=\"x\"><PaneGrid areas={{ base: [\"a\"] }}><Pane area=\"a\" /></PaneGrid></SurfaceCard>", errors: [{ messageId: "frame", data: { where: "a `SurfaceCard`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Page chrome=\"bleed\"><FillViewport bottomInset=\"none\"><PaneGrid areas={{ base: [\"a\"] }} /></FillViewport></Page>", errors: [{ messageId: "frame", data: { where: "a `FillViewport`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Page chrome=\"bleed\"><PaneGrid areas={{ base: [\"a\"] }} /></Page>", errors: [{ messageId: "frame", data: { where: "a `Page chrome=\"bleed\"`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Page header={{ title: \"x\" }}><PaneGrid areas={{ base: [\"a\"] }} /></Page>", errors: [{ messageId: "frame", data: { where: "a `Page` without `chrome=\"panes\"`" } }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Page chrome=\"panes\"><div><PaneGrid areas={{ base: [\"a\"] }} /></div></Page>", errors: [{ messageId: "frame" }] },
      { filename: BLOCK, code: IMPORTS + "export const A = () => <SurfaceCard label=\"x\"><div><PaneGrid areas={{ base: [\"a\"] }} /></div></SurfaceCard>", errors: [{ messageId: "frame" }] },
      // a card inside a pane, around the nested grid
      { filename: BLOCK, code: IMPORTS + "export const A = () => <Pane area=\"a\"><SurfaceCard label=\"x\"><PaneGrid areas={{ base: [\"a\"] }} /></SurfaceCard></Pane>", errors: [{ messageId: "frame" }] },
    ],
  })
})

test("typed lint reads the padding of an imported class constant", async () => {
  const root = mkdtempSync(join(tmpdir(), "starci-pane-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "preserve", strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" }, include: ["*.ts", "*.tsx"] }))
    writeFileSync(join(root, "classNames.ts"), ["export const SEARCH_CLASS_NAME = \"shrink-0 px-4 pt-3 pb-2\"", "export const ROW_CLASS_NAME = \"flex items-center gap-2\""].join("\n"))
    const head = "import { PaneSection } from \"@starci/grammar/core\"\n"
    const cases = [
      { code: head + "import { SEARCH_CLASS_NAME } from \"./classNames\"\nexport const A = () => <PaneSection><div className={SEARCH_CLASS_NAME} /></PaneSection>", ids: ["padding"] },
      { code: head + "import { ROW_CLASS_NAME } from \"./classNames\"\nexport const A = () => <PaneSection><div className={ROW_CLASS_NAME} /></PaneSection>", ids: [] },
    ]
    for (const [index, entry] of cases.entries()) writeFileSync(join(root, `Page${index}.tsx`), entry.code)
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [{
        files: ["**/*.tsx"],
        languageOptions: { parser: tsParser, parserOptions: { project: join(root, "tsconfig.json"), tsconfigRootDir: root, ecmaFeatures: { jsx: true } } },
        settings: { starci: { hfs: { slotOf: () => "fe.components", classify: () => ({ status: "owned", slot: "fe.components" }), tierOf: () => "components" } } },
        plugins: { pane: { rules: { "no-pane-section-padding": noPaneSectionPadding } } },
        rules: { "pane/no-pane-section-padding": "error" },
      }],
    })
    for (const [index, entry] of cases.entries()) {
      const [result] = await eslint.lintFiles([join(root, `Page${index}.tsx`)])
      assert.ok(result)
      assert.deepEqual(result.messages.map((message) => message.messageId), entry.ids, entry.code)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
