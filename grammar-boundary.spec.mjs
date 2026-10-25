/**
 * Twin tests for the grammar boundary (R62 family: the grammar owns the element).
 *
 *   node --test grammar-boundary.spec.mjs
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { at, slotTester } from "./fixtures/typed/tester.mjs"
import { GRAMMAR_OWNERS, noAppRelativeClock, noRawStructuralElement, recommended, rules } from "./grammar-boundary.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const GRAMMAR_SRC = join(HERE, "..", "..", "grammar", "src")

/** Every source file under a directory, without specs and stories. */
const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "stories" || entry.name === "__test__" ? [] : sources(path)
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:spec|test|stories)\./.test(entry.name) ? [path] : []
  })

test("the law publishes its rules at error", () => {
  assert.deepEqual(Object.keys(rules), ["no-raw-structural-element", "no-app-relative-clock"])
  assert.deepEqual(recommended, { "starci-fe/no-raw-structural-element": "error", "starci-fe/no-app-relative-clock": "error" })
})

test("every tag the rule refuses is rendered by a component the grammar package exports", () => {
  const text = sources(GRAMMAR_SRC).map((file) => readFileSync(file, "utf8")).join("\n")
  for (const [tag, owners] of Object.entries(GRAMMAR_OWNERS)) {
    for (const component of owners.split(/,| or /).map((name) => name.trim()).filter(Boolean)) {
      assert.match(text, new RegExp(`export (?:const|function) ${component}\\b`), `<${tag}> names ${component}, which the grammar does not export`)
    }
  }
})

test("a tag the grammar has no component for is not refused", () => {
  for (const tag of ["div", "br", "aside", "article", "time"]) assert.equal(Object.hasOwn(GRAMMAR_OWNERS, tag), false, tag)
})

test("FE-GRAMMAR-1: page structure and text are grammar components, not raw tags", () => {
  const FEATURE = at("apps/web/src/features/pages/home/component.tsx")
  const BLOCK = at("apps/web/src/components/blocks/Feed/component.tsx")
  const raw = (tag) => `export const A = () => <${tag}>x</${tag}>`
  slotTester().run("no-raw-structural-element", noRawStructuralElement, {
    valid: [
      // grammar components compose the structure
      { filename: FEATURE, code: "import { Heading, Text } from \"@starci/grammar\"\nexport const A = () => <Heading level={1}><Text>x</Text></Heading>" },
      // a named non-card region and a plain semantic list are grammar components too
      { filename: FEATURE, code: "import { List, ListItem, NavLandmark, Region } from \"@starci/grammar\"\nexport const A = () => <Region labelledBy=\"t\" spacing=\"spaced\"><NavLandmark label=\"n\" layout=\"bar\">n</NavLandmark><List label=\"y\"><ListItem>z</ListItem></List></Region>" },
      { filename: BLOCK, code: "import { SurfaceCard } from \"@nivo/ui\"\nexport const A = () => <SurfaceCard>x</SurfaceCard>" },
      // a tag the grammar has no component for stays available: layout wrappers and line breaks
      { filename: FEATURE, code: raw("div") },
      { filename: FEATURE, code: "export const A = () => <div className={classNames.root}>x<br /></div>" },
      { filename: FEATURE, code: raw("aside") },
      { filename: FEATURE, code: raw("article") },
      // Absolute timestamps remain semantic native times; RelativeTime owns live relative/countdown labels.
      { filename: FEATURE, code: 'export const A = () => <time dateTime="2026-10-25T12:00:00Z">12:00 UTC</time>' },
      // the document shell and native controls belong to other rules
      { filename: at("apps/web/src/app/[locale]/layout.tsx"), code: "export default () => <html lang={locale}><body>{children}</body></html>" },
      // a member component is not an intrinsic element
      { filename: FEATURE, code: "export const A = () => <Card.Section><Ui.Text>x</Ui.Text></Card.Section>" },
      // a capitalised component that shares a tag's spelling is a component
      { filename: FEATURE, code: "export const A = () => <Section>x</Section>" },
      // the renderers themselves draw raw tags
      { filename: at("packages/nivo-ui/src/leaves/Note/component.tsx"), code: raw("p") },
      { filename: at("packages/nivo-ui/src/composites/Panel/index.tsx"), code: raw("section") },
      // a file no slot owns is not judged here
      { filename: at("scripts/render.tsx"), code: raw("p") },
    ],
    invalid: [
      { filename: FEATURE, code: raw("p"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("span"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("h2"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("ul"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("li"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("nav"), errors: [{ messageId: "raw", data: { tag: "nav", owner: "`NavLandmark, Subnav, Breadcrumbs or NavigationFeatureNav`" } }] },
      { filename: FEATURE, code: raw("section"), errors: [{ messageId: "raw", data: { tag: "section", owner: "`Region or SurfaceCard`" } }] },
      { filename: FEATURE, code: raw("header"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("footer"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("main"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("form"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("label"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("fieldset"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: raw("figure"), errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: "export const A = () => <hr />", errors: [{ messageId: "raw" }] },
      { filename: FEATURE, code: "export const A = () => <dl><dt>a</dt><dd>b</dd></dl>", errors: [{ messageId: "raw" }, { messageId: "raw" }, { messageId: "raw" }] },
      { filename: FEATURE, code: "export const A = () => <table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>", errors: Array(7).fill({ messageId: "raw" }) },
      // a raw tag nested in a wrapper the rule allows is still found
      { filename: FEATURE, code: "export const A = () => <div><p>x</p></div>", errors: [{ messageId: "raw" }] },
      // every app slot that composes the grammar, in either app
      { filename: BLOCK, code: raw("p"), errors: [{ messageId: "raw" }] },
      { filename: at("apps/web/src/components/leaves/Chip/component.tsx"), code: raw("span"), errors: [{ messageId: "raw" }] },
      { filename: at("apps/admin/src/features/layouts/shell/component.tsx"), code: raw("nav"), errors: [{ messageId: "raw" }] },
      { filename: at("apps/web/src/app/[locale]/page.tsx"), code: raw("section"), errors: [{ messageId: "raw" }] },
      { filename: at("apps/web/src/hooks/lesson/useLesson.tsx"), code: raw("p"), errors: [{ messageId: "raw" }] },
      // a package that is not the ui package composes the grammar too
      { filename: at("packages/other/src/Widget.tsx"), code: raw("p"), errors: [{ messageId: "raw" }] },
      { filename: at("packages/nivo-i18n/src/Provider.tsx"), code: raw("span"), errors: [{ messageId: "raw" }] },
    ],
  })
})

test("live time and countdowns use the Grammar clock while non-clock timers remain available", () => {
  const FEATURE = at("apps/web/src/features/pages/home/component.tsx")
  const LEAF = at("apps/web/src/components/leaves/UpdatedAt/index.tsx")
  const HOOK = at("apps/web/src/hooks/time/useNow.ts")
  const MODULE = at("apps/web/src/modules/time/index.ts")
  const clock = [{ messageId: "clock" }]
  slotTester().run("no-app-relative-clock", noAppRelativeClock, {
    valid: [
      { filename: FEATURE, code: 'import { RelativeTime } from "@starci/grammar/common"; export const A = () => <RelativeTime dateTime="2026-10-25T13:00:00Z" locale="en" mode="countdown" format="digital" template="Offer ends in {time}" expiredLabel="Offer expired" fallback="Loading" />' },
      { filename: FEATURE, code: 'import { DropdownMenu, RelativeTime, WorkspaceShell } from "@starci/grammar/core"; const entries = [{ id: "workspace", label: "Workspace", mark: <Logo /> }]; export const A = () => <WorkspaceShell navigation={<Nav />} navigationLabel="Navigation" primaryLabel="Workspace" navigationDrawer={{ defaultOpen: false, title: "Navigation", openLabel: "Open navigation", closeLabel: "Close navigation", source: MenuGlyph, content: <Nav /> }} primary={<><DropdownMenu entries={entries} trigger={<Trigger />} /><RelativeTime dateTime="2026-10-25T12:00:00Z" locale="en" mode="relative" /><RelativeTime dateTime="2026-10-25T13:00:00Z" locale="en" mode="countdown" fallback="Pending" size="sm" tone="muted" /></>} />' },
      { filename: LEAF, code: 'import { RelativeTime } from "@starci/grammar/core"; export const UpdatedAt = () => <RelativeTime dateTime="2026-10-25T12:00:00Z" locale="en" />' },
      { filename: LEAF, code: 'import * as Grammar from "@starci/grammar/core"; export const UpdatedAt = () => <Grammar.RelativeTime dateTime="2026-10-25T12:00:00Z" locale="en" mode="countdown" />' },
      { filename: HOOK, code: "const timer = setInterval(() => step(), 16); const stop = () => clearInterval(timer)" },
      { filename: FEATURE, code: "const later = setTimeout(() => show(Date.now()), 1000)" },
      { filename: MODULE, code: "const parse = () => new Date('2026-10-25T12:00:00Z'); setInterval(() => show(parse()), 1000)" },
      { filename: HOOK, code: "const setInterval = (callback: () => void) => callback(); setInterval(() => show(Date.now()))" },
      { filename: HOOK, code: "const window = { setInterval: (callback: () => void) => callback() }; window.setInterval(() => show(Date.now()))" },
      { filename: HOOK, code: "const Date = { now: () => 5 }; setInterval(() => show(Date.now()), 1000)" },
      { filename: at("scripts/render.tsx"), code: "setInterval(() => show(Date.now()), 1000)" },
    ],
    invalid: [
      { filename: LEAF, code: "setInterval(() => show(Date.now()), 1000)", errors: clock },
      { filename: HOOK, code: "const tick = () => show(Date.now()); window.setInterval(tick, 1000)", errors: clock },
      { filename: MODULE, code: "globalThis.setInterval(() => show(new Date()), 1000)", errors: clock },
      { filename: HOOK, code: "self.setInterval(() => show(Date()), 1000)", errors: clock },
      { filename: HOOK, code: "setInterval(() => show(performance.now()), 1000)", errors: clock },
      { filename: HOOK, code: "const repeat = window.setInterval; const now = Date.now; repeat(() => show(now()), 1000)", errors: clock },
      { filename: HOOK, code: "const { setInterval: repeat } = globalThis; const { now } = Date; repeat(() => show(now()), 1000)", errors: clock },
      { filename: HOOK, code: "const { now: instant } = window.performance; const repeat = self['setInterval']; repeat(() => show(instant()), 1000)", errors: clock },
      { filename: HOOK, code: "const Clock = Date; setInterval(() => show(new Clock()), 1000)", errors: clock },
      { filename: HOOK, code: "const instant = () => Date.now(); const tick = () => show(instant()); setInterval(tick, 1000)", errors: clock },
      { filename: HOOK, code: "function tick() { show(Date.now()); setTimeout(tick, 1000) }", errors: clock },
      { filename: HOOK, code: "const tick = () => { setTimeout(() => { show(Date.now()); tick() }, 1000) }", errors: clock },
      { filename: HOOK, code: "function tick() { show(Date.now()); window.setTimeout(() => tick(), 1000) }", errors: clock },
      { filename: at("packages/other/src/time.ts"), code: "setInterval(() => show(Date.now()), 1000)", errors: clock },
      { filename: at("packages/nivo-ui/src/leaves/RelativeTime/index.tsx"), code: "const timer = setInterval(() => show(Date.now()), 1000)", errors: clock },
    ],
  })
})
