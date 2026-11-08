/**
 * Twin tests for the breadcrumbs law (PAGE-BREADCRUMBS): the header of a console `Page` states `breadcrumbs`.
 *
 *   node --test src/page-breadcrumbs.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { pageBreadcrumbs, recommended, rules } from "./page-breadcrumbs.ts"

const OWNER = at("apps/web/src/features/pages/ConnectionPage/component.tsx")
const LAYOUT = at("apps/web/src/features/layouts/Workspace/component.tsx")
const BLOCK = at("apps/web/src/components/blocks/ConnectionTabs/component.tsx")
const BOUNDARY = at("apps/web/src/features/pages/AppNotFoundPage/index.tsx")
const SCRIPT = at("scripts/build.tsx")
const IMPORTS = "import * as G from \"@starci/grammar/core\"\nimport { Page } from \"@starci/grammar/core\"\n"
const missing = { messageId: "missing" }
const code = (body: string): string => `${IMPORTS}${body}`

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["page-breadcrumbs"])
  assert.deepEqual(recommended, { "starci-grammar/page-breadcrumbs": "error" })
})

test("PAGE-BREADCRUMBS: a console Page header states its breadcrumbs", () => {
  slotTester().run("page-breadcrumbs", pageBreadcrumbs, {
    valid: [
      // a trail
      { filename: OWNER, code: code("export const A = () => <Page header={{ title: \"Main account\", breadcrumbs: { label: \"Trail\", items } }}><Card /></Page>") },
      // the root page
      { filename: OWNER, code: code("export const A = () => <Page header={{ title: \"Overview\", breadcrumbs: \"root\" }}><Card /></Page>") },
      { filename: OWNER, code: code("export const A = () => <Page header={{ title: \"Overview\", \"breadcrumbs\": \"root\" }} />") },
      // no header: a sign-in card, a landing
      { filename: OWNER, code: code("export const A = () => <Page><Card /></Page>") },
      // a header that is not an object literal
      { filename: OWNER, code: code("export const A = ({ header }) => <Page header={header} />") },
      { filename: OWNER, code: code("import { header } from \"./header\"\nexport const A = () => <Page header={header} />") },
      { filename: OWNER, code: code("export const A = () => <Page header={makeHeader(1)} />") },
      // a spread may carry it
      { filename: OWNER, code: code("export const A = () => <Page header={{ ...base, title: \"X\" }} />") },
      // a same-file const that states it
      { filename: OWNER, code: code("const header = { title: \"X\", breadcrumbs: \"root\" }\nexport const A = () => <Page header={header} />") },
      // a segment boundary owner draws a notice
      { filename: BOUNDARY, code: code("export const A = () => <Page header={{ title: \"Not found\" }} />") },
      // not the Grammar's Page
      { filename: OWNER, code: "import { Page } from \"./mine\"\nexport const A = () => <Page header={{ title: \"X\" }} />" },
      // a script is not product source
      { filename: SCRIPT, code: code("export const A = () => <Page header={{ title: \"X\" }} />") },
    ],
    invalid: [
      { filename: OWNER, code: code("export const A = () => <Page header={{ title: \"Main account\" }}><Card /></Page>"), errors: [missing] },
      { filename: OWNER, code: code("export const A = () => <G.Page header={{ title: \"Main account\", actions }} />"), errors: [missing] },
      // a layout owner and an app block draw the Page too
      { filename: LAYOUT, code: code("export const A = () => <Page header={{ title: \"Workspace\", tabs }} />"), errors: [missing] },
      { filename: BLOCK, code: code("export const A = () => <Page header={{ title: \"Connection\" }} />"), errors: [missing] },
      // a same-file const
      { filename: OWNER, code: code("const header = { title: \"X\" }\nexport const A = () => <Page header={header} />"), errors: [missing] },
      // a computed key is not the property
      { filename: OWNER, code: code("export const A = () => <Page header={{ title: \"X\", [breadcrumbs]: 1 }} />"), errors: [missing] },
    ],
  })
})
