/** Regression proof for app composition of Grammar surface context and panel lists. */
// proves: FE_NESTED_VARIANT@lite
// proves: FE_NESTED_VARIANT@full
// proves: FE_LIST_PANEL_PADDING@lite
// proves: FE_LIST_PANEL_PADDING@full
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ESLint, RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { nestedControlVariant, noListPanelPadding, recommended, rules } from "./surface-rules.mjs"
import { why } from "./lib/why.mjs"

const tester = () => new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } })
const grammar = 'import { SurfaceCard, SearchField, ListBox } from "@starci/grammar/core"; '
const primary = { messageId: "primary" }
const surface = { messageId: "surface" }
const padding = { messageId: "padding" }

test("surface rules are published at error with their canon finding codes", () => {
  for (const name of Object.keys(rules)) assert.equal(recommended[`starci-fe/${name}`], "error")
  assert.equal(why["nested-control-variant"].code, "FE_NESTED_VARIANT")
  assert.equal(why["no-list-panel-padding"].code, "FE_LIST_PANEL_PADDING")
})

for (const edition of ["lite", "full"]) {
  test(`ANATOMY-2 ${edition}: valid nesting passes and invalid primary variants are rejected`, () => {
    tester().run("nested-control-variant", nestedControlVariant, {
      valid: [
        grammar + 'const Page = () => <SearchField variant="primary" />',
        grammar + 'const Page = () => <SurfaceCard><SearchField /></SurfaceCard>',
        grammar + 'const Page = () => <SurfaceCard><SearchField variant="secondary" /></SurfaceCard>',
        grammar + 'const Child = () => <SearchField variant="primary" />; const Page = () => <SurfaceCard><Child /></SurfaceCard>',
        'import { SurfaceCard, SearchField } from "another-kit"; const Page = () => <SurfaceCard><SearchField variant="primary" /></SurfaceCard>',
        grammar + 'const Page = ({ SearchField }) => <SurfaceCard><SearchField variant="primary" /></SurfaceCard>',
        grammar + 'const Page = ({ SurfaceCard }) => <SurfaceCard><SearchField variant="primary" /></SurfaceCard>',
        'import * as G from "other-kit"; const Page = () => <G.SurfaceCard><G.SearchField variant="primary" /></G.SurfaceCard>',
        'import { Dialog, SearchField } from "@starci/grammar/core"; const Page = () => <Dialog trigger={<SearchField variant="primary" />}><SearchField /></Dialog>',
        grammar + 'const Page = () => <><SurfaceCard /><SearchField variant="primary" /></>',
        grammar + 'const Page = () => <SurfaceCard>{() => { const Child = () => <SearchField variant="primary" />; return <Child /> }}</SurfaceCard>',
        'const title = "bg-surface"; const Page = () => <div title={title} />',
        grammar + 'const alwaysSecondary = () => "secondary"; const Page = () => <SurfaceCard><SearchField variant={alwaysSecondary("primary")} /></SurfaceCard>',
        grammar + 'const Page = () => <SurfaceCard><SearchField variant={`primary${suffix}`} /></SurfaceCard>',
        grammar + 'import {memo} from "react"; const Page=()=> <SurfaceCard><Host component={memo(function Child(){return <SearchField variant="primary" />})} /></SurfaceCard>',
        grammar + 'import * as React from "react"; const Page=()=> <SurfaceCard><Host component={React.forwardRef(function Child(){return <SearchField variant="primary" />})} /></SurfaceCard>',
        grammar + 'const Page=()=> <SurfaceCard><SearchField variant={"primary" && "secondary"} /></SurfaceCard>',
        'import { ChatWorkspace, SearchField } from "@starci/grammar/core"; const Page = () => <ChatWorkspace composer={<SearchField variant="primary" />} />',
      ],
      invalid: [
        { code: grammar + 'const Page = () => <SurfaceCard frame="frameless"><SearchField variant="primary" /></SurfaceCard>', errors: [primary] },
        { code: grammar + 'const Page = () => <SurfaceCard><div><SearchField variant={"primary"} /></div></SurfaceCard>', errors: [primary] },
        { code: grammar + 'const Page = () => <SurfaceCard>{rows.map(row => <SearchField key={row.id} variant="primary" />)}</SurfaceCard>', errors: [primary] },
        { code: 'import { SurfaceCard as Panel, SearchField as Search } from "@starci/grammar/heritage"; const Page = () => <Panel><Search variant="primary" /></Panel>', errors: [primary] },
        { code: 'import * as G from "@starci/grammar/core"; const Page = () => <G.SurfaceCard><G.SearchField variant="primary" /></G.SurfaceCard>', errors: [primary] },
        { code: 'import { Sidebar, SearchField } from "@starci/grammar/offset-pop"; const Page = () => <Sidebar header={<SearchField variant="primary" />} />', errors: [primary] },
        { code: grammar + 'const variant = "primary"; const Page = () => <SurfaceCard><SearchField variant={variant} /></SurfaceCard>', errors: [primary] },
        { code: grammar + 'const Page = () => <SurfaceCard><SearchField variant={active ? "secondary" : "primary"} /></SurfaceCard>', errors: [primary] },
        { code: 'import { ChatWorkspace, SearchField } from "@starci/grammar/core"; const Page = () => <ChatWorkspace rail={<SearchField variant="primary" />} />', errors: [primary] },
        { code: 'import { SurfaceCard, Popover, SearchField } from "@starci/grammar/core"; const Page = () => <SurfaceCard><Popover trigger={<SearchField variant="primary" />} /></SurfaceCard>', errors: [primary] },
        { code: grammar + 'const props = { variant: "primary" }; const Page = () => <SurfaceCard><SearchField {...props} /></SurfaceCard>', errors: [primary] },
        { code: grammar + 'const Page = () => <SurfaceCard><SearchField {...{variant: "primary"}} /></SurfaceCard>', errors: [primary] },
        { code: grammar + 'const Page = () => <SurfaceCard>{rows.map(function RenderRow(row) { return <SearchField variant="primary" /> })}</SurfaceCard>', errors: [primary] },
      ],
    })
  })
}

for (const Surface of ["SurfaceCard", "SurfaceListCard", "SurfaceAccordionCard", "Rail", "Sidebar", "Drawer", "Dialog", "AlertDialog", "Popover"]) {
  test(`ANATOMY-2: ${Surface} provides the nested-field context`, () => {
    tester().run("nested-control-variant", nestedControlVariant, {
      valid: [`import { ${Surface}, Input } from "@starci/grammar/core"; const Page = () => <${Surface}><Input /></${Surface}>`],
      invalid: [{ code: `import { ${Surface}, Input } from "@starci/grammar/core"; const Page = () => <${Surface}><Input variant="primary" /></${Surface}>`, errors: [primary] }],
    })
  })
}

for (const Field of ["Input", "TextField", "Textarea", "TextArea", "SearchField", "NumberField", "DateField", "TimeField", "Select", "ComboBox", "DatePicker", "DateRangePicker", "Checkbox", "CheckboxGroup", "RadioGroup", "PressableField", "OtpInput"]) {
  test(`ANATOMY-2: ${Field} cannot force a primary variant inside a surface`, () => {
    tester().run("nested-control-variant", nestedControlVariant, {
      valid: [`import { SurfaceCard, ${Field} } from "@starci/grammar/core"; const Page = () => <SurfaceCard><${Field} /></SurfaceCard>`],
      invalid: [
        { code: `import { SurfaceCard, ${Field} } from "@starci/grammar/core"; const Page = () => <SurfaceCard><${Field} variant="primary" /></SurfaceCard>`, errors: [primary] },
        { code: `import { SurfaceCard, ${Field} as Field } from "@starci/grammar/core"; const Page = () => <SurfaceCard><Field variant="primary" /></SurfaceCard>`, errors: [primary] },
      ],
    })
  })
}

test("ANATOMY-2: raw surface paint is refused in markup, constants, conditional templates and class builders", () => {
  tester().run("nested-control-variant", nestedControlVariant, {
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

for (const edition of ["lite", "full"]) {
  test(`PADDING-0 ${edition}: valid panel alignment passes and invalid list padding is rejected`, () => {
    tester().run("no-list-panel-padding", noListPanelPadding, {
      valid: [
        grammar + 'const Page = () => <SurfaceCard><ListBox inset="panel" /></SurfaceCard>',
        grammar + 'const Page = () => <SurfaceCard><div className="py-2 gap-2"><ListBox /></div></SurfaceCard>',
        grammar + 'const Page = () => <div className="px-4"><SurfaceCard><ListBox /></SurfaceCard></div>',
        'import { ListBox } from "other-kit"; const Page = () => <div className="px-2"><ListBox /></div>',
        grammar + 'const Page = ({ ListBox }) => <div className="px-2"><ListBox /></div>',
        grammar + 'const Page = () => <div className="px-2">text</div>',
        grammar + 'const Child = () => <ListBox />; const Page = () => <div className="px-2"><Child /></div>',
        grammar + 'const Page = () => <ListBox.Section><ListBox.Item><div className="px-2">row</div></ListBox.Item></ListBox.Section>',
        grammar + 'const styles={clean:"py-2",dirty:"px-2"}; const {clean}=styles; const Page=()=> <div className={clean}><ListBox /></div>',
        grammar + 'const styles={clean:"py-2",dirty:"px-2"}; const {clean:alias}=styles; const Page=()=> <div className={alias}><ListBox /></div>',
        grammar + 'const className="title"; const props={[className]:"px-2"}; const Page=()=> <div {...props}><ListBox /></div>',
      ],
      invalid: [
        { code: grammar + 'const Page = () => <SurfaceCard><div className="px-2"><ListBox /></div></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const Page = () => <div className="ps-3"><ListBox /></div>', errors: [padding] },
        { code: grammar + 'const Page = () => <Wrapper className="md:pe-2"><ListBox /></Wrapper>', errors: [padding] },
        { code: grammar + 'const Page = () => <div className={cn("flex", active && "px-2")}><ListBox /></div>', errors: [padding] },
        { code: grammar + 'const classes = { list: "px-2" }; const Page = () => <div className={classes.list}><ListBox /></div>', errors: [padding] },
        { code: grammar + 'const classes = { list: "px-2" }; const Page = () => <div className={classes["list"]}><ListBox /></div>', errors: [padding] },
        { code: 'import { ListBox as List } from "@starci/grammar/core"; const Page = () => <div className="px-2"><List /></div>', errors: [padding] },
        { code: 'import * as G from "@starci/grammar/core"; const Page = () => <div className="px-2"><G.ListBox /></div>', errors: [padding] },
        { code: grammar + 'const Page = () => <SurfaceCard><div className="px-2"><ListBox /><ListBox /></div></SurfaceCard>', errors: [padding] },
        { code: grammar + 'const Page = () => <div className="px-2"><ListBox.Section /></div>', errors: [padding] },
        { code: grammar + 'const Page = () => <ListBox.Section header={<div className="px-3">caption</div>} />', errors: [padding] },
        { code: grammar + 'const Page = () => <ListBox.Section><div className="ps-3">caption</div></ListBox.Section>', errors: [padding] },
        { code: grammar + 'const Page = () => <ListBox className="px-2" />', errors: [padding] },
        { code: grammar + 'const props = { className: "px-2" }; const Page = () => <div {...props}><ListBox /></div>', errors: [padding] },
        { code: grammar + 'const styles={clean:"py-2",dirty:"px-2"}; const {dirty:alias}=styles; const Page=()=> <div className={alias}><ListBox /></div>', errors: [padding] },
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
      { code: grammar + 'import { styles } from "./classNames"; const Page = () => <div className={styles.list}><ListBox /></div>', ids: ["padding"] },
      { code: grammar + 'import { styles } from "./classNames"; const Page = () => <div className={styles.raw} />', ids: ["surface"] },
      { code: grammar + 'import { primary } from "./classNames"; const Page = () => <SurfaceCard><SearchField variant={primary} /></SurfaceCard>', ids: ["primary"] },
      { code: grammar + 'import { styles, secondary } from "./classNames"; const Page = () => <SurfaceCard><SearchField variant={secondary} /><div className={styles.clean}><ListBox /></div></SurfaceCard>', ids: [] },
      { code: grammar + 'import { template } from "./classNames"; const Page = () => <div className={template} />', ids: ["surface"] },
      { code: grammar + 'import * as C from "./classNames"; const Page = () => <div className={C.styles["list"]}><ListBox /></div>', ids: ["padding"] },
      { code: grammar + 'import { listProps } from "./classNames"; const Page=()=> <div {...listProps}><ListBox /></div>', ids: ["padding"] },
      { code: grammar + 'import { fieldProps } from "./classNames"; const Page=()=> <SurfaceCard><SearchField {...fieldProps} /></SurfaceCard>', ids: ["primary"] },
      { code: grammar + 'import { cleanProps, secondaryProps } from "./classNames"; const Page=()=> <SurfaceCard><div {...cleanProps}><ListBox /></div><SearchField {...secondaryProps} /></SurfaceCard>', ids: [] },
      { code: grammar + 'import { styles } from "./classNames"; const {clean:alias}=styles; const Page=()=> <div className={alias}><ListBox /></div>', ids: [] },
      { code: grammar + 'import { styles } from "./classNames"; const {list:alias}=styles; const Page=()=> <div className={alias}><ListBox /></div>', ids: ["padding"] },
      { code: grammar + 'import { comparedProps } from "./classNames"; const Page=()=> <SurfaceCard><SearchField {...comparedProps} /></SurfaceCard>', ids: [] },
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
