/** Regression proof for app composition of Grammar surface context and panel lists. */
// proves: FE_NESTED_VARIANT@lite
// proves: FE_NESTED_VARIANT@full
// proves: FE_LIST_PANEL_PADDING@lite
// proves: FE_LIST_PANEL_PADDING@full
// proves: FE_GRAMMAR_LAYOUT_ONLY@lite
// proves: FE_GRAMMAR_LAYOUT_ONLY@full
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ESLint, RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { nestedControlVariant, noListPanelPadding, noAppSurfacePaint, recommended, rules } from "./surface-rules.mjs"
import { why } from "./lib/why.mjs"

const tester = () => new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } })
const grammar = 'import { SurfaceCard, SearchField, ListBox } from "@starci/grammar/core"; '
const variant = { messageId: "variant" }
const tabs = { messageId: "tabs" }
const surface = { messageId: "surface" }
const padding = { messageId: "padding" }

test("surface rules are published at error with their canon finding codes", () => {
  for (const name of Object.keys(rules)) assert.equal(recommended[`starci-fe/${name}`], "error")
  assert.equal(why["nested-control-variant"].code, "FE_NESTED_VARIANT")
  assert.equal(why["no-list-panel-padding"].code, "FE_LIST_PANEL_PADDING")
  assert.equal(why["no-app-surface-paint"].code, "FE_GRAMMAR_LAYOUT_ONLY")
})

for (const edition of ["lite", "full"]) {
  test(`ANATOMY-2 ${edition}: valid context defaults pass and invalid app field variants are rejected across component boundaries`, () => {
    tester().run("nested-control-variant", nestedControlVariant, {
      valid: [
        grammar + 'const Page = () => <SearchField />',
        grammar + 'const Page = () => <SurfaceCard><SearchField /></SurfaceCard>',
        'import { SearchField } from "another-kit"; const Page = () => <SearchField variant="primary" />',
        grammar + 'const Page = ({ SearchField }) => <SurfaceCard><SearchField variant="primary" /></SurfaceCard>',
        'import * as G from "other-kit"; const Page = () => <G.SearchField variant="primary" />',
        grammar + 'const Page = ({ variant }) => <SearchField variant={variant} />',
        grammar + 'const Page = () => <SearchField variant={`primary${suffix}`} />',
        grammar + 'const dynamic = () => "secondary"; const Page = () => <SearchField variant={dynamic()} />',
      ],
      invalid: [
        { code: grammar + 'const Page = () => <SearchField variant="secondary" />', errors: [variant] },
        { code: grammar + 'const Child = () => <SearchField variant="primary" />; const Page = () => <SurfaceCard><Child /></SurfaceCard>', errors: [variant] },
        { code: grammar + 'const helper = () => <SearchField variant="secondary" />; const Page = () => <SurfaceCard>{helper()}</SurfaceCard>', errors: [variant] },
        { code: grammar + 'const Page = ({ SurfaceCard }) => <SurfaceCard><SearchField variant="primary" /></SurfaceCard>', errors: [variant] },
        { code: grammar + 'const Page = () => <SurfaceCard>{rows.map(row => <SearchField key={row.id} variant="primary" />)}</SurfaceCard>', errors: [variant] },
        { code: 'import { SearchField as Search } from "@starci/grammar/heritage"; const Page = () => <Search variant="primary" />', errors: [variant] },
        { code: 'import * as G from "@starci/grammar/core"; const Page = () => <G.SearchField variant="secondary" />', errors: [variant] },
        { code: grammar + 'const choice = "secondary"; const Page = () => <SearchField variant={choice} />', errors: [variant] },
        { code: grammar + 'const Page = () => <SearchField variant={active ? "secondary" : "primary"} />', errors: [variant] },
        { code: grammar + 'const props = { variant: "primary" }; const Page = () => <SearchField {...props} />', errors: [variant] },
        { code: grammar + 'const Page = () => <SearchField {...{variant: "secondary"}} />', errors: [variant] },
        { code: grammar + 'const Page=()=> <SearchField variant={"primary" && "secondary"} />', errors: [variant] },
        { code: grammar + 'import {memo} from "react"; const Page=()=> <SurfaceCard><Host component={memo(function Child(){return <SearchField variant="primary" />})} /></SurfaceCard>', errors: [variant] },
        { code: grammar + 'import * as React from "react"; const Page=()=> <SurfaceCard><Host component={React.forwardRef(function Child(){return <SearchField variant="primary" />})} /></SurfaceCard>', errors: [variant] },
      ],
    })
  })
}

for (const Field of ["Input", "TextField", "Textarea", "TextArea", "SearchField", "NumberField", "DateField", "TimeField", "Select", "ComboBox", "DatePicker", "DateRangePicker", "Checkbox", "CheckboxGroup", "RadioGroup", "PressableField", "OtpInput"]) {
  test(`ANATOMY-2: ${Field} cannot force a static variant on either layer`, () => {
    tester().run("nested-control-variant", nestedControlVariant, {
      valid: [`import { ${Field} } from "@starci/grammar/core"; const Page = () => <${Field} />`],
      invalid: [
        { code: `import { SurfaceCard, ${Field} } from "@starci/grammar/core"; const Page = () => <SurfaceCard><${Field} variant="primary" /></SurfaceCard>`, errors: [variant] },
        { code: `import { ${Field} as Field } from "@starci/grammar/core"; const Page = () => <Field variant="secondary" />`, errors: [variant] },
      ],
    })
  })
}

for (const Surface of ["SurfaceCard", "SurfaceListCard", "Sidebar", "Drawer", "Dialog", "AlertDialog", "Popover", "TopBar", "NavigationFeatureNav"]) {
  test(`ANATOMY-2: Tabs uses the ${Surface} surface context`, () => {
    tester().run("nested-control-variant", nestedControlVariant, {
      valid: [`import { ${Surface}, Tabs } from "@starci/grammar/core"; const Page = () => <${Surface}><Tabs /></${Surface}>`],
      invalid: [{ code: `import { ${Surface}, Tabs } from "@starci/grammar/core"; const Page = () => <${Surface}><Tabs variant="primary" /></${Surface}>`, errors: [tabs] }],
    })
  })
}

test("ANATOMY-2: Tabs distinguishes painted slots, transparent containers and overlay triggers", () => {
  const imports = 'import { WorkspaceShell, TopBar, NavigationFeatureNav, Rail, ChatWorkspace, SurfaceAccordionCard, Dialog, Tabs } from "@starci/grammar/core"; '
  tester().run("nested-control-variant", nestedControlVariant, {
    valid: [
      imports + 'const Page=()=> <Tabs variant="primary" />',
      imports + 'const Page=()=> <Rail><Tabs variant="primary" /></Rail>',
      imports + 'const Page=()=> <SurfaceAccordionCard><Tabs variant="primary" /></SurfaceAccordionCard>',
      imports + 'const Page=()=> <WorkspaceShell primary={<Tabs variant="primary" />} />',
      imports + 'const Page=()=> <ChatWorkspace rail={<Tabs variant="primary" />} />',
      imports + 'const Page=()=> <Dialog trigger={<Tabs variant="primary" />}><Tabs /></Dialog>',
      imports + 'const Page=()=> <TopBar actions={<Tabs variant="secondary" />} />',
    ],
    invalid: [
      { code: imports + 'const Page=()=> <WorkspaceShell header={<Tabs variant="primary" />} />', errors: [tabs] },
      { code: imports + 'const Page=()=> <TopBar actions={<Tabs variant="primary" />} />', errors: [tabs] },
      { code: imports + 'const Page=()=> <NavigationFeatureNav primary={<Tabs variant="primary" />} />', errors: [tabs] },
      { code: imports + 'const Page=()=> <SurfaceAccordionCard depth="top"><Tabs variant="primary" /></SurfaceAccordionCard>', errors: [tabs] },
    ],
  })
})

for (const edition of ["lite", "full"]) {
  test(`layout-only ${edition}: valid layout passes and invalid raw surface paint is refused`, () => {
  tester().run("no-app-surface-paint", noAppSurfacePaint, {
    valid: [
      'const Page = () => <div className="flex gap-2 w-full" />',
      'const label = "bg-surface"',
      'const Page = () => <div className="bg-surfaceish" />',
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
    ],
  })
})
}

for (const edition of ["lite", "full"]) {
  test(`PADDING-0 ${edition}: valid page gutters pass and invalid padding within the nearest painted surface is rejected`, () => {
    tester().run("no-list-panel-padding", noListPanelPadding, {
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
    })
  })
}

test("typed app lint follows imported colocated class declarations for panel padding and surface paint", async () => {
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
    ].join("\n"))
    const cases = [
      { code: grammar + 'import { styles } from "./classNames"; const Page = () => <SurfaceCard><div className={styles.list}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: grammar + 'import { styles } from "./classNames"; const Page = () => <div className={styles.raw} />', ids: ["surface"] },
      { code: grammar + 'import { primary } from "./classNames"; const Page = () => <SurfaceCard><SearchField variant={primary} /></SurfaceCard>', ids: ["variant"] },
      { code: grammar + 'import { styles, secondary } from "./classNames"; const Page = () => <SurfaceCard><SearchField variant={secondary} /><div className={styles.clean}><ListBox /></div></SurfaceCard>', ids: [] },
      { code: grammar + 'import { template } from "./classNames"; const Page = () => <div className={template} />', ids: ["surface"] },
      { code: grammar + 'import * as C from "./classNames"; const Page = () => <SurfaceCard><div className={C.styles["list"]}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: grammar + 'import { listProps } from "./classNames"; const Page=()=> <SurfaceCard><div {...listProps}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: grammar + 'import { fieldProps } from "./classNames"; const Page=()=> <SurfaceCard><SearchField {...fieldProps} /></SurfaceCard>', ids: ["variant"] },
      { code: grammar + 'import { cleanProps, secondaryProps } from "./classNames"; const Page=()=> <SurfaceCard><div {...cleanProps}><ListBox /></div><SearchField {...secondaryProps} /></SurfaceCard>', ids: ["variant"] },
      { code: grammar + 'import { styles } from "./classNames"; const {clean:alias}=styles; const Page=()=> <div className={alias}><ListBox /></div>', ids: [] },
      { code: grammar + 'import { styles } from "./classNames"; const {list:alias}=styles; const Page=()=> <SurfaceCard><div className={alias}><ListBox /></div></SurfaceCard>', ids: ["padding"] },
      { code: grammar + 'import { comparedProps } from "./classNames"; const Page=()=> <SurfaceCard><SearchField {...comparedProps} /></SurfaceCard>', ids: ["variant"] },
    ]
    for (let index = 0; index < cases.length; index++) writeFileSync(join(root, `Page${index}.tsx`), cases[index].code)
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [{
      files: ["**/*.tsx"],
      languageOptions: { parser: tsParser, parserOptions: { project: join(root, "tsconfig.json"), tsconfigRootDir: root, ecmaFeatures: { jsx: true } } },
      plugins: { surface: { rules } },
      rules: Object.fromEntries(Object.keys(rules).map((name) => [`surface/${name}`, "error"])),
    }] })
    for (let index = 0; index < cases.length; index++) {
      const [result] = await eslint.lintFiles([join(root, `Page${index}.tsx`)])
      assert.deepEqual(result.messages.map((message) => message.messageId), cases[index].ids, cases[index].code)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
