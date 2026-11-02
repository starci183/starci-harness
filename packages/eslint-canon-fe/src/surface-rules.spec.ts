/** Regression proof for app composition of Grammar surface context and panel lists. */
// proves: FE_LIST_PANEL_PADDING@lite
// proves: FE_LIST_PANEL_PADDING@full
// proves: FE_HAND_BUILT_PANES@lite
// proves: FE_HAND_BUILT_PANES@full
// proves: FE_TAG_GROUP_SELECTION@lite
// proves: FE_TAG_GROUP_SELECTION@full
// proves: FE_HEADING_ABOVE_CARD@lite
// proves: FE_HEADING_ABOVE_CARD@full
// proves: FE_COMMAND_FILLS_HEADER@lite
// proves: FE_COMMAND_FILLS_HEADER@full
// proves: FE_TABLE_IN_CARD@lite
// proves: FE_TABLE_IN_CARD@full
// proves: FE_GRAMMAR_LAYOUT_ONLY@lite
// proves: FE_GRAMMAR_LAYOUT_ONLY@full
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ESLint, RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { noFillCommandInHeader, noHeadingAboveCard, noSelectableTagGroup, noHandBuiltPanes, noTableInCard, noListPanelPadding, noAppSurfacePaint, recommended, rules } from "./surface-rules.ts"
import { why } from "./lib/why.ts"
import { eslintRule } from "./lib/eslint-boundary.ts"
import { canonTester } from "../fixtures/typed/tester.ts"

const tester = () => canonTester(new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } }))
const grammar = 'import { SurfaceCard, SearchField, ListBox } from "@starci/grammar/core"; '
const surface = { messageId: "surface" }
const padding = { messageId: "padding" }

test("surface rules are published at error with their canon finding codes", () => {
  for (const name of Object.keys(rules)) assert.equal(recommended[`starci-fe/${name}`], "error")
  assert.equal(why["no-list-panel-padding"].code, "FE_LIST_PANEL_PADDING")
  assert.equal(why["no-app-surface-paint"].code, "FE_GRAMMAR_LAYOUT_ONLY")
  assert.equal(why["no-hand-built-panes"].code, "FE_HAND_BUILT_PANES")
  assert.equal(why["no-table-in-card"].code, "FE_TABLE_IN_CARD")
  assert.equal(why["no-heading-above-card"].code, "FE_HEADING_ABOVE_CARD")
  assert.equal(why["no-selectable-tag-group"].code, "FE_TAG_GROUP_SELECTION")
  assert.equal(why["no-fill-command-in-header"].code, "FE_COMMAND_FILLS_HEADER")
})

for (const edition of ["lite", "full"]) {
  test(`layout-only ${edition}: valid layout passes and invalid raw surface paint is refused`, () => {
  assert.doesNotThrow(() => tester().run("no-app-surface-paint", noAppSurfacePaint, {
    valid: [
      'const Page = () => <div className="flex gap-2 w-full" />',
      'const label = "bg-surface"',
      'const Page = () => <div className="surfaceish flex-col text-center text-wrap" />',
      'const Page = () => <div className="grid grid-cols-2 p-4 overflow-hidden [grid-template-columns:1fr_2fr]" />',
      'const Page = () => <div style={{display:"grid",gap:2,width:"100%",textAlign:"center"}} />',
      'const styles={clean:{display:"flex"},dirty:{backgroundColor:"var(--surface)"}}; const {clean:alias}=styles; const Page=()=> <div style={alias} />',
      'const backgroundColor="width"; const Page=()=> <div style={{[backgroundColor]:12}} />',
      'const Page=()=> <div style={color === "red" && {display:"flex"}} />',
      'const Page = () => <div data-theme="bg-surface" />',
      'const styles = {clean:"flex",dirty:"bg-surface"}; const {clean}=styles; const Page=()=> <div className={clean} />',
      'const styles = {clean:"flex",dirty:"bg-surface"}; const {clean:alias}=styles; const Page=()=> <div className={alias} />',
      'const className="title"; const props={[className]:"bg-surface"}; const Page=()=> <div {...props} />',
    ],
    invalid: [
      { code: 'const Page = () => <div className="bg-surface" />', errors: [surface] },
      { code: 'const Page = () => <Panel className="md:dark:!bg-surface/80" />', errors: [surface] },
      { code: 'const Page = () => <div className="[&:hover]:bg-surface!" />', errors: [surface] },
      { code: 'const Page = () => <div className={`flex bg-surface ${extra}`} />', errors: [surface] },
      { code: 'const Page = () => <div className={cn("flex", selected && "bg-surface")} />', errors: [surface] },
      { code: 'const paint = "bg-surface"; const Page = () => <div className={paint} />', errors: [surface] },
      { code: 'const styles = { panel: "dark:bg-surface/50" }; const Page = () => <div className={styles.panel} />', errors: [surface] },
      { code: 'const styles = { panel: "dark:bg-surface/50" }; const Page = () => <div className={styles["panel"]} />', errors: [surface] },
      { code: 'const classes = cva("bg-surface", { variants: { selected: { yes: "bg-surface" } } })', errors: [surface, surface] },
      { code: 'const Page = () => <Panel classNames={{ base: "bg-surface" }} />', errors: [surface] },
      { code: 'const panelClass = cn({ "bg-surface": selected })', errors: [surface] },
      { code: 'const props = { className: "bg-surface" }; const Page = () => <div {...props} />', errors: [surface] },
      { code: 'const Page = () => <div {...{className: "bg-surface"}} />', errors: [surface] },
      { code: 'const styles={clean:"flex",dirty:"bg-surface"}; const {dirty:alias}=styles; const Page=()=> <div className={alias} />', errors: [surface] },
      { code: 'const Page=()=> <div className="md:!bg-surface-secondary/80" />', errors: [surface] },
      { code: 'const Page=()=> <div className="dark:bg-surface-tertiary!" />', errors: [surface] },
      { code: 'const Page=()=> <div className="bg-surface-other" />', errors: [surface] },
      ...["bg-surfaceish", "bg-white", "bg-[var(--surface)]", "bg-(--surface)", "bg-gradient-to-r", "from-white", "via-slate-100", "to-black", "shadow-lg", "shadow-none", "inset-shadow-sm", "ring-2", "ring-slate-500", "inset-ring-1", "outline-hidden", "outline-2", "border", "border-0", "border-t-red-500", "border-[var(--surface)]", "divide-y", "rounded-lg", "text-red-500", "text-[var(--color)]", "text-sm", "font-semibold", "decoration-red-500", "underline", "fill-current", "stroke-2", "accent-blue-500", "caret-red-500", "opacity-50", "mix-blend-multiply", "backdrop-blur-sm", "blur-sm", "drop-shadow-lg", "filter-none", "-hue-rotate-90", "mask-linear-45", "[mask-image:linear-gradient(black,transparent)]", "[background:var(--surface)]", "[box-shadow:var(--shadow)]", "[border-color:var(--line)]", "[color:var(--ink)]", "[text-decoration:underline]", "[-webkit-text-fill-color:red]", "md:hover:!shadow-md", "[&:hover]:bg-white!"].map((utility) => ({ code: `const Page=()=> <div className="${utility}" />`, errors: [surface] })),
      ...["background", "backgroundColor", "border", "borderTopColor", "borderRadius", "boxShadow", "color", "outlineColor", "fontWeight", "textShadow", "fill", "strokeWidth", "opacity", "filter", "backdropFilter", "mixBlendMode", "maskImage", "letterSpacing", "lineHeight"].map((property) => ({ code: `const Page=()=> <div style={{${property}:value}} />`, errors: [surface] })),
      { code: 'const paint={backgroundColor:"var(--surface)"}; const Page=()=> <div style={paint} />', errors: [surface] },
      { code: 'const paint={boxShadow:"var(--shadow)"}; const Page=()=> <div style={{...paint,display:"flex"}} />', errors: [surface] },
      { code: 'const Page=()=> <div style={active ? {display:"flex"} : {borderColor:"var(--line)"}} />', errors: [surface] },
      { code: 'const Page=()=> <div style={active && {color:ink}} />', errors: [surface] },
      { code: 'const styles={clean:{display:"flex"},dirty:{backgroundColor:"var(--surface)"}}; const {dirty:alias}=styles; const Page=()=> <div style={alias} />', errors: [surface] },
      { code: 'const property="backgroundColor"; const Page=()=> <div style={{[property]:paint}} />', errors: [surface] },
      { code: 'const Page=()=> <div style={{"background-color":"var(--surface)"}} />', errors: [surface] },
      { code: 'const props={style:{backgroundColor:"var(--surface)"}}; const Page=()=> <div {...props} />', errors: [surface] },
      { code: 'const Page=()=> <div {...{style:{boxShadow:shadow}}} />', errors: [surface] },
    ],
  }))
})
}

for (const edition of ["lite", "full"]) {
  test(`PADDING-0 ${edition}: valid page gutters pass and invalid padding within the nearest painted surface is rejected`, () => {
    assert.doesNotThrow(() => tester().run("no-list-panel-padding", noListPanelPadding, {
      valid: [
        grammar + 'const Page = () => <SurfaceCard><ListBox inset="panel" /></SurfaceCard>',
        grammar + 'const Page = () => <SurfaceCard><div className="py-2 gap-2"><ListBox /></div></SurfaceCard>',
        grammar + 'const Page = () => <div className="px-4"><SurfaceCard><ListBox /></SurfaceCard></div>',
        grammar + 'const Page = () => <div className="ps-3"><ListBox /></div>',
        grammar + 'const Page = () => <ListBox className="p-2" />',
        grammar + 'const Page = () => <ListBox.Section header={<div className="px-3">caption</div>} />',
        'import { ListBox } from "other-kit"; const Page = () => <div className="px-2"><ListBox /></div>',
        grammar + 'const Child = () => <ListBox />; const Page = () => <SurfaceCard><div className="px-2"><Child /></div></SurfaceCard>',
        grammar + 'const Page = () => <SurfaceCard><ListBox.Section><ListBox.Item><div className="px-2">row</div></ListBox.Item></ListBox.Section></SurfaceCard>',
        grammar + 'const styles={clean:"py-2",dirty:"px-2"}; const {clean}=styles; const Page=()=> <SurfaceCard><div className={clean}><ListBox /></div></SurfaceCard>',
        grammar + 'const className="title"; const props={[className]:"px-2"}; const Page=()=> <SurfaceCard><div {...props}><ListBox /></div></SurfaceCard>',
        'import { Rail, ListBox } from "@starci/grammar/core"; const Page=()=> <Rail><div className="p-2"><ListBox /></div></Rail>',
      ],
      invalid: [
        ...["p-2", "px-2", "ps-2", "pe-2", "pl-2", "pr-2", "md:pl-2", "[padding-inline:1rem]", "md:[padding-inline-start:1rem]", "[padding-inline-end:1rem]"].map((utility) => ({ code: grammar + `const Page=()=> <SurfaceCard><div className="${utility}"><ListBox /></div></SurfaceCard>`, errors: [padding] })),
        { code: grammar + 'const Page = () => <SurfaceCard><div className={cn("flex", active && "px-2")}><ListBox /></div></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const classes = { list: "px-2" }; const Page = () => <SurfaceCard><div className={classes.list}><ListBox /></div></SurfaceCard>', errors: [padding] },
        { code: 'import { SurfaceCard, ListBox as List } from "@starci/grammar/core"; const Page = () => <SurfaceCard><div className="px-2"><List /></div></SurfaceCard>', errors: [padding] },
        { code: 'import * as G from "@starci/grammar/core"; const Page = () => <G.SurfaceCard><div className="px-2"><G.ListBox /></div></G.SurfaceCard>', errors: [padding] },
        { code: grammar + 'const Page = () => <SurfaceCard><div className="px-2"><ListBox /><ListBox /></div></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const Page = () => <SurfaceCard><ListBox.Section header={<div className="px-3">caption</div>} /></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const Page = () => <SurfaceCard><ListBox.Section><div className="ps-3">caption</div></ListBox.Section></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const Page = () => <SurfaceCard><ListBox className="px-2" /></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const props = { className: "px-2" }; const Page = () => <SurfaceCard><div {...props}><ListBox /></div></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const styles={clean:"py-2",dirty:"px-2"}; const {dirty:alias}=styles; const Page=()=> <SurfaceCard><div className={alias}><ListBox /></div></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const Page=()=> <SurfaceCard><div className="px-2">{rows.map(function RenderRow() { return <ListBox /> })}</div></SurfaceCard>', errors: [padding] },
      ],
    }))
  })
}

test("the typed lint of an app follows imported colocated class declarations for panel padding and surface paint", async () => {
  const root = mkdtempSync(join(tmpdir(), "starci-fe-surface-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "preserve", strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" }, include: ["*.ts", "*.tsx"] }))
    writeFileSync(join(root, "classNames.ts"), [
      'declare function cn(...args: unknown[]): string',
      'declare function alwaysSecondary(value: string): "secondary"',
      'export const styles = { list: cn("flex", "md:px-2"), clean: "py-2", raw: cn("dark:bg-surface/70") }',
      'export const primary = "primary"',
      'export const secondary = alwaysSecondary("primary")',
      'export const template = `flex bg-surface ${true}`',
      'export const listProps = {className: "px-2"}',
      'export const cleanProps = {className: "py-2"}',
      'export const fieldProps = {variant: "primary"}',
      'export const secondaryProps = {variant: "secondary"}',
      'declare const name: string',
      'export const comparedProps = {variant: (name === "primary" && "secondary") || "secondary"}',
      'export const paintStyle = { backgroundColor: "var(--surface)" }',
      'export const numericPaint = { opacity: 0.5 }',
      'export const layoutStyle = { display: "grid", gap: 2 }',
      'export const nestedStyle = { clean: layoutStyle, dirty: { boxShadow: "var(--shadow)" } }',
      'export const styleSpread = { ...numericPaint, width: "100%" }',
      'const paintKey = "borderColor"',
      'export const computedStyle = { [paintKey]: "var(--line)" }',
      'export const paintProps = { style: paintStyle }',
      'export const layoutProps = { style: layoutStyle }',
      'export const classProps = { className: "bg-white" }',
      'export const otherProps = { title: "bg-white" }',
    ].join("\n"))
    const cases = [
      { code: grammar + 'import { styles } from "./classNames"; const Page = () => <SurfaceCard><div className={styles.list}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: grammar + 'import { styles } from "./classNames"; const Page = () => <div className={styles.raw} />', ids: ["surface"] },
      { code: grammar + 'import { styles, secondary } from "./classNames"; const Page = () => <SurfaceCard><SearchField variant={secondary} /><div className={styles.clean}><ListBox /></div></SurfaceCard>', ids: [] },
      { code: grammar + 'import { template } from "./classNames"; const Page = () => <div className={template} />', ids: ["surface"] },
      { code: grammar + 'import * as C from "./classNames"; const Page = () => <SurfaceCard><div className={C.styles["list"]}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: grammar + 'import { listProps } from "./classNames"; const Page=()=> <SurfaceCard><div {...listProps}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: grammar + 'import { styles } from "./classNames"; const {clean:alias}=styles; const Page=()=> <div className={alias}><ListBox /></div>', ids: [] },
      { code: grammar + 'import { styles } from "./classNames"; const {list:alias}=styles; const Page=()=> <SurfaceCard><div className={alias}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: 'import { paintStyle } from "./classNames"; const Page=()=> <div style={paintStyle} />', ids: ["surface"] },
      { code: 'import { numericPaint } from "./classNames"; const Page=()=> <div style={numericPaint} />', ids: ["surface"] },
      { code: 'import { layoutStyle } from "./classNames"; const Page=()=> <div style={layoutStyle} />', ids: [] },
      { code: 'import { nestedStyle } from "./classNames"; const Page=()=> <div style={nestedStyle.clean} />', ids: [] },
      { code: 'import { nestedStyle } from "./classNames"; const Page=()=> <div style={nestedStyle.dirty} />', ids: ["surface"] },
      { code: 'import { nestedStyle } from "./classNames"; const {dirty:alias}=nestedStyle; const Page=()=> <div style={alias} />', ids: ["surface"] },
      { code: 'import { styleSpread } from "./classNames"; const Page=()=> <div style={styleSpread} />', ids: ["surface"] },
      { code: 'import { computedStyle } from "./classNames"; const Page=()=> <div style={computedStyle} />', ids: ["surface"] },
      { code: 'import { paintProps } from "./classNames"; const Page=()=> <div {...paintProps} />', ids: ["surface"] },
      { code: 'import { layoutProps } from "./classNames"; const Page=()=> <div {...layoutProps} />', ids: [] },
      { code: 'import { classProps } from "./classNames"; const Page=()=> <div {...classProps} />', ids: ["surface"] },
      { code: 'import { otherProps } from "./classNames"; const Page=()=> <div {...otherProps} />', ids: [] },
    ]
    for (const [index, entry] of cases.entries()) writeFileSync(join(root, `Page${index}.tsx`), entry.code)
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [{
      files: ["**/*.tsx"],
      languageOptions: { parser: tsParser, parserOptions: { project: join(root, "tsconfig.json"), tsconfigRootDir: root, ecmaFeatures: { jsx: true } } },
      plugins: { surface: { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, eslintRule(rule)])) } },
      rules: Object.fromEntries(Object.keys(rules).map((name) => [`surface/${name}`, "error"])),
    }] })
    for (const [index, entry] of cases.entries()) {
      const [result] = await eslint.lintFiles([join(root, `Page${index}.tsx`)])
      assert.ok(result)
      assert.deepEqual(result.messages.map((message) => message.messageId), entry.ids, entry.code)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const panes = 'import { Divider, Button, Page, Pane, PaneGrid, PaneSection, Section, ListBox, SurfaceCard } from "@starci/grammar/core"; '
const seam = { messageId: "seam" }
const joined = { messageId: "joined" }

test("Pane and PaneSection are surfaces: wrapper padding around a ListBox in a pane is caught in the file", () => {
  assert.doesNotThrow(() => tester().run("no-list-panel-padding", noListPanelPadding, {
    valid: [
      panes + 'const A = () => <Pane area="list"><PaneSection grow><ListBox inset="panel" /></PaneSection></Pane>',
      panes + 'const A = () => <Pane area="list"><PaneSection><div className="flex gap-2"><ListBox /></div></PaneSection></Pane>',
    ],
    invalid: [
      { code: panes + 'const A = () => <Pane area="list"><PaneSection grow><div className="px-4"><ListBox /></div></PaneSection></Pane>', errors: [padding] },
      { code: panes + 'const A = () => <Pane area="list"><div className="px-4"><ListBox /></div></Pane>', errors: [padding] },
    ],
  }))
})

for (const edition of ["lite", "full"]) {
  test(`${edition}: a multi-pane frame is a PaneGrid, not a vertical divider between columns or columns in a joined card`, () => {
    assert.doesNotThrow(() => tester().run("no-hand-built-panes", noHandBuiltPanes, {
      valid: [
        // a PaneGrid draws its own dividers
        panes + 'const A = () => <Page chrome="panes"><PaneGrid areas={{ base: ["rail main"] }}><Pane area="rail" /><Pane area="main" /></PaneGrid></Page>',
        // a short separator between controls of a toolbar is the app's own element
        panes + 'const A = () => <div className="flex items-center gap-2"><Button intent="neutral" /><Divider orientation="vertical" /><Button intent="neutral" /></div>',
        // a horizontal divider stacks bands; a joined card stacks bands
        panes + 'const A = () => <SurfaceCard composition="joined" label="Run"><Divider /><div className="flex flex-col"><div /><div /></div></SurfaceCard>',
        panes + 'const A = () => <SurfaceCard composition="joined" label="Run"><div className="flex items-center gap-2"><Button intent="neutral" /></div></SurfaceCard>',
        // a stack of blocks is not a row of columns, whatever it holds
        panes + 'const A = () => <div className="flex flex-col"><div /><div><Divider orientation="vertical" /></div></div>',
        // a column row in a plain card, not a joined one
        panes + 'const A = () => <SurfaceCard label="Run"><div className="flex"><div /><div /></div></SurfaceCard>',
        // a vertical divider that is not the Grammar's
        'import { Divider } from "other-kit"; const A = () => <SurfaceCard composition="joined"><div className="flex"><div /><Divider orientation="vertical" /><div /></div></SurfaceCard>',
        // a computed orientation is not judged
        panes + 'const A = ({ orientation }) => <div className="flex"><div /><Divider orientation={orientation} /><div /></div>',
        // a row whose classes are no flex row
        panes + 'const A = () => <div className="block"><div /><Divider orientation="vertical" /><div /></div>',
      ],
      invalid: [
        // AgentInstanceFrame: a joined card, a flex row (column below lg, row from lg), a rail, a vertical divider in a wrapper, a main column
        { code: panes + 'const FRAME = cn("flex", "h-full", "min-h-0", "flex-col", "lg:flex-row"); const A = () => <SurfaceCard composition="joined" height="fill"><div className={FRAME}><div className="flex lg:w-72">{rail}</div><div className="max-lg:block lg:hidden"><Divider semantics="presentation" /></div><div className="hidden shrink-0 lg:flex"><Divider orientation="vertical" semantics="presentation" /></div><div className="flex flex-1">{body}</div></div></SurfaceCard>', errors: [joined] },
        // AgentSetupPage: the same split, in the tab body, without the card
        { code: panes + 'const SPLIT = "flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row"; const A = () => <div className={SPLIT} data-bleed><div className="flex min-w-0 flex-col">{chat}</div><div className="xl:hidden"><Divider semantics="presentation" /></div><div className="hidden shrink-0 xl:flex"><Divider orientation="vertical" semantics="presentation" /></div><div className="min-w-0 xl:w-104">{side}</div></div>', errors: [seam] },
        // a divider directly between two columns
        { code: panes + 'const A = () => <div className="flex"><div /><Divider orientation="vertical" /><div /></div>', errors: [seam] },
        { code: panes + 'const A = () => <div className="flex"><aside /><Divider orientation={"vertical"} /><Section label="Main" /></div>', errors: [seam] },
        // AgentChat: a joined card around an aside rail, an optional drawer rail and the Section column
        { code: panes + 'const FRAME = cn("flex", "h-full", "min-h-0", "min-w-0"); const A = () => <SurfaceCard composition="joined" height="fill"><div className={FRAME}><aside aria-label="rail">{rail}</aside>{open ? <aside>{rail}</aside> : null}<Section className="flex flex-1 flex-col" label="Chat">{main}</Section></div></SurfaceCard>', errors: [joined] },
        // ChatbotInboxPanel: a joined card around three panes in a relative flex row, one nested joined card in a pane
        { code: panes + 'const INBOX = "relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"; const A = () => <SurfaceCard composition="joined" height="fill"><div className={INBOX}><div className="w-full md:w-80">{list}</div><div className="min-w-0 flex-1">{thread}</div>{side ? <div className="absolute inset-0 xl:static"><SurfaceCard composition="joined" height="fill">{info}</SurfaceCard></div> : null}</div></SurfaceCard>', errors: [joined] },
        // a vertical divider anywhere in a joined card with no column row of its own
        { code: panes + 'const A = () => <SurfaceCard composition="joined"><Section label="a" /><Divider orientation="vertical" /><Section label="b" /></SurfaceCard>', errors: [seam] },
        { code: panes + 'const A = () => <SurfaceCard composition="joined"><Section label="a" /><Divider orientation="vertical" /></SurfaceCard>', errors: [seam] },
      ],
    }))
  })
}

for (const edition of ["lite", "full"]) {
  test(`${edition}: a DataTable is not placed in a SurfaceCard, here or through a component of the file`, () => {
    const tables = 'import { SurfaceCard, DataTable } from "@starci/grammar/core"; '
    const table = { messageId: "table" }
    assert.doesNotThrow(() => tester().run("no-table-in-card", noTableInCard, {
      valid: [
        // a table in its section, with no card around it
        tables + 'const A = () => <section><DataTable label="Members" columns={c} rows={r} renderCell={f} emptyContent={null} /></section>',
        // plain rows are a list card, the table is not inside a card
        tables + 'const A = () => <SurfaceCard kind="list" label="Rules" footer="Locked" items={rows} empty={null} />',
        // a table in a component no card renders
        tables + 'const T = () => <DataTable label="a" columns={c} rows={r} renderCell={f} emptyContent={null} />; const A = () => <section><T /></section>',
        // a table that is not the Grammar's
        'import { SurfaceCard } from "@starci/grammar/core"; import { DataTable } from "other-kit"; const A = () => <SurfaceCard label="a"><DataTable /></SurfaceCard>',
        // a card beside the table, not around it
        tables + 'const A = () => <section><SurfaceCard label="a">x</SurfaceCard><DataTable label="a" columns={c} rows={r} renderCell={f} emptyContent={null} /></section>',
      ],
      invalid: [
        // PermissionRules: the table between two lines of text in a card
        { code: tables + 'const A = () => <SurfaceCard label="Rules" headingLevel={2}><p>a</p><DataTable label="Rules" columns={c} rows={r} renderCell={f} emptyContent={null} /><p>b</p></SurfaceCard>', errors: [table] },
        // inside a render prop of the card's child
        { code: tables + 'const A = () => <SurfaceCard label="a"><Slot>{(rows) => <DataTable label="a" columns={c} rows={rows} renderCell={f} emptyContent={null} />}</Slot></SurfaceCard>', errors: [table] },
        // BrainAgentView: the table is a component of the file that the card renders
        { code: tables + 'const Matrix = () => <DataTable label="a" columns={c} rows={r} renderCell={f} emptyContent={null} />; export const A = () => <SurfaceCard label="a"><div><Matrix /></div></SurfaceCard>', errors: [table] },
        { code: tables + 'function Matrix() { return <DataTable label="a" columns={c} rows={r} renderCell={f} emptyContent={null} /> } const Inner = () => <Matrix />; export const A = () => <SurfaceCard label="a"><Inner /></SurfaceCard>', errors: [table] },
        // through a namespace import and a wrapped component
        { code: 'import * as G from "@starci/grammar/core"; const M = memo(() => <G.DataTable label="a" columns={c} rows={r} renderCell={f} emptyContent={null} />); export const A = () => <G.SurfaceCard label="a"><M /></G.SurfaceCard>', errors: [table] },
      ],
    }))
    assert.doesNotThrow(() => tester().run("no-table-in-card", noTableInCard, {
      // a component that renders itself terminates
      valid: [tables + 'const R = () => <div><R /><DataTable label="a" columns={c} rows={r} renderCell={f} emptyContent={null} /></div>'],
      invalid: [],
    }))
  })
}

for (const edition of ["lite", "full"]) {
  test(`${edition}: a command in a page or card header hugs its label`, () => {
    const head = 'import { PageHeader, SurfaceCard, Button, Form } from "@starci/grammar/core"; '
    const fill = { messageId: "fill" }
    assert.doesNotThrow(() => tester().run("no-fill-command-in-header", noFillCommandInHeader, {
      valid: [
        head + 'const A = () => <PageHeader title="a" actions={<Button intent="commit">Add</Button>} />',
        head + 'const A = () => <SurfaceCard label="a" labelEnd={<Button intent="neutral" width="content">Edit</Button>} />',
        // a fill button in a form, a card body or a phone action bar is not a header command
        head + 'const A = () => <Form><Button intent="commit" width="fill" type="submit">Save</Button></Form>',
        head + 'const A = () => <SurfaceCard label="a"><Button intent="commit" width="fill">Continue</Button></SurfaceCard>',
        'import { Button } from "other-kit"; const A = () => <PageHeader title="a" actions={<Button width="fill" />} />',
      ],
      invalid: [
        { code: head + 'const A = () => <PageHeader title="a" actions={<Button intent="commit" width="fill">Add</Button>} />', errors: [fill] },
        { code: head + 'const A = () => <SurfaceCard label="a" labelEnd={<Button intent="neutral" width="fill">Edit</Button>} />', errors: [fill] },
        { code: head + 'const A = () => <SurfaceCard kind="list" label="a" labelEnd={<div><Button width={"fill"}>Add</Button></div>} items={[]} empty={null} />', errors: [fill] },
      ],
    }))
  })
}

for (const edition of ["lite", "full"]) {
  test(`${edition}: a TagGroup has no selection, a filter is a FilterButtonGroup`, () => {
    const head = 'import { TagGroup, FilterButtonGroup } from "@starci/grammar/core"; '
    const selection = { messageId: "selection" }
    assert.doesNotThrow(() => tester().run("no-selectable-tag-group", noSelectableTagGroup, {
      valid: [
        head + 'const A = () => <TagGroup label="Topics" items={items} onRemove={remove} removeLabel={name} />',
        head + 'const A = () => <FilterButtonGroup label="Team" options={options} onValueChange={set} />',
        'import { TagGroup } from "other-kit"; const A = () => <TagGroup selectionMode="single" />',
      ],
      invalid: [
        { code: head + 'const A = () => <TagGroup label="Filter" items={items} selectionMode="single" />', errors: [selection] },
        { code: head + 'const A = () => <TagGroup label="Filter" items={items} selectedIds={ids} onSelectionChange={set} />', errors: [selection, selection] },
      ].map((entry) => ({ ...entry })),
    }))
  })
}

for (const edition of ["lite", "full"]) {
  test(`${edition}: a card has its own label, a Section around a single card is refused`, () => {
    const head = 'import { Section, SurfaceCard, Text } from "@starci/grammar/core"; '
    const header = { messageId: "header" }
    const name = { messageId: "name" }
    assert.doesNotThrow(() => tester().run("no-heading-above-card", noHeadingAboveCard, {
      valid: [
        // the card carries the title
        head + 'const A = () => <div><SurfaceCard label="Rules" fact="3" labelEnd={<b />}>x</SurfaceCard></div>',
        // several cards under one Section stay legal
        head + 'const A = () => <Section title="Team"><SurfaceCard label="a">x</SurfaceCard><SurfaceCard label="b">y</SurfaceCard></Section>',
        // a Section around something that is not a card
        head + 'const A = () => <Section title="Team"><Text>hello</Text></Section>',
        // the cards name themselves differently from the Section
        head + 'const A = () => <Section title="Team"><SurfaceCard ariaLabel="Members">x</SurfaceCard><SurfaceCard ariaLabel="Roles">y</SurfaceCard></Section>',
        // a Section with other content beside its card
        head + 'const A = () => <Section title="Team"><Text>note</Text><SurfaceCard label="a">x</SurfaceCard></Section>',
        // a list Section holds rows, not cards
        head + 'const A = () => <Section kind="list" title="Team" items={items} empty={null} />',
        'import { Section } from "other-kit"; import { SurfaceCard } from "@starci/grammar/core"; const A = () => <Section title="a"><SurfaceCard label="a">x</SurfaceCard></Section>',
      ],
      invalid: [
        { code: head + 'const A = () => <Section title="Rules"><SurfaceCard label="Rules">x</SurfaceCard></Section>', errors: [header] },
        { code: head + 'const A = () => <Section title={t("rules")} action={<b />}><SurfaceCard kind="list" ariaLabel={t("rules")} items={[]} empty={null} /></Section>', errors: [header, name] },
        { code: head + 'const A = () => <Section title="Rules"><SurfaceCard kind="accordion" ariaLabel="Other" items={[]} onItemOpenChange={noop} /></Section>', errors: [header] },
        // a repeated name is refused even under several cards
        { code: head + 'const A = () => <Section title="Rules"><SurfaceCard ariaLabel="Rules">x</SurfaceCard><SurfaceCard label="b">y</SurfaceCard></Section>', errors: [name] },
      ],
    }))
  })
}

