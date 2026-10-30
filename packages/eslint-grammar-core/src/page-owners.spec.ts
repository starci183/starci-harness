/**
 * R325 across files: a route's one `Page` may be drawn by the one connected block the page owner renders as its root (one
 * level, the block's two halves), a page owner mounted only under the auth route group is framed by that group's layout,
 * and a route segment layout whose owner draws a `Page` with `header.tabs` is the one `Page` of every route under it.
 *
 *   node --test src/page-owners.spec.ts
 */
import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import type { TestContext } from "node:test"
import { Linter } from "eslint"
import parser from "@typescript-eslint/parser"
import { loadHfs } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import type { ProjectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import { routePageIsOnePage } from "./page.ts"

const PAGES = "apps/web/src/features/pages"
const LAYOUTS = "apps/web/src/features/layouts"
const BLOCKS = "apps/web/src/components/blocks"
const ROUTES = "apps/web/src/app/[locale]"
const GRAMMAR = 'import { Page, SurfaceCard } from "@starci/grammar/common";'

/** A page owner's pure half that renders `body`, importing the named blocks of the app. */
const owner = (body: string, ...blocks: readonly string[]): string =>
  `${blocks.map((name) => `import { ${name} } from "@/components/blocks/${name}";`).join(" ")} export const OwnerBase = () => ${body}`

const fixture = (t: TestContext, edition: "full" | "lite"): ProjectFixture => {
  const app = projectFixture({ profile: "fe", edition, files: {
    // a connected head block whose pure half draws the Page from client data
    [`${BLOCKS}/AgentHead/index.tsx`]: 'import { AgentHeadBase } from "./component"; export const AgentHead = ({ children }) => <AgentHeadBase title={useTitle()}>{children}</AgentHeadBase>',
    [`${BLOCKS}/AgentHead/component.tsx`]: `${GRAMMAR} export const AgentHeadBase = ({ title, children }) => <Page header={{ title }}>{children}</Page>`,
    // a block that draws the Page in its connected half
    [`${BLOCKS}/DecisionsBoard/index.tsx`]: `${GRAMMAR} export const DecisionsBoard = () => <Page header={{ title: useTitle() }}><SurfaceCard /></Page>`,
    // a block that draws no Page, and one that only relays to a block that does (two levels)
    [`${BLOCKS}/AgentCard/index.tsx`]: `${GRAMMAR} export const AgentCard = () => <SurfaceCard />`,
    [`${BLOCKS}/Relay/index.tsx`]: 'import { AgentHead } from "@/components/blocks/AgentHead"; export const Relay = () => <AgentHead><span /></AgentHead>',
    // the auth route group and its layout, an auth page mounted in it, a callback mounted outside it
    [`${ROUTES}/(auth)/layout.tsx`]: 'import { AuthLayout } from "@/features/layouts/AuthLayout"; const Layout = ({ children }) => <AuthLayout>{children}</AuthLayout>; export default Layout',
    [`${ROUTES}/(auth)/login/page.tsx`]: 'import { LoginPage } from "@/features/pages/LoginPage"; const Route = () => <LoginPage />; export default Route',
    [`${ROUTES}/(console)/zalo/callback/page.tsx`]: 'import { ZaloCallbackPage } from "@/features/pages/ZaloCallbackPage"; const Route = () => <ZaloCallbackPage />; export default Route',
    // an auth group with no layout of its own frames nothing; an owner mounted inside and outside the group is no auth page
    [`${ROUTES}/(public)/(auth)/signup/page.tsx`]: 'import { SignupPage } from "@/features/pages/SignupPage"; const Route = () => <SignupPage />; export default Route',
    [`${ROUTES}/(auth)/reset/page.tsx`]: 'import { ResetPage } from "@/features/pages/ResetPage"; const Route = () => <ResetPage />; export default Route',
    [`${ROUTES}/(console)/reset/page.tsx`]: 'import { ResetPage } from "@/features/pages/ResetPage"; const Route = () => <ResetPage />; export default Route',
    // a tabbed segment: its layout owner draws, through its pure half and the connected frame block, the one Page with link tabs
    [`${BLOCKS}/InstanceFrame/index.tsx`]: 'import { InstanceFrameBase } from "./component"; export const InstanceFrame = ({ children }) => <InstanceFrameBase title={useTitle()}>{children}</InstanceFrameBase>',
    [`${BLOCKS}/InstanceFrame/component.tsx`]: `${GRAMMAR} export const InstanceFrameBase = ({ title, children }) => <Page chrome="bleed" header={{ title, tabs: { label: "Instance", items: [{ id: "setup", label: "Setup", href: "/setup" }] } }}>{children}</Page>`,
    [`${LAYOUTS}/InstanceLayout/index.tsx`]: 'import { InstanceLayoutBase } from "./component"; export const InstanceLayout = ({ children }) => <InstanceLayoutBase>{children}</InstanceLayoutBase>',
    [`${LAYOUTS}/InstanceLayout/component.tsx`]: 'import { InstanceFrame } from "@/components/blocks/InstanceFrame"; export const InstanceLayoutBase = ({ children }) => <InstanceFrame>{children}</InstanceFrame>',
    [`${ROUTES}/(console)/agents/[installation]/layout.tsx`]: 'import { InstanceLayout } from "@/features/layouts/InstanceLayout"; const Layout = ({ children }) => <InstanceLayout>{children}</InstanceLayout>; export default Layout',
    [`${ROUTES}/(console)/agents/[installation]/page.tsx`]: 'import { SetupPage } from "@/features/pages/SetupPage"; const Route = () => <SetupPage />; export default Route',
    [`${ROUTES}/(console)/agents/[installation]/settings/page.tsx`]: 'import { SettingsPage } from "@/features/pages/SettingsPage"; const Route = () => <SettingsPage />; export default Route',
    // a route outside the segment that only borrows the owner's metadata (and a type) mounts another page, not the owner
    [`${ROUTES}/(console)/agents/settings/page.tsx`]: 'import { RedirectPage } from "@/features/pages/RedirectPage"\nimport type { SettingsProps } from "@/features/pages/SettingsPage"\nexport { settingsMetadata as generateMetadata } from "@/features/pages/SettingsPage"\nconst Route = () => <RedirectPage />; export default Route',
    // a layout owner that draws its tabbed Page in place, the header held in a const
    [`${LAYOUTS}/BillingLayout/index.tsx`]: `${GRAMMAR} const header = { title: "Billing", tabs: { label: "Billing", items: [] } }; export const BillingLayout = ({ children }) => <Page header={header}>{children}</Page>`,
    [`${ROUTES}/(console)/billing/layout.tsx`]: 'import { BillingLayout } from "@/features/layouts/BillingLayout"; const Layout = ({ children }) => <BillingLayout>{children}</BillingLayout>; export default Layout',
    [`${ROUTES}/(console)/billing/invoices/page.tsx`]: 'import { InvoicesPage } from "@/features/pages/InvoicesPage"; const Route = () => <InvoicesPage />; export default Route',
    // a layout whose Page carries no tabs heads no segment: the pages under it draw their own Page
    [`${LAYOUTS}/AdminLayout/index.tsx`]: `${GRAMMAR} export const AdminLayout = ({ children }) => <Page measure="full">{children}</Page>`,
    [`${ROUTES}/admin/layout.tsx`]: 'import { AdminLayout } from "@/features/layouts/AdminLayout"; const Layout = ({ children }) => <AdminLayout>{children}</AdminLayout>; export default Layout',
    [`${ROUTES}/admin/users/page.tsx`]: 'import { UsersPage } from "@/features/pages/UsersPage"; const Route = () => <UsersPage />; export default Route',
    // an owner mounted inside the tabbed segment and outside it
    [`${ROUTES}/(console)/agents/[installation]/logs/page.tsx`]: 'import { LogsPage } from "@/features/pages/LogsPage"; const Route = () => <LogsPage />; export default Route',
    [`${ROUTES}/(console)/logs/page.tsx`]: 'import { LogsPage } from "@/features/pages/LogsPage"; const Route = () => <LogsPage />; export default Route',
  } })
  t.after(app.cleanup)
  return app
}

const verifyAt = (app: ProjectFixture, file: string, code: string) => new Linter({ cwd: app.root }).verify(code, [{
  files: ["**/*.tsx"],
  languageOptions: { parser, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { starci: { hfs: loadHfs(pathToFileURL(path.join(app.root, "eslint.config.mjs")).href) } },
  plugins: { page: { rules: { "route-page-is-one-page": routePageIsOnePage } } },
  rules: { "page/route-page-is-one-page": "error" },
}], { filename: app.at(file) })

/** Lint `code` as the pure half of the page owner `page`. */
const verify = (app: ProjectFixture, page: string, code: string) => verifyAt(app, `${PAGES}/${page}/component.tsx`, code)

/** The message ids of the findings. */
const ids = (findings: readonly Linter.LintMessage[]): (string | undefined)[] => findings.map((finding) => finding.messageId)

for (const edition of ["full", "lite"] as const) {
  test(`${edition} the one root block that draws the Page frames the route`, (t) => {
    const app = fixture(t, edition)
    // the head block draws the Page through its pure half; what the owner hands it is the Page body
    assert.deepEqual(ids(verify(app, "AgentProfilePage", owner("<AgentHead><AgentCard /><AgentCard /></AgentHead>", "AgentHead", "AgentCard"))), [])
    assert.deepEqual(ids(verify(app, "DecisionsPage", owner("<DecisionsBoard />", "DecisionsBoard"))), [])
    // alone in a fragment, and one root block per branch
    assert.deepEqual(ids(verify(app, "DecisionsPage", owner("<><DecisionsBoard /></>", "DecisionsBoard"))), [])
    assert.deepEqual(ids(verify(app, "DecisionsPage", owner("ready ? <DecisionsBoard /> : <AgentHead><AgentCard /></AgentHead>", "DecisionsBoard", "AgentHead", "AgentCard"))), [])
  })

  test(`${edition} siblings beside the root block, two Pages, a Page-less block and a relayed block stay red`, (t) => {
    const app = fixture(t, edition)
    assert.deepEqual(ids(verify(app, "DecisionsPage", owner("<><AgentCard /><DecisionsBoard /></>", "DecisionsBoard", "AgentCard"))), ["sibling"])
    assert.deepEqual(ids(verify(app, "DecisionsPage", owner("<div><DecisionsBoard />{footer}</div>", "DecisionsBoard"))), ["sibling"])
    assert.deepEqual(ids(verify(app, "DecisionsPage", owner("<AgentHead><DecisionsBoard /></AgentHead>", "DecisionsBoard", "AgentHead"))), ["twice"])
    assert.deepEqual(ids(verify(app, "DecisionsPage", `${GRAMMAR} ${owner("<Page header={{ title }}><DecisionsBoard /></Page>", "DecisionsBoard")}`)), ["twice"])
    assert.deepEqual(ids(verify(app, "AgentProfilePage", owner("<AgentCard />", "AgentCard"))), ["missing"])
    assert.deepEqual(ids(verify(app, "AgentProfilePage", owner("<Relay />", "Relay"))), ["missing"])
  })

  test(`${edition} a page owner mounted only under the auth route group is framed by its layout`, (t) => {
    const app = fixture(t, edition)
    assert.deepEqual(ids(verify(app, "LoginPage", owner("<AgentCard />", "AgentCard"))), [])
    // a callback outside the group, a group with no layout, a page also mounted elsewhere, and a page no route mounts
    for (const page of ["ZaloCallbackPage", "SignupPage", "ResetPage", "OrphanPage"]) {
      assert.deepEqual(ids(verify(app, page, owner("<AgentCard />", "AgentCard"))), ["missing"], page)
    }
  })

  test(`${edition} a segment layout that draws the Page with header.tabs is the one Page of the routes under it`, (t) => {
    const app = fixture(t, edition)
    // the tab pages draw body content only: no Page needed, through a block frame or a Page drawn in the layout itself
    for (const page of ["SetupPage", "SettingsPage", "InvoicesPage"]) {
      assert.deepEqual(ids(verify(app, page, owner("<div><AgentCard /><AgentCard /></div>", "AgentCard"))), [], page)
    }
    // a tab page that adds its own Page, directly or through a root block, draws a second one
    const twice = verify(app, "SettingsPage", `${GRAMMAR} ${owner("<Page header={{ title }}><AgentCard /></Page>", "AgentCard")}`)
    assert.deepEqual(ids(twice), ["twice"])
    assert.match(twice[0]?.message ?? "", /\(console\)\/agents\/\[installation\]\/layout\.tsx/)
    assert.deepEqual(ids(verify(app, "SetupPage", `${GRAMMAR} ${owner("<Page chrome=\"bleed\" header={{ breadcrumbs }}><AgentCard /></Page>", "AgentCard")}`)), ["twice"])
    assert.deepEqual(ids(verify(app, "InvoicesPage", owner("<DecisionsBoard />", "DecisionsBoard"))), ["twice"])
  })

  test(`${edition} an untabbed layout Page frames no segment, and a page mounted inside and outside one is judged both ways`, (t) => {
    const app = fixture(t, edition)
    assert.deepEqual(ids(verify(app, "UsersPage", owner("<AgentCard />", "AgentCard"))), ["missing"])
    assert.deepEqual(ids(verify(app, "UsersPage", `${GRAMMAR} ${owner("<Page header={{ title }}><AgentCard /></Page>", "AgentCard")}`)), [])
    assert.deepEqual(ids(verify(app, "LogsPage", owner("<AgentCard />", "AgentCard"))), ["missing"])
    assert.deepEqual(ids(verify(app, "LogsPage", `${GRAMMAR} ${owner("<Page header={{ title }}><AgentCard /></Page>", "AgentCard")}`)), ["twice"])
  })

  test(`${edition} a layout owner's Page, drawn through its root block, has nothing beside it`, (t) => {
    const app = fixture(t, edition)
    const layout = `${LAYOUTS}/InstanceLayout/component.tsx`
    const frame = 'import { InstanceFrame } from "@/components/blocks/InstanceFrame"; import { InstanceHeader } from "@/components/blocks/AgentCard";'
    assert.deepEqual(ids(verifyAt(app, layout, `${frame} export const InstanceLayoutBase = ({ children }) => <InstanceFrame>{children}</InstanceFrame>`)), [])
    assert.deepEqual(ids(verifyAt(app, layout, `${frame} export const InstanceLayoutBase = ({ children }) => <><InstanceHeader /><InstanceFrame>{children}</InstanceFrame></>`)), ["sibling"])
  })
}
