/**
 * R325 across files: a route's one `Page` may be drawn by the one connected block the page owner renders as its root (one
 * level, the block's two halves), and a page owner mounted only under the auth route group is framed by that group's layout.
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
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.mjs"
import type { ProjectFixture } from "../../eslint-canon-be/fixtures/project/tester.mjs"
import { routePageIsOnePage } from "./page.ts"

const PAGES = "apps/web/src/features/pages"
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
  } })
  t.after(app.cleanup)
  return app
}

const verify = (app: ProjectFixture, page: string, code: string) => new Linter({ cwd: app.root }).verify(code, [{
  files: ["**/*.tsx"],
  languageOptions: { parser, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { starci: { hfs: loadHfs(pathToFileURL(path.join(app.root, "eslint.config.mjs")).href) } },
  plugins: { page: { rules: { "route-page-is-one-page": routePageIsOnePage } } },
  rules: { "page/route-page-is-one-page": "error" },
}], { filename: app.at(`${PAGES}/${page}/component.tsx`) })

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
}
