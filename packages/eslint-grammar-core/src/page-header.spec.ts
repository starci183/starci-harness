/**
 * Twin tests for the page header law (R323): a page head is Grammar's `PageHeader`, never a `Breadcrumbs` trail and a
 * `SectionHeader` composed by hand.
 *
 *   node --test src/page-header.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { noHandRolledPageHeader, recommended, rules } from "./page-header.ts"

const PAGE = at("apps/web/src/components/blocks/ConnectionPage/component.tsx")
const SCRIPT = at("scripts/build.tsx")
const TRAIL = "<Breadcrumbs label=\"Breadcrumb\" items={items} />"

test("the law publishes one rule and it is an error", () => {
  assert.deepEqual(Object.keys(rules), ["no-hand-rolled-page-header"])
  assert.deepEqual(recommended, { "starci-grammar/no-hand-rolled-page-header": "error" })
})

test("R323: a Breadcrumbs trail followed by a SectionHeader in one parent is a hand-rolled page head", () => {
  slotTester().run("no-hand-rolled-page-header", noHandRolledPageHeader, {
    valid: [
      // the Grammar page header
      { filename: PAGE, code: "export const A = () => <PageHeader breadcrumbs={{ label: \"Breadcrumb\", items }} title=\"Main account\" />" },
      // a region's section header under the page head is not a page head
      { filename: PAGE, code: "export const A = () => <><PageHeader title=\"Main account\" /><PageContainer><SectionHeader title=\"Webhook\" /></PageContainer></>" },
      // a trail and a heading in different parents are not one head
      { filename: PAGE, code: `export const A = () => <div><nav>${TRAIL}</nav><SectionHeader title="Main account" level={1} /></div>` },
      // a heading before the trail is not the head's order
      { filename: PAGE, code: `export const A = () => <div><SectionHeader title="Main account" level={1} />${TRAIL}</div>` },
      // either alone
      { filename: PAGE, code: `export const A = () => <div>${TRAIL}</div>` },
      { filename: PAGE, code: "export const A = () => <div><SectionHeader title=\"Main account\" /></div>" },
      // a script is not product source
      { filename: SCRIPT, code: `export const A = () => <div>${TRAIL}<SectionHeader title="Main account" level={1} /></div>` },
    ],
    invalid: [
      { filename: PAGE, code: `export const A = () => <div>${TRAIL}<SectionHeader title="Main account" level={1} /></div>`, errors: [{ messageId: "handRolled" }] },
      // in a fragment, with other children between, and through a namespace
      { filename: PAGE, code: `export const A = () => <>${TRAIL}<Text>Sub</Text><SectionHeader title="Main account" /></>`, errors: [{ messageId: "handRolled" }] },
      { filename: PAGE, code: "export const A = () => <div><G.Breadcrumbs label=\"Breadcrumb\" items={items} /><G.SectionHeader title=\"Main account\" level={1} /></div>", errors: [{ messageId: "handRolled" }] },
    ],
  })
})
