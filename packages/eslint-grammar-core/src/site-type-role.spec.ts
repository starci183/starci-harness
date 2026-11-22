/**
 * Twin tests for the site group law (SITE-TYPE-ROLES): display.*, lead and title.card are the public site's roles only.
 *
 *   node --test src/site-type-role.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, slotTester } from "../../eslint-canon-fe/fixtures/typed/tester.ts"
import { recommended } from "./index.ts"
import { SITE_ROLES, rules, siteTypeRole } from "./site-type-role.ts"

const SITE_HEAD = at("apps/web/src/components/composites/SiteHead/classNames.ts")
const SITE_PAGE = at("apps/web/src/features/pages/SiteBrandPage/component.tsx")
const SITE_ROUTE = at("apps/web/src/app/[locale]/(site)/home/page.tsx")
const SITE_COPY = at("apps/web/src/modules/site-home/index.ts")
const MARKETING = at("apps/web/src/components/blocks/MarketingHero/index.tsx")
const CONSOLE = at("apps/web/src/components/blocks/Overview/component.tsx")
const CONSOLE_PAGE = at("apps/web/src/features/pages/SettingsPage/component.tsx")
const CONSOLE_ROUTE = at("apps/web/src/app/[locale]/(pages)/workspaces/page.tsx")
const SITUATION = at("apps/web/src/components/composites/Situation/index.tsx")
const code = (body: string): string => `export const A = () => ${body}`

test("the law publishes one rule, blocking, for the five roles of the site group", () => {
  assert.deepEqual(Object.keys(rules), ["site-type-role"])
  assert.equal(recommended["starci-grammar/site-type-role"], "error")
  assert.deepEqual([...SITE_ROLES], ["display.hero", "display.section", "display.figure", "lead", "title.card"])
})

test("SITE-TYPE-ROLES: a site role in the console is an error; on the site, and the ten roles anywhere, it is valid", () => {
  slotTester().run("site-type-role", siteTypeRole, {
    valid: [
      { filename: SITE_HEAD, code: "export const DISPLAY = \"starci-type-display-hero mt-5 text-balance\"" },
      { filename: SITE_PAGE, code: code("<Text role=\"lead\">x</Text>") },
      { filename: SITE_ROUTE, code: code("<h2 className=\"starci-type-display-section\">x</h2>") },
      { filename: SITE_COPY, code: "export const CARD = \"starci-type-title-card\"" },
      { filename: MARKETING, code: code("<Text role=\"display.figure\">x</Text>") },
      { filename: CONSOLE, code: code("<Text role=\"title.page\">x</Text>") },
      { filename: CONSOLE, code: code("<span className=\"starci-type-figure starci-type-title-section\" />") },
      { filename: CONSOLE, code: code("<span className=\"starci-type-leading\" role=\"lead\" />") },
    ],
    invalid: [
      { filename: CONSOLE, code: code("<Text role=\"display.hero\">x</Text>"), errors: [{ messageId: "role", data: { role: "display.hero" } }] },
      { filename: CONSOLE, code: code("<Text role={\"lead\"}>x</Text>"), errors: [{ messageId: "role", data: { role: "lead" } }] },
      { filename: CONSOLE_PAGE, code: code("<h3 className=\"starci-type-title-card mt-2\">x</h3>"), errors: [{ messageId: "role", data: { role: "starci-type-title-card" } }] },
      { filename: CONSOLE_ROUTE, code: code("<p className={cn(\"flex\", big && \"starci-type-display-section\")}>x</p>"), errors: [{ messageId: "role" }] },
      { filename: SITUATION, code: "const BIG = \"starci-type-display-figure\"; export const A = () => <span className={BIG} />", errors: [{ messageId: "role" }] },
    ],
  })
})
