/**
 * Twin tests for the page frame laws: page tabs are the header's tabs (R324), and a page owner draws one `Page` with
 * nothing beside it (R325).
 *
 *   node --test src/page.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { pageTabsInHeader, recommended, routePageIsOnePage, rules } from "./page.ts"

const OWNER = at("apps/web/src/features/pages/ConnectionPage/component.tsx")
const OWNER_INDEX = at("apps/web/src/features/pages/ConnectionPage/index.tsx")
const BOUNDARY = at("apps/web/src/features/pages/AppNotFoundPage/index.tsx")
const LAYOUT = at("apps/web/src/features/layouts/Workspace/component.tsx")
const BLOCK = at("apps/web/src/components/blocks/ConnectionTabs/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const TABS = "<Tabs label=\"Connection\" items={items} selectedKey={tab} onSelect={setTab} />"
const HEADER = "header={{ title: \"Main account\" }}"

test("the laws publish two rules and both are errors", () => {
  assert.deepEqual(Object.keys(rules), ["page-tabs-in-header", "route-page-is-one-page"])
  assert.deepEqual(recommended, { "starci-grammar/page-tabs-in-header": "error", "starci-grammar/route-page-is-one-page": "error" })
})

test("R324: a Tabs at the top of a Page body or right after a PageHeader is a page tab bar outside the band", () => {
  slotTester().run("page-tabs-in-header", pageTabsInHeader, {
    valid: [
      // the header's tabs
      { filename: OWNER, code: "export const A = () => <Page header={{ title: \"Main account\", tabs: { label: \"Connection\", items, selectedKey, onSelect } }}><Card /></Page>" },
      { filename: BLOCK, code: "export const A = () => <PageHeader title=\"Main account\" tabs={{ label: \"Connection\", items, selectedKey, onSelect }} />" },
      // region tabs lower in the body
      { filename: OWNER, code: `export const A = () => <Page ${HEADER}><Card />${TABS}</Page>` },
      // tabs inside a body section, not at the top of the body
      { filename: OWNER, code: `export const A = () => <Page ${HEADER}><SurfaceCard label="Usage">${TABS}</SurfaceCard></Page>` },
      // a PageHeader followed by something else
      { filename: BLOCK, code: `export const A = () => <><PageHeader title="Main account" /><Card />${TABS}</>` },
      // a script is not product source
      { filename: SCRIPT, code: `export const A = () => <Page ${HEADER}>${TABS}</Page>` },
    ],
    invalid: [
      { filename: OWNER, code: `export const A = () => <Page ${HEADER}>${TABS}<Card /></Page>`, errors: [{ messageId: "outside" }] },
      // whitespace and comments before it are not children; a namespace still names it
      { filename: OWNER, code: `export const A = () => <G.Page ${HEADER}>\n  {/* the tabs */}\n  <G.Tabs label="Connection" items={items} /></G.Page>`, errors: [{ messageId: "outside" }] },
      { filename: BLOCK, code: `export const A = () => <div><PageHeader title="Main account" />${TABS}</div>`, errors: [{ messageId: "outside" }] },
      { filename: LAYOUT, code: `export const A = () => <><PageHeader title="Main account" />\n  ${TABS}</>`, errors: [{ messageId: "outside" }] },
    ],
  })
})

test("R325: a page owner draws one Page with nothing beside it and no bare PageHeader or PageContainer", () => {
  slotTester().run("route-page-is-one-page", routePageIsOnePage, {
    valid: [
      { filename: OWNER, code: `export const A = () => <Page ${HEADER}><Card /></Page>` },
      // a Page alone in a fragment or a provider has no sibling
      { filename: OWNER, code: `export const A = () => <><Page ${HEADER}><Card /></Page></>` },
      { filename: OWNER, code: `export const A = () => <FormProvider value={form}>\n  <Page ${HEADER}><Card /></Page>\n</FormProvider>` },
      // one Page per branch
      { filename: OWNER, code: `export const A = ({ ready }) => ready ? <Page ${HEADER}><Card /></Page> : <Page ${HEADER} isSkeleton><Card /></Page>` },
      // outside a page owner the parts are not judged by this law
      { filename: LAYOUT, code: "export const A = () => <><PageHeader title=\"Main account\" /><PageContainer><Card /></PageContainer></>" },
      { filename: BLOCK, code: "export const A = () => <PageContainer><Card /></PageContainer>" },
      // a connected half draws through its own pure half, which owns the Page
      { filename: OWNER_INDEX, code: "import { ConnectionPageBase } from \"./component\"\nexport const A = () => <><ConnectionPageBase /><GuideOverlay /></>" },
      // a segment boundary owner draws its notice
      { filename: BOUNDARY, code: "export const A = () => <NotFoundNotice title={title} />" },
      // a page owner file with no JSX is not judged
      { filename: OWNER, code: "export const copy = { title: \"Main account\" }" },
      // a page owner that draws no UI: it only redirects, only refuses, or returns null
      { filename: OWNER_INDEX, code: "import { redirect } from \"next/navigation\"\nexport const A = () => redirect(\"/en/home\")" },
      { filename: OWNER_INDEX, code: "import { notFound } from \"next/navigation\"\nexport const A = async () => { notFound() }" },
      { filename: OWNER, code: "export const A = () => null" },
    ],
    invalid: [
      { filename: OWNER, code: `export const A = () => <><Banner /><Page ${HEADER}><Card /></Page></>`, errors: [{ messageId: "sibling" }] },
      { filename: OWNER, code: `export const A = () => <div><Page ${HEADER}><Card /></Page>{footer}</div>`, errors: [{ messageId: "sibling" }] },
      // two Pages: one inside the other
      { filename: OWNER, code: `export const A = () => <Page ${HEADER}><Card /><Page ${HEADER}><Card /></Page></Page>`, errors: [{ messageId: "twice" }] },
      { filename: OWNER, code: "export const A = () => <><PageHeader title=\"Main account\" /><PageContainer><Card /></PageContainer></>", errors: [{ messageId: "part", data: { name: "PageHeader" } }, { messageId: "part", data: { name: "PageContainer" } }] },
      { filename: OWNER, code: `export const A = () => <Page ${HEADER}><G.PageContainer measure="reading"><Card /></G.PageContainer></Page>`, errors: [{ messageId: "part", data: { name: "PageContainer" } }] },
      // no Page at all: a heading and blocks on no frame
      { filename: OWNER, code: "export const A = () => <><Heading level={1}>Home</Heading><SignInForm /></>", errors: [{ messageId: "missing" }] },
      // an element imported from elsewhere is no pure half
      { filename: OWNER_INDEX, code: "import { HomeView } from \"@/components/blocks/HomeView\"\nexport const A = () => <HomeView />", errors: [{ messageId: "missing" }] },
    ],
  })
})
