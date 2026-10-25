/** Imported header proofs follow only selected owned render chains, including workspace public barrels. */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { Linter } from "eslint"
import parser from "@typescript-eslint/parser"
import { projectFixture } from "../be/fixtures/project/tester.mjs"
import { navbarCluster } from "./app-shell.mjs"
import { loadHfs } from "./lib/hfs.mjs"
import { CLUSTER, IMPORTS } from "./fixtures/app-shell.mjs"

const FRAME = "apps/web/src/features/layouts/Frame/component.tsx"
const BAR = "packages/fixture-ui/src/branches/Header/component.tsx"
const goodBar = `${IMPORTS} export const Header = () => <TopBar brand={<IdentityLockup size="control" />} actions={${CLUSTER}} />`
const rawHeader = `${IMPORTS} export const RawHeader = () => <div><AvatarButton /><Switch /><Button onPress={on.create}>Create</Button></div>`
const caller = (name = "Navbar", source = "@/components/blocks/Navbar") => `${IMPORTS} import { ${name} } from "${source}"; export const Frame = () => <WorkspaceShell viewport="fixed" header={<${name} />} />`

const verify = (app, code) => (app.linter ??= new Linter({ cwd: app.root })).verify(code, [{
  files: ["**/*.tsx"],
  languageOptions: { parser, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { starci: { hfs: loadHfs(pathToFileURL(path.join(app.root, "eslint.config.mjs")).href) } },
  plugins: { shell: { rules: { "navbar-cluster": navbarCluster } } },
  rules: { "shell/navbar-cluster": "error" },
}], { filename: app.at(FRAME) })

const fixture = (t, edition) => {
  const app = projectFixture({ profile: "fe", edition, declaration: { optionalSlots: ["fe.package.ui"] },
    rootFiles: { "package.json": JSON.stringify({ name: "fixture", private: true, workspaces: ["fe/apps/*", "fe/packages/*"] }) },
    files: {
      [FRAME]: caller(),
      "apps/web/src/components/blocks/Navbar/index.tsx": 'import { NavbarBase } from "./component"; export const Navbar = () => <NavbarBase />',
      "apps/web/src/components/blocks/Navbar/component.tsx": 'import { Header } from "@fixture/ui"; import { Dialog, Input } from "@starci/grammar/common"; export const NavbarBase = () => <><Header /><Dialog><Input label={copy.query} /></Dialog></>',
      "packages/fixture-ui/package.json": JSON.stringify({ name: "@fixture/ui", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
      "packages/fixture-ui/src/index.ts": 'export { Header } from "./branches/Header"; export { RawHeader } from "./branches/RawHeader"; export { default as Data } from "./branches/Data/data.json"',
      "packages/fixture-ui/src/branches/Data/data.json": '{"display":"fixture data is not a header implementation"}',
      "packages/fixture-ui/src/branches/Header/index.ts": 'export { Header } from "./component"',
      [BAR]: goodBar,
      "packages/fixture-ui/src/branches/RawHeader/index.tsx": rawHeader,
      "apps/web/src/components/blocks/Unused/index.tsx": `${IMPORTS} const neverRendered = () => <TopBar />; export const Unused = () => <div />`,
      "apps/web/src/components/blocks/Conditional/index.tsx": `${IMPORTS} export const Conditional = () => ready ? <TopBar actions={${CLUSTER}} brand={<IdentityLockup size="control" />} /> : <div><Button>Create</Button></div>`,
      "apps/web/src/components/blocks/Default/index.tsx": `${IMPORTS} export default () => <header><Switch /><AvatarButton /><Button>Create</Button></header>`,
      "apps/web/src/components/blocks/Cycle/index.tsx": 'import { CycleNext } from "./next"; export const Cycle = () => <CycleNext />',
      "apps/web/src/components/blocks/Cycle/next.tsx": 'import { Cycle } from "./index"; export const CycleNext = () => <Cycle />',
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
}
