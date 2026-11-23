/**
 * Before/after fixtures of v0550 (Grammar 0.55.0, the site group).
 *
 *   node --test codemods/v0550/v0550.spec.mts
 */
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import ts from "typescript"
import { READING_TEXT_ROLES, SITE_TEXT_ROLES, TEXT_ROLES, typeRoleClassName } from "../../src/common/typeRoles.ts"
import { codemodsBetween } from "../index.mts"
import { MARK, ROLES, SITE_ROLES, isSitePath, mapSiteClassList, pxOf, roleClass, runV0550, transformSiteSource, v0550Markdown } from "./index.mts"

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url))

/** Every fixture file, relative to its side. */
const fixtureFiles = (side: "before" | "after"): string[] => {
    const out: string[] = []
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name)
            if (statSync(p).isDirectory()) walk(p)
            else out.push(relative(join(FIXTURES, side), p).replaceAll("\\", "/"))
        }
    }
    walk(join(FIXTURES, side))
    return out.sort()
}
const read = (side: "before" | "after", name: string): string => readFileSync(join(FIXTURES, side, name), "utf8")

/** An app checkout holding the before fixtures in apps/web/src. */
const app = (): string => {
    const root = mkdtempSync(join(tmpdir(), "v0550-"))
    mkdirSync(join(root, "apps", "web", "src"), { recursive: true })
    cpSync(join(FIXTURES, "before"), join(root, "apps", "web", "src"), { recursive: true })
    return root
}

test("the roles and their classes are Grammar 0.55.0's: the ten and the site group (the reading group of 0.55.1 maps no old size)", () => {
    assert.deepEqual([...ROLES], TEXT_ROLES.filter((role) => !READING_TEXT_ROLES.includes(role)))
    assert.deepEqual([...SITE_ROLES], [...SITE_TEXT_ROLES])
    for (const role of ROLES) assert.equal(roleClass(role), typeRoleClassName(role))
})

test("the site is the (site) route group, a Site or Marketing owner and modules/site; the console is not", () => {
    for (const file of ["apps/web/src/app/[locale]/(site)/home/page.tsx", "fe/apps/web/src/components/composites/SiteHead/classNames.ts", "apps/web/src/features/pages/SiteBrandPage/component.tsx", "apps/web/src/modules/site-home/copy.ts", "apps/web/src/components/blocks/MarketingHero/index.tsx"]) assert.ok(isSitePath(file), file)
    for (const file of ["apps/web/src/components/blocks/Overview/component.tsx", "apps/web/src/components/composites/Situation/index.tsx", "apps/web/src/features/pages/SettingsPage/component.tsx", "apps/web/src/app/[locale]/(pages)/workspaces/page.tsx"]) assert.ok(!isSitePath(file), file)
})

test("the measured clusters map onto the site group", () => {
    const role = (list: string, tag: string | null = null): string | undefined => {
        const res = mapSiteClassList(list, tag)
        return res !== null && "role" in res ? res.role : undefined
    }
    assert.equal(pxOf("[2.25rem]"), 36)
    assert.equal(pxOf("lg"), 18)
    // display.hero: SiteHead DISPLAY, SiteHomeHero TITLE, SiteHomeFinal TITLE.
    assert.equal(role("text-[2.25rem] leading-[1.08] font-medium tracking-[-0.035em] md:text-[3.25rem] lg:text-[4rem] lg:leading-[1.04]"), "display.hero")
    assert.equal(role("text-[2.25rem] lg:text-[4rem] leading-[1.12] font-medium", "h1"), "display.hero")
    assert.equal(role("text-[2.375rem] lg:text-[3.5rem] leading-[1.08] font-medium", "h2"), "display.hero")
    // display.section: SiteHead TITLE and the 24-to-30 headings.
    assert.equal(role("text-[2rem] leading-[1.1] font-medium lg:text-5xl"), "display.section")
    assert.equal(role("text-2xl md:text-3xl font-medium tracking-tight", "h2"), "display.section")
    assert.equal(role("text-[1.375rem] lg:text-[1.75rem] leading-tight font-medium", "h3"), "display.section")
    // display.figure: the big numbers.
    assert.equal(role("text-4xl md:text-6xl font-medium tracking-tight", "span"), "display.figure")
    assert.equal(role("text-[2.75rem] lg:text-[3.5rem] leading-none font-medium", "p"), "display.figure")
    // lead: 18 to 20 and 16 to 18 at 400.
    assert.equal(role("text-lg leading-relaxed text-muted lg:text-xl", "p"), "lead")
    assert.equal(role("text-base md:text-lg", "p"), "lead")
    // title.card: the 18-20 card titles, and an h3 at 20 stepping to 24.
    assert.equal(role("text-lg font-medium", "h3"), "title.card")
    assert.equal(role("text-base md:text-lg font-medium", "h3"), "title.card")
    assert.equal(role("text-xl md:text-2xl font-medium leading-8", "h3"), "title.card")
    // The existing roles by pixel size.
    assert.equal(role("text-base font-medium", "span"), "title.section")
    assert.equal(role("text-[0.9375rem]", "p"), "body")
    assert.equal(role("text-[0.8125rem] font-medium text-muted", "span"), "label.field")
    assert.equal(role("text-[0.8125rem] text-muted", "p"), "caption")
    assert.equal(role("text-xs font-medium", "span"), "badge")
    assert.equal(role("text-sm font-medium text-muted", "p"), "label.item")
    // What stays for a person.
    for (const list of ["text-2xl font-medium leading-8", "text-xl leading-8", "text-xs", "[&>small]:text-xs", "text-lg md:text-sm"]) assert.ok("ambiguous" in (mapSiteClassList(list, "p") ?? {}), list)
})

test("a role class keeps the element's other utilities and drops the size, leading, tracking and weight at every breakpoint", () => {
    assert.deepEqual(mapSiteClassList("mt-4 max-w-3xl text-[2rem] leading-[1.1] font-medium tracking-[-0.03em] text-balance lg:text-5xl lg:leading-[1.05]", "h2"), { role: "display.section", out: "starci-type-display-section mt-4 max-w-3xl text-balance" })
    assert.deepEqual(mapSiteClassList("mt-5 text-lg leading-relaxed text-pretty text-muted lg:text-xl", "p"), { role: "lead", out: "starci-type-lead mt-5 text-pretty text-muted" })
    assert.deepEqual(mapSiteClassList("text-[0.8125rem] font-medium text-muted", "span"), { role: "label.field", out: "starci-type-label-field" })
})

test("a product drawing keeps its type raw, but for a stepped display or lead class", () => {
    assert.equal(mapSiteClassList("text-[0.8125rem] text-muted", null, true), null)
    assert.equal(mapSiteClassList("text-lg font-medium", "h3", true), null)
    assert.deepEqual(mapSiteClassList("text-[2.375rem] font-medium lg:text-[3.5rem]", "h2", true), { role: "display.hero", out: "starci-type-display-hero" })
})

test("a v0540 marker goes with the case v0550 converts, and an ambiguity is marked once", () => {
    const source = "/** A title. */\n// TODO(type-role): 16-18px outside a heading\nexport const TITLE = \"text-lg font-medium\"\n// TODO(type-role): display size above 2xl\nexport const BIG = \"text-2xl font-medium\"\n"
    const { text, findings } = transformSiteSource(ts, "apps/web/src/components/composites/SiteX/classNames.ts", source)
    assert.equal(text, "/** A title. */\nexport const TITLE = \"starci-type-title-card\"\n// TODO(type-role): display size above 2xl\nexport const BIG = \"text-2xl font-medium\"\n")
    assert.deepEqual(findings.map((f) => f.role ?? f.reason), ["title.card", "24px with no step: display.section or title.card"])
    const jsx = "export const A = () => (\n    <Text // TODO(type-role): muted or dynamic-tone strong 14px: label.field or label.item\n        size=\"sm\" isStrong tone=\"muted\">x</Text>\n)\n"
    assert.equal(transformSiteSource(ts, "SiteA/index.tsx", jsx).text, "export const A = () => (\n    <Text role=\"label.item\" tone=\"muted\">x</Text>\n)\n")
})

test("dry mode writes nothing; --execute writes the after fixtures; the console is untouched", () => {
    const root = app()
    try {
        const dry = runV0550({ root, write: false, ts })
        assert.equal(dry.mode, "dry")
        for (const name of fixtureFiles("before")) assert.equal(readFileSync(join(root, "apps/web/src", name), "utf8"), read("before", name))
        assert.deepEqual(dry.drawings, ["apps/web/src/components/composites/SiteReel"])
        assert.ok(dry.files.every((f) => f.file.includes("/Site")))
        assert.equal(dry.findings.length, 3)
        assert.ok(dry.findings.every((f) => f.reason !== undefined))
        assert.match(v0550Markdown(dry), /would change/)
        const done = runV0550({ root, write: true, ts })
        assert.equal(done.mode, "execute")
        assert.deepEqual(fixtureFiles("after"), fixtureFiles("before"))
        for (const name of fixtureFiles("after")) assert.equal(readFileSync(join(root, "apps/web/src", name), "utf8"), read("after", name), name)
        assert.equal(readFileSync(join(root, "apps/web/src", "components/blocks/Overview/component.tsx"), "utf8").split(MARK).length, 1)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("an upgrade from 0.54.0 to 0.55.0 runs v0550, and a prerelease of 0.55.0 carries it", () => {
    assert.deepEqual(codemodsBetween("0.54.0", "0.55.0").map((c) => c.id), ["v0550"])
    assert.deepEqual(codemodsBetween("0.53.0", "0.55.0-display.1").map((c) => c.id), ["v0540", "v0550"])
    assert.deepEqual(codemodsBetween("0.55.1", "0.55.3").map((c) => c.id), [])
})
