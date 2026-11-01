/**
 * Twin tests for the page header law (R323): a page head is Page `header`, never `PageHeader` or `Breadcrumbs` imported by
 * hand. The law reduces to imports: both are Page's parts and no longer exported.
 *
 *   node --test src/page-header.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noHandRolledPageHeader, recommended, rules } from "./page-header.ts"

const PAGE = at("apps/web/src/components/blocks/ConnectionPage/component.tsx")
const SCRIPT = at("scripts/build.tsx")

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-hand-rolled-page-header"])
  assert.deepEqual(recommended, { "starci-grammar/no-hand-rolled-page-header": "error" })
})

test("R323: PageHeader and Breadcrumbs are refused where they are imported from the Grammar", () => {
  slotTester().run("no-hand-rolled-page-header", noHandRolledPageHeader, {
    valid: [
      // the head is Page's header
      { filename: PAGE, code: "import { Page } from \"@starci/grammar/core\"\nexport const A = () => <Page header={{ breadcrumbs: { label: \"Breadcrumb\", items }, title: \"Main account\" }}><Card /></Page>" },
      // the types of the header's slots stay public
      { filename: PAGE, code: "import type { PageHeaderBreadcrumbs, PageHeaderTabs } from \"@starci/grammar/core\"\nexport type A = PageHeaderBreadcrumbs | PageHeaderTabs" },
      // the same names from another module are not the Grammar's
      { filename: PAGE, code: "import { PageHeader } from \"./PageHeader\"\nexport const A = () => <PageHeader title=\"Main account\" />" },
      // a script is not product source
      { filename: SCRIPT, code: "import { PageHeader } from \"@starci/grammar/core\"\nexport const A = () => <PageHeader title=\"Main account\" />" },
    ],
    invalid: [
      { filename: PAGE, code: "import { PageHeader } from \"@starci/grammar/core\"\nexport const A = () => <PageHeader title=\"Main account\" />", errors: [{ messageId: "handRolled", data: { name: "PageHeader" } }] },
      { filename: PAGE, code: "import { Breadcrumbs, Text } from \"@starci/grammar\"\nexport const A = () => <Breadcrumbs label=\"Breadcrumb\" items={items} />", errors: [{ messageId: "handRolled", data: { name: "Breadcrumbs" } }] },
      // an alias is still the export
      { filename: PAGE, code: "import { PageHeader as Head } from \"@starci/grammar/common\"\nexport const A = () => <Head title=\"Main account\" />", errors: [{ messageId: "handRolled", data: { name: "PageHeader" } }] },
      // through a namespace, in a tag and in an expression
      { filename: PAGE, code: "import * as G from \"@starci/grammar/core\"\nexport const A = () => <G.PageHeader title=\"Main account\" />", errors: [{ messageId: "handRolled", data: { name: "PageHeader" } }] },
      { filename: PAGE, code: "import * as G from \"@starci/grammar/core\"\nexport const trail = G.Breadcrumbs", errors: [{ messageId: "handRolled", data: { name: "Breadcrumbs" } }] },
    ],
  })
})
