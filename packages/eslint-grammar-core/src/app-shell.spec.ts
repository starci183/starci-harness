// proves: FE_NAVBAR_CONTROL_SIZE
// proves: FE_NAVBAR_CONTROL_SIZE
/** The FE app-shell contract runs through the same gathered ESLint rules as application gates. */
import assert from "node:assert/strict"
import test from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { at, fixtureHfs } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { navbarControlSize, rules } from "./app-shell.ts"
import { recommended, ruleOwners } from "./index.ts"
import { bar } from "./fixtures/app-shell.ts"

const FILE = at("apps/web/src/features/layouts/AppShell/component.tsx")
const PAGE = at("apps/web/src/components/branches/Article/index.tsx")
const SITE_IMPORTS = 'import { Button, Image, NavLandmark, Select, TextAction, TopBar, WorkspaceShell } from "@starci/grammar/common";'
const SITE_LANGUAGE = '<Select label={props.language.label} isLabelHidden size="control" value={props.language.locale} onValueChange={props.on.choose} options={props.language.options} />'
const SITE_ACTIONS = `<>${SITE_LANGUAGE}<Button variant="border" size="control" href={props.accountHref}>{props.accountLabel}</Button><Button variant="border" size="control" href={props.tryHref}>{props.tryLabel}</Button></>`
const SITE_BAR = `<TopBar position="sticky" brand={<TextAction href={props.homeHref} size="control"><Image src={props.logo} alt={props.home} width={102} height={36} /></TextAction>} navigation={<NavLandmark label={props.navLabel} layout="bar"><TextAction href={props.anchor} appearance="route" size="control">{props.anchorLabel}</TextAction></NavLandmark>} actions={${SITE_ACTIONS}} />`

for (const lite of [false, true]) {
  const edition = lite ? "lite" : "full"
  const tester = new RuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { starci: { hfs: fixtureHfs(undefined, { lite }) } },
  })

  test(`${edition} navbar controls pass their published 40px size and reject smaller, larger or unknown overrides`, () => {
    tester.run("navbar-control-size", navbarControlSize, {
      valid: [
        { filename: FILE, code: bar() },
        { filename: FILE, code: 'import { Button, IconButton, Switch } from "@starci/grammar/common"; const view = <TopBar brand={<Button />} actions={<><IconButton size="md" /><Switch size="control" /></>} />' },
        { filename: FILE, code: 'import { Button as Action, IconButton as Glyph } from "@starci/grammar/common"; const View = () => <TopBar brand={<Action />} actions={<Glyph />} />' },
        { filename: FILE, code: 'import * as Grammar from "@starci/grammar/common"; const view = <TopBar actions={<Grammar.IconButton size="md" />} />' },
        { filename: FILE, code: 'const Wrong = () => <IconButton size="md" />; const view = <TopBar brand={<Wrong />} />' },
        { filename: FILE, code: 'function Extra() { return <Button /> }; const view = <TopBar brand={<Extra />} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<Button {...unknown} size="control" />} />' },
        { filename: FILE, code: 'const button = <Button size="control" />; const view = <TopBar brand={button} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<DropdownMenu trigger={<IconButton size="control" />} items={[{ label: "Create", action: <Button /> }]} />} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<Popover trigger={<IconButton size="control" />}><Button /></Popover>} />' },
        { filename: FILE, code: 'const view = <SurfaceCard><Button /></SurfaceCard>' },
        { filename: FILE, code: 'const view = <TopBar brand={<Section title={copy.tools}><Button size="control" /></Section>} />' },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton size="control" />} footer={<Button />}><Sidebar presentation="drawer" footer={<Input label={copy.query} />} /><Button /></Drawer>' },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}><Form><Input label={copy.query} /><Button /></Form></Drawer>' },
        { filename: FILE, code: 'const view = <Drawer placement="right" trigger={<IconButton />}><Sidebar presentation="drawer" /></Drawer>' },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}><Sidebar presentation="rail" /></Drawer>' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" compactHeader={<Drawer trigger={<IconButton size="control" />}><Form><Input label={copy.query} /><Button /></Form></Drawer>} />' },
        { filename: FILE, code: 'const view = <TopBar brand={<Button size="control" {...(disabled ? { isDisabled: true } : {})} />} />' },
        { filename: FILE, code: 'const view = <TopBar actions={<Select label={copy.language} isLabelHidden size="control" options={options} />} />' },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden kind="toggle" />} />' },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden kind="toggle" size="md" />} />' },
        { filename: FILE, code: 'const kind = "toggle"; const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden kind={kind} />} />' },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden />} />' },
        { filename: PAGE, code: `${SITE_IMPORTS} export const SiteShell = (props: Props) => <WorkspaceShell viewport="flow" primaryLabel={props.main} header={${SITE_BAR}} primary={props.children} />` },
      ],
      invalid: [
        { filename: FILE, code: 'const view = <TopBar brand={<Button size="sm" />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Select label={copy.language} isLabelHidden options={options} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Select label={copy.language} size="lg" options={options} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<Switch size="lg" />} compactHeader={<IconButton size="sm" />} />', errors: [{ messageId: "control" }, { messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar brand={<Button size="control" {...unknown} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'import { Button as Action } from "@starci/grammar/common"; const view = <TopBar brand={<Action size="lg" />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'import { IconButton } from "@starci/grammar/common"; const view = <TopBar actions={<IconButton {...unknown} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const Extra = () => { if (enabled) return <Button size="lg" />; return null }; const view = <TopBar brand={<Extra />} />', errors: [{ messageId: "control" }] },
        { filename: PAGE, code: 'export const Navbar = () => <TopBar brand={<Button size="lg" />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Checkbox label={copy.filter} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<ComboBox label={copy.filter} items={[]} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton size="sm" />}><Sidebar presentation="drawer" footer={<Input label={copy.query} />} /><Button /></Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'import { Drawer as Sheet, Sidebar as Destinations } from "@starci/grammar/common"; const Trigger = () => <IconButton size="sm" />; const Body = () => <Destinations presentation="drawer" />; const view = <Sheet placement="left" trigger={<Trigger />}><Body /></Sheet>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const body = <Sidebar presentation="drawer" />; const view = <Drawer placement="left" trigger={<Button size="lg" />} children={body} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton size="sm" />}><Sidebar presentation="drawer" {...(selected ? { selectedKey: selected } : {})} /></Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton size="sm" />}>{signedIn && <Sidebar presentation="drawer" />}</Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const Body = () => signedIn && <Sidebar presentation="drawer" />; const view = <Drawer placement="left" trigger={<IconButton size="sm" />}><Body /></Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton size="sm" />}>{body || <Sidebar presentation="drawer" />}</Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton size="sm" />}>{body ?? <Sidebar presentation="drawer" />}</Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar brand={enabled && <Button size="lg" />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar brand={<Button size="control" {...(large ? { size: "lg" } : {})} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden kind="compact" />} />', errors: [{ messageId: "compact" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden kind="compact" size="control" />} />', errors: [{ messageId: "compact" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden kind={dense ? "compact" : "toggle"} />} />', errors: [{ messageId: "compact" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden kind={kind} size="control" />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Switch label={copy.theme} isLabelHidden size="md" />} />', errors: [{ messageId: "control" }] },
      ],
    })
  })
}

test("app-shell laws reach the gathered FE gate at error", () => {
  for (const name of Object.keys(rules)) {
    assert.equal(ruleOwners[name], "app-shell")
    assert.equal(recommended[`starci-grammar/${name}`], "error")
  }
})
