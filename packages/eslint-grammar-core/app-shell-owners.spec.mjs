/** Imported header proofs follow only selected owned render chains, including workspace public barrels. */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { Linter } from "eslint"
import parser from "@typescript-eslint/parser"
import { projectFixture } from "../eslint-canon-be/fixtures/project/tester.mjs"
import { appShellFrame, navbarCluster } from "./app-shell.mjs"
import { loadHfs } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import { CLUSTER, IMPORTS } from "./fixtures/app-shell.mjs"

const FRAME = "apps/web/src/features/layouts/Frame/component.tsx"
const BAR = "packages/fixture-ui/src/branches/Header/component.tsx"
const goodBar = `${IMPORTS} export const Header = () => <TopBar brand={<IdentityLockup size="control" />} actions={${CLUSTER}} />`
const rawHeader = `${IMPORTS} export const RawHeader = () => <div><AvatarButton /><Switch /><Button onPress={on.create}>Create</Button></div>`
const caller = (name = "Navbar", source = "@/components/blocks/Navbar") => `${IMPORTS} import { ${name} } from "${source}"; export const Frame = () => <WorkspaceShell viewport="fixed" header={<${name} />} />`
const DRAWER = '<Drawer placement="left" trigger={<IconButton size="control" />}><Sidebar presentation="drawer" /></Drawer>'
const DRAWER_IMPORTS = 'import { Drawer, Sidebar, IconButton, Dialog } from "@starci/grammar/common";'
const MOBILE = "packages/fixture-ui/src/branches/MobileDrawer/component.tsx"
const goodDrawer = `${DRAWER_IMPORTS} export const MobileDrawer = () => ${DRAWER}`
const mobileCaller = (name = "MobileDrawer", source = "@fixture/ui") => `import { WorkspaceShell, Sidebar } from "@starci/grammar/common"; import { ${name} } from "${source}"; export const Frame = () => <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" compactHeader={<${name} />} />`

const verify = (app, code, rule = "navbar-cluster") => (app.linter ??= new Linter({ cwd: app.root })).verify(code, [{
  files: ["**/*.tsx"],
  languageOptions: { parser, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { starci: { hfs: loadHfs(pathToFileURL(path.join(app.root, "eslint.config.mjs")).href) } },
  plugins: { shell: { rules: { "navbar-cluster": navbarCluster, "app-shell-frame": appShellFrame } } },
  rules: { [`shell/${rule}`]: "error" },
}], { filename: app.at(FRAME) })

const fixture = (t, edition) => {
  const app = projectFixture({ profile: "fe", edition, declaration: { optionalSlots: ["fe.package.ui"] },
    rootFiles: { "package.json": JSON.stringify({ name: "fixture", private: true, workspaces: ["fe/apps/*", "fe/packages/*"] }) },
    files: {
      [FRAME]: caller(),
      "apps/web/src/components/blocks/Navbar/index.tsx": 'import { NavbarBase } from "./component"; export const Navbar = () => <NavbarBase />',
      "apps/web/src/components/blocks/Navbar/component.tsx": 'import { Header } from "@fixture/ui"; import { Dialog, Input } from "@starci/grammar/common"; export const NavbarBase = () => <><Header /><Dialog><Input label={copy.query} /></Dialog></>',
      "packages/fixture-ui/package.json": JSON.stringify({ name: "@fixture/ui", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
      "packages/fixture-ui/src/index.ts": 'export { Header } from "./branches/Header"; export { RawHeader } from "./branches/RawHeader"; export { default as Data } from "./branches/Data/data.json"; export { MobileDrawer } from "./branches/MobileDrawer"',
      "packages/fixture-ui/src/branches/Data/data.json": '{"display":"fixture data is not a header implementation"}',
      "packages/fixture-ui/src/branches/Header/index.ts": 'export { Header } from "./component"',
      [BAR]: goodBar,
      "packages/fixture-ui/src/branches/MobileDrawer/index.ts": 'export { MobileDrawer } from "./component"',
      [MOBILE]: goodDrawer,
      "packages/fixture-ui/src/branches/RawHeader/index.tsx": rawHeader,
      "apps/web/src/components/blocks/Unused/index.tsx": `${IMPORTS} const neverRendered = () => <TopBar />; export const Unused = () => <div />`,
      "apps/web/src/components/blocks/Conditional/index.tsx": `${IMPORTS} export const Conditional = () => ready ? <TopBar actions={${CLUSTER}} brand={<IdentityLockup size="control" />} /> : <div><Button>Create</Button></div>`,
      "apps/web/src/components/blocks/Default/index.tsx": `${IMPORTS} export default () => <header><Switch /><AvatarButton /><Button>Create</Button></header>`,
      "apps/web/src/components/blocks/Cycle/index.tsx": 'import { CycleNext } from "./next"; export const Cycle = () => <CycleNext />',
      "apps/web/src/components/blocks/Cycle/next.tsx": 'import { Cycle } from "./index"; export const CycleNext = () => <Cycle />',
      "apps/web/src/components/blocks/Mobile/index.tsx": 'import { MobileDrawer } from "@fixture/ui"; export const Mobile = () => <div><MobileDrawer /></div>',
      "apps/web/src/components/blocks/ConditionalMobile/index.tsx": `${DRAWER_IMPORTS} export const ConditionalMobile = () => ready ? ${DRAWER} : <div />`,
      "apps/web/src/components/blocks/ConditionalDrawers/index.tsx": `${DRAWER_IMPORTS} export const ConditionalDrawers = () => { if (ready) return ${DRAWER}; return ${DRAWER} }`,
      "apps/web/src/components/blocks/HiddenMobile/index.tsx": `${DRAWER_IMPORTS} export const HiddenMobile = () => <Dialog>${DRAWER}</Dialog>`,
      "apps/web/src/components/blocks/UnusedMobile/index.tsx": `${DRAWER_IMPORTS} const Unused = () => ${DRAWER}; export const UnusedMobile = () => <div />`,
      "apps/web/src/components/blocks/DefaultMobile/index.tsx": `${DRAWER_IMPORTS} export default () => ${DRAWER}`,
      "apps/web/src/components/blocks/WrongDrawer/index.tsx": `${DRAWER_IMPORTS} export const WrongDrawer = () => ${DRAWER.replace('placement="left"', 'placement="right"')}`,
      "apps/web/src/components/blocks/WrongSidebar/index.tsx": `${DRAWER_IMPORTS} export const WrongSidebar = () => ${DRAWER.replace('presentation="drawer"', 'presentation="inline"')}`,
      "apps/web/src/components/blocks/ConditionalBody/index.tsx": `${DRAWER_IMPORTS} export const ConditionalBody = () => <Drawer placement="left">{ready ? <Sidebar presentation="drawer" /> : null}</Drawer>`,
      "apps/web/src/components/blocks/LogicalBody/index.tsx": `${DRAWER_IMPORTS} export const LogicalBody = () => <Drawer placement="left">{ready && <Sidebar presentation="drawer" />}</Drawer>`,
      "apps/web/src/components/blocks/LocalConditionalBody/index.tsx": `${DRAWER_IMPORTS} const Body = () => { if (ready) return <Sidebar presentation="drawer" />; return null }; export const LocalConditionalBody = () => <Drawer placement="left"><Body /></Drawer>`,
      "apps/web/src/components/blocks/HiddenSidebar/index.tsx": `${DRAWER_IMPORTS} export const HiddenSidebar = () => <Drawer placement="left"><Dialog><Sidebar presentation="drawer" /></Dialog></Drawer>`,
      "apps/web/src/components/blocks/AlwaysBody/index.tsx": `${DRAWER_IMPORTS} const Body = () => ready ? <Sidebar presentation="drawer" /> : <Sidebar presentation="drawer" />; export const AlwaysBody = () => <Drawer placement="left"><Body /></Drawer>`,
    },
  })
  t.after(app.cleanup)
  return app
}

for (const edition of ["full", "lite"]) {
  test(`${edition} imported canonical header chains pass and raw, unknown or unrelated owners are red`, (t) => {
    const app = fixture(t, edition)
    assert.deepEqual(verify(app, caller()), [])
    for (const code of [
      caller("RawHeader", "@fixture/ui"), caller("Unused", "@/components/blocks/Unused"),
      caller("Conditional", "@/components/blocks/Conditional"), caller("Missing", "@/components/blocks/Missing"),
      caller("Cycle", "@/components/blocks/Cycle"), caller("Data", "@fixture/ui"),
      `${IMPORTS} import Default from "@/components/blocks/Default"; const Frame = () => <WorkspaceShell viewport="fixed" header={<Default />} />`,
    ]) {
      const findings = verify(app, code)
      assert.equal(findings.length, 1)
      assert.equal(findings[0].ruleId, "shell/navbar-cluster")
    }
  })

  test(`${edition} same-path imported header mutation cannot reuse a stale canonical proof`, (t) => {
    const app = fixture(t, edition)
    assert.deepEqual(verify(app, caller()), [])
    fs.writeFileSync(app.at(BAR), rawHeader.replaceAll("RawHeader", "Header"))
    const findings = verify(app, caller())
    assert.equal(findings.length, 1)
    assert.equal(findings[0].ruleId, "shell/navbar-cluster")
  })

  test(`${edition} compact headers prove drawer owners through barrels and every render alternative`, (t) => {
    const app = fixture(t, edition)
    for (const code of [
      mobileCaller(), mobileCaller("Mobile", "@/components/blocks/Mobile"),
      mobileCaller("ConditionalDrawers", "@/components/blocks/ConditionalDrawers"),
      mobileCaller("AlwaysBody", "@/components/blocks/AlwaysBody"),
      'import { WorkspaceShell, Sidebar } from "@starci/grammar/common"; import Mobile from "@/components/blocks/DefaultMobile"; export const Frame = () => <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" compactHeader={<Mobile />} />',
      'import { WorkspaceShell, Sidebar } from "@starci/grammar/common"; import * as ui from "@fixture/ui"; export const Frame = () => <WorkspaceShell viewport="fixed" navigation={<Sidebar />} navigationVisibility="wide" compactHeader={<ui.MobileDrawer />} />',
    ]) assert.deepEqual(verify(app, code, "app-shell-frame"), [])
    for (const [name, source] of [
      ["Header", "@fixture/ui"], ["Data", "@fixture/ui"],
      ...["ConditionalMobile", "HiddenMobile", "UnusedMobile", "WrongDrawer", "WrongSidebar", "ConditionalBody", "LogicalBody", "LocalConditionalBody", "HiddenSidebar", "Missing", "Cycle"].map((name) => [name, `@/components/blocks/${name}`]),
    ]) {
      const findings = verify(app, mobileCaller(name, source), "app-shell-frame")
      assert.equal(findings.length, 1, name)
      assert.equal(findings[0].ruleId, "shell/app-shell-frame")
    }
  })

  test(`${edition} same-path imported drawer mutation cannot reuse a stale opener proof`, (t) => {
    const app = fixture(t, edition)
    assert.deepEqual(verify(app, mobileCaller(), "app-shell-frame"), [])
    fs.writeFileSync(app.at(MOBILE), goodDrawer.replace('presentation="drawer"', 'presentation="inline"'))
    const findings = verify(app, mobileCaller(), "app-shell-frame")
    assert.equal(findings.length, 1)
    assert.equal(findings[0].ruleId, "shell/app-shell-frame")
  })
}
