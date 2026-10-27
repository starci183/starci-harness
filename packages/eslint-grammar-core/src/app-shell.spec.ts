// proves: FE_APP_SHELL_FRAME@lite
// proves: FE_APP_SHELL_FRAME@full
// proves: FE_NAVBAR_CONTROL_SIZE@lite
// proves: FE_NAVBAR_CONTROL_SIZE@full
// proves: FE_NAVBAR_CLUSTER@lite
// proves: FE_NAVBAR_CLUSTER@full
// proves: FE_APP_SHELL_BOTTOM_TABS@lite
// proves: FE_APP_SHELL_BOTTOM_TABS@full
// proves: FE_NAVBAR_CREATE@lite
// proves: FE_NAVBAR_CREATE@full
/** The FE app-shell contract runs through the same gathered ESLint rules as application gates. */
import assert from "node:assert/strict"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { at, fixtureHfs } from "../../eslint-canon-fe/fixtures/typed/tester.mjs"
import { appShellFrame, navbarCluster, navbarControlSize, noNavbarCreate, noShellBottomTabs, rules } from "./app-shell.ts"
import { recommended, ruleOwners } from "./index.ts"
import { phrasesOf } from "../runtime/scripts/lib/source-phrases.mjs"
import { IMPORTS, CLUSTER, MOBILE_CLUSTER, bar } from "./fixtures/app-shell.ts"

const FILE = at("apps/web/src/features/layouts/AppShell/component.tsx")
const PAGE = at("apps/web/src/components/branches/Article/index.tsx")
const SITE_IMPORTS = 'import { Button, Image, NavLandmark, SegmentedControl, TextAction, TopBar, WorkspaceShell } from "@starci/grammar/common";'
const SITE_LANGUAGE = '<SegmentedControl label={props.language.label} isLabelHidden size="control" value={props.language.locale} onValueChange={props.on.choose} options={props.language.options} />'
const SITE_ACTIONS = `<>${SITE_LANGUAGE}<Button intent="neutral" size="control" href={props.accountHref}>{props.accountLabel}</Button><Button intent="alternative" size="control" href={props.tryHref}>{props.tryLabel}</Button></>`
const SITE_BAR = `<TopBar position="sticky" brand={<TextAction href={props.homeHref} size="control"><Image src={props.logo} alt={props.home} width={102} height={36} /></TextAction>} navigation={<NavLandmark label={props.navLabel} layout="bar"><TextAction href={props.anchor} appearance="route" size="control">{props.anchorLabel}</TextAction></NavLandmark>} actions={${SITE_ACTIONS}} />`
const LOCALIZED_CREATE = phrasesOf("appShell.product", fileURLToPath(new URL("../runtime/", import.meta.url)))[0]
if (LOCALIZED_CREATE === undefined) throw new Error("The app-shell create-action phrase catalog is empty")


for (const lite of [false, true]) {
  const edition = lite ? "lite" : "full"
  const tester = new RuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { starci: { hfs: fixtureHfs(undefined, { lite }) } },
  })

  test(`${edition} app frame passes fixed Grammar shells and rejects flow or hand-built frames`, () => {
    tester.run("app-shell-frame", appShellFrame, {
      valid: [
        { filename: FILE, code: bar() },
        { filename: FILE, code: 'import { WorkspaceShell as Frame } from "@starci/grammar/common"; const view = <Frame viewport="fixed" />' },
        { filename: FILE, code: 'import * as Grammar from "@starci/grammar/common"; const view = <Grammar.WorkspaceShell viewport="fixed" />' },
        { filename: FILE, code: 'const attrs = { viewport: "fixed" } as const; const view = <WorkspaceShell {...attrs} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={undefined} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={{ content: <Sidebar presentation="drawer" /> }} />' },
        { filename: FILE, code: 'const drawer = { content: <Sidebar presentation="drawer" /> }; const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={alternate ? drawer : { content: <Sidebar presentation="drawer" /> }} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" compactHeader={<Drawer placement="left"><Sidebar presentation="drawer" /></Drawer>} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} compactHeader={<Drawer placement="left"><Sidebar presentation="drawer" /></Drawer>} />' },
        { filename: FILE, code: 'const attrs = { viewport: "fixed", navigation: <Sidebar />, navigationVisibility: "wide", compactHeader: <Drawer placement="left"><Sidebar presentation="drawer" /></Drawer> } as const; const view = <WorkspaceShell {...attrs} />' },
        { filename: FILE, code: 'const visibility = "wide"; const Opener = () => <Drawer placement="left"><Sidebar presentation="drawer" /></Drawer>; const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility={compact ? visibility : "wide"} compactHeader={<Opener />} />' },
        { filename: FILE, code: 'const view = <div><Region /></div>' },
        { filename: PAGE, code: 'const Article = () => <nav><NavigationList /></nav>' },
        { filename: PAGE, code: 'const SiteShell = () => <WorkspaceShell viewport="flow" header={<TopBar brand={<TextAction />} />} />' },
        { filename: PAGE, code: 'export const Navbar = () => <TopBar brand={<IdentityLockup size="control" />} />' },
        { filename: at("scripts/sample.tsx"), code: 'const view = <header><nav /></header>' },
      ],
      invalid: [
        { filename: FILE, code: 'const view = <WorkspaceShell navigation={<Sidebar />} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="flow" navigation={<Sidebar />} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="always" />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility={compact ? "wide" : "always"} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="always" compactHeader={<Drawer placement="left"><Sidebar presentation="drawer" /></Drawer>} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="always" navigationDrawer={{ content: <Sidebar presentation="drawer" /> }} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility={runtimeVisibility} navigationDrawer={{ content: <Sidebar presentation="drawer" /> }} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" compactHeader={<div />} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" compactHeader={undefined} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const Opener = () => <Drawer placement="left"><Sidebar presentation="drawer" /></Drawer>; const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" compactHeader={ready ? <Opener /> : null} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={undefined} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={null} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={false} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={ready ? undefined : false} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={ready ? { content: <Sidebar presentation="drawer" /> } : undefined} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationDrawer={unknownDrawer} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility={undefined} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const attrs = { navigation: <Sidebar /> }; const view = <WorkspaceShell viewport="fixed" {...attrs} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" navigation={<Sidebar />} {...unknown} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'import { WorkspaceShell } from "@starci/grammar/common"; const Frame = WorkspaceShell; const view = <Frame viewport="flow" navigation={<Sidebar />} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'import * as Grammar from "@starci/grammar/common"; const { WorkspaceShell: Frame } = Grammar; const view = <Frame viewport="flow" navigation={<Sidebar />} />', errors: [{ messageId: "frame" }] },
        { filename: FILE, code: 'const view = <header><nav /><main /></header>', errors: [{ messageId: "frame" }, { messageId: "frame" }, { messageId: "frame" }] },
        { filename: PAGE, code: 'const AppShell = () => <nav><NavigationList /></nav>', errors: [{ messageId: "frame" }] },
        { filename: PAGE, code: 'const AppShell = () => <div><TopBar /><Content /></div>', errors: [{ messageId: "frame" }] },
        { filename: PAGE, code: 'const AppChrome = () => <><TopBar brand={<IdentityLockup />} /><Sidebar /><Content /></>', errors: [{ messageId: "frame" }] },
        { filename: PAGE, code: 'const AppShell = () => <WorkspaceShell viewport={runtimeValue} primary={<Content />} />', errors: [{ messageId: "frame" }] },
        { filename: PAGE, code: 'const AppShell = () => <WorkspaceShell primary={<Content />} />', errors: [{ messageId: "frame" }] },
        { filename: at("apps/web/src/app/layout.tsx"), code: 'const Layout = () => <div><TopBar /><Content /></div>', errors: [{ messageId: "frame" }] },
      ],
    })
  })

  test(`${edition} navbar controls pass one size and reject omissions, overrides and local extracted controls`, () => {
    tester.run("navbar-control-size", navbarControlSize, {
      valid: [
        { filename: FILE, code: bar() },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<Button {...unknown} size="control" />} />' },
        { filename: FILE, code: 'const button = <Button size="control" />; const view = <TopBar brand={button} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<DropdownMenu trigger={<IconButton size="control" />} items={[{ label: "Create", action: <Button /> }]} />} />' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<Popover trigger={<IconButton size="control" />}><Button /></Popover>} />' },
        { filename: FILE, code: 'const view = <SurfaceCard><Button /></SurfaceCard>' },
        { filename: FILE, code: 'const view = <TopBar brand={<Region label={copy.tools}><Button size="control" /></Region>} />' },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton size="control" />} footer={<Button />}><Sidebar presentation="drawer" footer={<Input label={copy.query} />} /><Button /></Drawer>' },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}><Form><Input label={copy.query} /><Button /></Form></Drawer>' },
        { filename: FILE, code: 'const view = <Drawer placement="right" trigger={<IconButton />}><Sidebar presentation="drawer" /></Drawer>' },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}><Sidebar presentation="rail" /></Drawer>' },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" compactHeader={<Drawer trigger={<IconButton size="control" />}><Form><Input label={copy.query} /><Button /></Form></Drawer>} />' },
        { filename: FILE, code: 'const view = <TopBar brand={<Button size="control" {...(disabled ? { isDisabled: true } : {})} />} />' },
        { filename: FILE, code: 'const view = <TopBar actions={<SegmentedControl label={copy.language} isLabelHidden size="control" options={options} />} />' },
        { filename: PAGE, code: `${SITE_IMPORTS} export const SiteShell = (props: Props) => <WorkspaceShell viewport="flow" primaryLabel={props.main} header={${SITE_BAR}} primary={props.children} />` },
      ],
      invalid: [
        { filename: FILE, code: 'const view = <TopBar brand={<Button />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<SegmentedControl label={copy.language} isLabelHidden options={options} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<SegmentedControl label={copy.language} size="lg" options={options} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<Switch size="lg" />} compactHeader={<IconButton />} />', errors: [{ messageId: "control" }, { messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar brand={<Button size="control" {...unknown} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const Wrong = () => <IconButton size="md" />; const view = <TopBar brand={<Wrong />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'import { Button as Action } from "@starci/grammar/common"; const view = <TopBar brand={<Action />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const Extra = () => { if (enabled) return <Button size="lg" />; return null }; const view = <TopBar brand={<Extra />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'function Extra() { return <Button /> }; const view = <TopBar brand={<Extra />} />', errors: [{ messageId: "control" }] },
        { filename: PAGE, code: 'export const Navbar = () => <TopBar brand={<Button size="lg" />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Checkbox label={copy.filter} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<ComboBox label={copy.filter} items={[]} />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}><Sidebar presentation="drawer" footer={<Input label={copy.query} />} /><Button /></Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'import { Drawer as Sheet, Sidebar as Destinations } from "@starci/grammar/common"; const Trigger = () => <IconButton size="md" />; const Body = () => <Destinations presentation="drawer" />; const view = <Sheet placement="left" trigger={<Trigger />}><Body /></Sheet>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const body = <Sidebar presentation="drawer" />; const view = <Drawer placement="left" trigger={<Button size="lg" />} children={body} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}><Sidebar presentation="drawer" {...(selected ? { selectedKey: selected } : {})} /></Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}>{signedIn && <Sidebar presentation="drawer" />}</Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const Body = () => signedIn && <Sidebar presentation="drawer" />; const view = <Drawer placement="left" trigger={<IconButton />}><Body /></Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}>{body || <Sidebar presentation="drawer" />}</Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <Drawer placement="left" trigger={<IconButton />}>{body ?? <Sidebar presentation="drawer" />}</Drawer>', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar brand={enabled && <Button size="lg" />} />', errors: [{ messageId: "control" }] },
        { filename: FILE, code: 'const view = <TopBar brand={<Button size="control" {...(large ? { size: "lg" } : {})} />} />', errors: [{ messageId: "control" }] },
      ],
    })
  })

  test(`${edition} navbar cluster passes the ordered kinds and rejects swapped, missing and wrong controls`, () => {
    tester.run("navbar-cluster", navbarCluster, {
      valid: [
        { filename: FILE, code: bar() },
        { filename: FILE, code: `${IMPORTS} const actions = ${CLUSTER}; const view = <TopBar actions={actions} />` },
        { filename: FILE, code: `${IMPORTS} const Actions = () => ${CLUSTER}; const view = <NavigationFeatureNav actions={<Actions />} />` },
        { filename: PAGE, code: 'const SiteShell = (props: Props) => <WorkspaceShell viewport="flow" header={<TopBar actions={props.actions} />} />' },
        { filename: PAGE, code: `${SITE_IMPORTS} export const SiteShell = (props: Props) => <WorkspaceShell viewport="flow" primaryLabel={props.main} header={${SITE_BAR}} primary={props.children} />` },
        { filename: FILE, code: `${IMPORTS} const view = <TopBar actions={<><div className="hidden md:flex"><DropdownMenu trigger={<IconButton source={icons.language} />} /><Switch /></div>${MOBILE_CLUSTER}</>} />` },
        { filename: FILE, code: `${IMPORTS} const view = <TopBar actions={wide ? ${CLUSTER} : ${MOBILE_CLUSTER}} />` },
        { filename: FILE, code: `${IMPORTS} const view = <TopBar actions={alternate ? ${CLUSTER} : ${CLUSTER}} />` },
        { filename: FILE, code: `${IMPORTS} const view = <TopBar actions={true && ${CLUSTER}} />` },
        { filename: FILE, code: `${IMPORTS} const chrome = { actions: ${CLUSTER} }; const view = <TopBar actions={chrome.actions} />` },
        { filename: FILE, code: `${IMPORTS} const view = <WorkspaceShell viewport="fixed" header={<div><IdentityLockup /><Button>Search</Button><div>${CLUSTER}</div></div>} />` },
        { filename: FILE, code: `${IMPORTS} const Actions = () => { if (wide) return ${CLUSTER}; return ${MOBILE_CLUSTER} }; const view = <TopBar actions={<Actions />} />` },
        { filename: FILE, code: `${IMPORTS} const view = <WorkspaceShell viewport="fixed" header={<div><IdentityLockup /><Button>Search</Button><div><DropdownMenu trigger={<IconButton source={icons.language} />} /><Switch /><div>${MOBILE_CLUSTER}</div></div></div>} />` },
        { filename: FILE, code: 'import { DropdownMenu as Menu, Popover as Bubble } from "@starci/grammar/common"; const Language = () => <IconButton source={icons.language} variant="tertiary" />; const bell = <IconButton source={icons.bell} />; const view = <TopBar actions={<><Menu trigger={<Language />} /><Switch /><Bubble trigger={bell} /><Menu trigger={<AvatarButton />} /></>} />' },
        { filename: FILE, code: `${IMPORTS} const view = <TopBar actions={<Region label={copy.tools}>${CLUSTER}</Region>} />` },
      ],
      invalid: [
        { filename: FILE, code: bar('<><Switch /><IconButton source={icons.language} /><IconButton source={icons.bell} /><AvatarButton /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><IconButton source={icons.language} /><Button label={copy.theme} /><IconButton source={icons.bell} /><AvatarButton /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><IconButton source={icons.language} /><Switch /><IconButton source={icons.bell} /><Button label={copy.account} /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><IconButton source={icons.language} /><Switch /><AvatarButton /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><IconButton source={icons.language} /><Switch /><IconButton source={icons.bell} /><AvatarButton /><Button /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: 'const view = <TopBar />', errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: 'import { Navbar } from "./Navbar"; const AppShell = () => <WorkspaceShell viewport="fixed" header={<Navbar />} />', errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: 'const AppShell = (props: Props) => <TopBar actions={props.actions} />', errors: [{ messageId: "cluster" }] },
        { filename: PAGE, code: 'export const Navbar = () => <TopBar brand={<IdentityLockup />} actions={<><Switch /><AvatarButton /></>} />', errors: [{ messageId: "cluster" }] },
        { filename: PAGE, code: `${SITE_IMPORTS} export const LandingNav = (props: Props) => ${SITE_BAR}`, errors: [{ messageId: "cluster" }] },
        { filename: PAGE, code: `${SITE_IMPORTS} export const SiteShell = (props: Props) => <WorkspaceShell viewport="fixed" header={${SITE_BAR}} primary={props.children} />`, errors: [{ messageId: "cluster" }] },
        { filename: PAGE, code: 'export const Navbar = () => <TopBar brand={<TextAction />} actions={<><Switch /><AvatarButton /></>} />', errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: 'const chrome = { actions: <><AvatarButton /><Switch /></> }; const view = <TopBar actions={chrome.actions} />', errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: `${IMPORTS} const view = <TopBar actions={false && ${CLUSTER}} />`, errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: `${IMPORTS} const view = <TopBar actions={enabled && ${CLUSTER}} />`, errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: `${IMPORTS} const view = <WorkspaceShell viewport="fixed" header={<div><IdentityLockup /><Button>Search</Button><div>${CLUSTER}<Button>Help</Button></div></div>} />`, errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: `${IMPORTS} const bell = <Popover trigger={<IconButton source={icons.bell} />} />; const view = <TopBar actions={<><DropdownMenu trigger={<IconButton source={icons.language} />} /><Switch />{bell}{bell}<DropdownMenu trigger={<AvatarButton />} /></>} />`, errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: `${IMPORTS} const view = <WorkspaceShell viewport="fixed" header={<div><IdentityLockup /><div>${CLUSTER}</div><DropdownMenu trigger={<AvatarButton />} /></div>} />`, errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><IconButton source={icons.language} /><Switch /><Popover trigger={<IconButton source={icons.bell} />} /><DropdownMenu trigger={<AvatarButton />} /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><DropdownMenu trigger={<IconButton source={icons.language} />} /><Switch /><IconButton source={icons.bell} /><DropdownMenu trigger={<AvatarButton />} /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><DropdownMenu trigger={<IconButton source={icons.language} />} /><Switch /><Popover trigger={<IconButton source={icons.bell} />} /><AvatarButton /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar('<><DropdownMenu trigger={<IconButton source={icons.language} variant="primary" />} /><Switch /><Popover trigger={<IconButton source={icons.bell} />} /><DropdownMenu trigger={<AvatarButton />} /></>'), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar(`<>{${CLUSTER}}<Checkbox label={copy.filter} /></>`), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: bar(`<>{${CLUSTER}}<ComboBox label={copy.filter} items={[]} /></>`), errors: [{ messageId: "cluster" }] },
        { filename: FILE, code: `${IMPORTS} const view = <WorkspaceShell viewport="fixed" header={<div><IdentityLockup /><div>${CLUSTER}<Checkbox label={copy.filter} /></div></div>} />`, errors: [{ messageId: "cluster" }] },
      ],
    })
  })

  test(`${edition} mobile shell passes drawer navigation and rejects bottom tab components and slots`, () => {
    tester.run("no-shell-bottom-tabs", noShellBottomTabs, {
      valid: [
        { filename: FILE, code: 'const view = <WorkspaceShell navigation={<Sidebar />} navigationDrawer={{ content: <Sidebar presentation="drawer" /> }} />' },
        { filename: FILE, code: 'const view = <TabBar />' },
        { filename: FILE, code: 'const view = <WorkspaceShell compactNavigation={undefined} />' },
        { filename: FILE, code: 'const compactNavigation = undefined; const view = <WorkspaceShell {...{ compactNavigation }} />' },
        { filename: PAGE, code: 'import { MobileTabBar } from "@/components/blocks/MobileTabBar"; const Article = () => <MobileTabBar />' },
      ],
      invalid: [
        { filename: FILE, code: 'const view = <WorkspaceShell compactNavigation={<TabBar />} />', errors: [{ messageId: "bottom" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell {...{ compactNavigation: <TabBar /> }} />', errors: [{ messageId: "bottom" }] },
        { filename: FILE, code: 'const view = <BottomNav />', errors: [{ messageId: "bottom" }] },
        { filename: FILE, code: 'import { MobileTabBar } from "@/components/blocks/MobileTabBar"; const view = <><WorkspaceShell viewport="fixed" /><MobileTabBar /></>', errors: [{ messageId: "bottom" }] },
        { filename: FILE, code: 'import { BottomTabBar } from "@/components/blocks/BottomTabBar"; const view = <><WorkspaceShell viewport="fixed" /><BottomTabBar /></>', errors: [{ messageId: "bottom" }] },
        { filename: PAGE, code: 'import { MobileBottomNav } from "@/components/blocks/MobileBottomNav"; const tabs = <MobileBottomNav />; const view = <WorkspaceShell viewport="fixed" primary={tabs} />', errors: [{ messageId: "bottom" }] },
        { filename: FILE, code: 'import { BottomNav as FooterTabs } from "@starci/grammar/common"; const view = <FooterTabs />', errors: [{ messageId: "bottom" }] },
        { filename: FILE, code: 'import { BottomNav } from "@starci/grammar/common"; const Footer = BottomNav; const view = <Footer />', errors: [{ messageId: "bottom" }] },
        { filename: FILE, code: 'const AppShell = (undefined: ReactNode) => <WorkspaceShell compactNavigation={undefined} />', errors: [{ messageId: "bottom" }] },
      ],
    })
  })

  test(`${edition} create actions pass on their page and fail in navbar brand, search or actions`, () => {
    tester.run("no-navbar-create", noNavbarCreate, {
      valid: [
        { filename: FILE, code: bar() },
        { filename: FILE, code: 'const view = <SurfaceCard><Button onPress={on.create}>Create</Button></SurfaceCard>' },
        { filename: FILE, code: 'const view = <TopBar actions={<Button size="control" label={copy.news}>News</Button>} />' },
        { filename: FILE, code: 'const view = <TopBar actions={<Popover trigger={<IconButton source={icons.bell} size="control" />}><Text>{copy.notifications}</Text></Popover>} />' },
      ],
      invalid: [
        { filename: FILE, code: 'const view = <TopBar actions={<Button onPress={on.create}>Create</Button>} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const view = <WorkspaceShell viewport="fixed" header={<Button label={copy.createProject} />} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const action = <IconButton onPress={createTask} label={copy.action} />; const view = <TopBar brand={action} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: `const view = <NavigationFeatureNav navigation={<Button>{${JSON.stringify(LOCALIZED_CREATE)}}</Button>} />`, errors: [{ messageId: "create" }] },
        { filename: FILE, code: `const view = <NavigationFeatureNav navigation={<Button>{${JSON.stringify(LOCALIZED_CREATE.normalize("NFD"))}}</Button>} />`, errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Button><Text>{copy.create}</Text></Button>} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const Extra = () => { if (enabled) return <Button onPress={on.create}>Create</Button>; return null }; const view = <TopBar brand={<Extra />} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const view = <TopBar actions={<Popover trigger={<IconButton source={icons.bell} size="control" />}><Button>Create</Button></Popover>} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const entries = [{ label: copy.createProject, onAction: on.choose }]; const view = <TopBar brand={<DropdownMenu trigger={<IconButton source={icons.language} size="control" />} entries={entries} />} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const shellMenus = () => { const accountEntries = [{ label: copy.createProject, onAction: on.choose }]; return { accountEntries } }; const { accountEntries } = shellMenus(); const view = <TopBar actions={<DropdownMenu trigger={<AvatarButton size="control" />} entries={accountEntries} />} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const workspaceEntries = () => [{ label: copy.createWorkspace, onAction: on.choose }]; const entries = [...workspaceEntries(), { label: copy.account }]; const view = <TopBar actions={<DropdownMenu trigger={<AvatarButton size="control" />} entries={entries} />} />', errors: [{ messageId: "create" }] },
        { filename: PAGE, code: 'export const Navbar = () => <TopBar actions={<Button onPress={on.create}>Create</Button>} />', errors: [{ messageId: "create" }] },
        { filename: FILE, code: 'const view = <TopBar brand={<Checkbox label={copy.filter} onSelectedChange={on.createTask} />} />', errors: [{ messageId: "create" }] },
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
