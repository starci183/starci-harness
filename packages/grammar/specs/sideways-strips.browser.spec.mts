/**
 * The sideways strips in a real browser, at 390 and 1440 (StarCi Next audit rounds 5 and 6).
 *
 * 1. The fading end of a strip that scrolls only sideways (Breadcrumbs, DataTable's scroller, the fenced code `pre`, the markdown table frame, the top
 *    bar's navigation). Their fade is a scroll-driven animation; `scroll(self)` follows the BLOCK axis, which these strips never scroll, so its timeline
 *    stayed inactive and `--grammar-fade-end` stayed 0px: a long last crumb was cut mid-word with no fade. They follow `scroll(self inline)`.
 * 2. The selected page tab in a strip wider than its box: revealed fully, clear of the next control AND of the strip's own fading edge (the vendor
 *    ScrollShadow masks its last `size` px on a side where more tabs wait), on the first render and when the selection changes.
 *
 * Bundled with the package's own Vite, its stylesheet and HeroUI's, and driven in Chromium through Playwright (GRAPH_CHROMIUM names a Chromium to
 * launch). Skipped, loudly, when no Chromium is installed. SHOTS_DIR, when set, receives a screenshot of each width.
 *
 *   node --import ./specs/support/register.mts --test specs/sideways-strips.browser.spec.mts
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { chromium, type Browser, type Page } from "playwright"
import { build } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

const bundle = async (): Promise<{ readonly code: string; readonly css: string }> => {
    const dir = mkdtempSync(join(root, "specs", ".bundle-"))
    try {
        const entry = join(dir, "entry.tsx")
        writeFileSync(entry, `
import "../../src/core/styles.css"
import "../../src/core/theme.css"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { CoreGrammarRoot, Page, Text } from "../../src/core/index.ts"
const tabs = [
    { id: "intro", label: "Giới thiệu" },
    { id: "setup", label: "Cài đặt" },
    { id: "happy", label: "Đơn bình thường" },
    { id: "unhappy", label: "Khi có sự cố" },
    { id: "pattern", label: "Tổng kết" },
    { id: "submit", label: "Nộp bài" },
]
const title = "Đặt hàng qua bốn dịch vụ mà khách không mất tiền"
const Demo = () => {
    const [tab, setTab] = useState(new URLSearchParams(window.location.search).get("page") ?? "unhappy")
    ;(window as unknown as { selectTab: (key: string) => void }).selectTab = setTab
    return (
        <Page header={{
            breadcrumbs: { label: "Vị trí", items: [{ id: "essentials", label: "Essentials", href: "#essentials" }, { id: "course", label: "Shop giày của bạn", href: "#course" }, { id: "lesson", label: title }] },
            title,
            titleScale: "standard",
            meta: "4 dịch vụ · 2 ca bình thường · 7 ca sự cố · 0 trên 9 ca đã qua",
            tabs: { label: "Các trang của bài", kind: "views", selectedKey: tab, items: tabs, onSelect: setTab },
        }}>
            <Text>{tabs.find((item) => item.id === tab)?.label}</Text>
        </Page>
    )
}
createRoot(document.getElementById("app")!).render(<CoreGrammarRoot><Demo /></CoreGrammarRoot>)
`)
        const result = await build({
            root: dir, configFile: false, logLevel: "silent", mode: "production",
            define: { "process.env.NODE_ENV": '"production"' },
            build: { write: false, minify: false, cssCodeSplit: false, lib: { entry, formats: ["es"], fileName: "bundle" } },
        })
        const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => ("output" in item ? item.output : []))
        const chunk = outputs.find((output) => output.type === "chunk")
        assert.ok(chunk !== undefined && chunk.type === "chunk", "one bundle")
        const css = outputs.flatMap((output) => (output.type === "asset" && output.fileName.endsWith(".css") ? [String(output.source)] : [])).join("\n")
        assert.ok(css.includes("starci-core-breadcrumbs"), "the Grammar stylesheet is bundled")
        return { code: chunk.code, css }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const heroCss = readFileSync(join(root, "node_modules", "@heroui", "styles", "dist", "heroui.min.css"), "utf8")

let browser: Browser | undefined
try {
    browser = await chromium.launch(process.env.GRAPH_CHROMIUM === undefined ? {} : { executablePath: process.env.GRAPH_CHROMIUM })
} catch {
    browser = undefined
}
const skip = browser === undefined ? "no Chromium installed (npx playwright install chromium)" : false
const built = skip === false ? bundle() : undefined

const open = async (width: number, selected: string): Promise<Page> => {
    assert.ok(browser !== undefined && built !== undefined)
    const { code, css } = await built
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    await page.route("http://strips.test/**", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body style="margin:0"><div id="app"></div></body></html>` }))
    await page.goto(`http://strips.test/lesson?page=${selected}`)
    await page.addStyleTag({ content: heroCss })
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ type: "module", content: code })
    await page.waitForSelector("[data-grammar-tabs-client='ready'] [role='tab'][aria-selected='true']")
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    return page
}

/** The selected tab against its scroller, the next control and the scroller's fading edges, in viewport px. */
const tabGeometry = (page: Page) => page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>("[data-grammar-tabs-client='ready']")
    const scroller = frame?.querySelector<HTMLElement>(".tabs__list-container__scroller")
    const tab = frame?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")
    const next = frame?.querySelector<HTMLElement>(".starci-horizontal-scroll-next")
    const previous = frame?.querySelector<HTMLElement>(".starci-horizontal-scroll-prev")
    if (scroller == null || tab == null) return undefined
    const box = scroller.getBoundingClientRect()
    const at = tab.getBoundingClientRect()
    const shown = (control: HTMLElement | null | undefined) => control != null && getComputedStyle(control).display !== "none" ? control.getBoundingClientRect() : undefined
    const fade = Number.parseFloat(getComputedStyle(scroller).getPropertyValue("--scroll-shadow-size")) || 0
    const more = { before: scroller.scrollLeft > 0.5, after: scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 0.5 }
    return {
        tab: { left: at.left, right: at.right, label: tab.textContent },
        scroller: { left: box.left, right: box.right, scrollLeft: scroller.scrollLeft, overflows: scroller.scrollWidth > scroller.clientWidth + 0.5 },
        fade, more,
        next: shown(next)?.left, previous: shown(previous)?.right,
    }
})

const assertRevealed = (geometry: Awaited<ReturnType<typeof tabGeometry>>, where: string) => {
    assert.ok(geometry !== undefined, `the strip drew at ${where}`)
    const { tab, scroller, fade, more, next, previous } = geometry
    const detail = `${where}: ${JSON.stringify(geometry)}`
    assert.ok(tab.left >= scroller.left - 0.5 && tab.right <= scroller.right + 0.5, `the selected tab lies inside its scroller at ${detail}`)
    if (next !== undefined) assert.ok(tab.right <= next + 0.5, `the selected tab ends before the next control at ${detail}`)
    if (previous !== undefined) assert.ok(tab.left >= previous - 0.5, `the selected tab starts after the previous control at ${detail}`)
    if (more.after) assert.ok(tab.right <= scroller.right - fade + 0.5, `the selected tab ends before the end fade at ${detail}`)
    if (more.before) assert.ok(tab.left >= scroller.left + fade - 0.5, `the selected tab starts after the start fade at ${detail}`)
}

test("a strip that scrolls only sideways fades its end where more waits", { skip }, async () => {
    for (const width of [390, 1440]) {
        const page = await open(width, "unhappy")
        const strips = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".starci-core-breadcrumbs")].map((strip) => ({
            overflows: strip.scrollWidth > strip.clientWidth + 0.5,
            timeline: getComputedStyle(strip).getPropertyValue("animation-timeline"),
            end: getComputedStyle(strip).getPropertyValue("--grammar-fade-end").trim(),
            start: getComputedStyle(strip).getPropertyValue("--grammar-fade-start").trim(),
        })))
        assert.ok(strips.length > 0, "the page draws its breadcrumbs")
        for (const strip of strips) {
            assert.match(strip.timeline, /inline/, `the breadcrumbs follow their inline scroll at ${String(width)}: ${JSON.stringify(strip)}`)
            // At rest the start edge is reached (no start fade); the end fades only when the trail is wider than its box (390), never when it fits (1440).
            assert.equal(strip.start, "0px", `no start fade at rest at ${String(width)}: ${JSON.stringify(strip)}`)
            assert.equal(strip.end, strip.overflows ? "32px" : "0px", `the end fade matches the overflow at ${String(width)}: ${JSON.stringify(strip)}`)
        }
        if (width === 390) assert.ok(strips.some((strip) => strip.overflows), "the long lesson title overflows its trail at 390")
        // Every other sideways strip of the fade rule, drawn wider than its box under the family root: each fades its end.
        const others = await page.evaluate(async () => {
            const host = document.querySelector(".grammar-common-root") ?? document.body
            const make = (tag: string, className: string, attributes: Record<string, string> = {}) => {
                const strip = document.createElement(tag)
                strip.className = className
                Object.entries(attributes).forEach(([name, value]) => strip.setAttribute(name, value))
                strip.style.cssText = "display:block;width:200px;overflow-x:auto;overflow-y:hidden;white-space:nowrap"
                strip.textContent = "Một dòng dài hơn hẳn khung của nó để khung phải cuộn ngang tới cuối dòng"
                return strip
            }
            const code = document.createElement("div")
            code.className = "starci-core-fenced-code-block"
            const pre = make("pre", "")
            code.append(pre)
            // [name, the element appended to the root, the scroller measured]: the fenced code block's scroller is its `pre`.
            const own = (name: string, strip: HTMLElement): { readonly name: string; readonly outer: HTMLElement; readonly strip: HTMLElement } => ({ name, outer: strip, strip })
            const strips = [
                own("data-table-scroll", make("div", "starci-core-data-table-scroll")),
                { name: "fenced code pre", outer: code, strip: pre },
                own("markdown-table-frame", make("div", "starci-core-markdown-table-frame")),
                own("top-bar-navigation", make("nav", "starci-core-top-bar-navigation")),
                own("nav-landmark scrolling", make("nav", "starci-core-nav-landmark", { "data-grammar-nav-layout": "scrolling" })),
            ]
            strips.forEach(({ outer }) => host.append(outer))
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            return strips.map(({ name, strip }) => ({ name, overflows: strip.scrollWidth > strip.clientWidth + 0.5, end: getComputedStyle(strip).getPropertyValue("--grammar-fade-end").trim() }))
        })
        for (const strip of others) {
            // Under 40rem a markdown table stacks its rows and never scrolls sideways (its frame drops the fade there by design).
            if (strip.name === "markdown-table-frame" && width < 640) continue
            assert.ok(strip.overflows, `the ${strip.name} strip overflows: ${JSON.stringify(strip)}`)
            assert.equal(strip.end, "32px", `the ${strip.name} strip fades its end at ${String(width)}: ${JSON.stringify(strip)}`)
        }
        await page.close()
    }
})

test("the selected page tab is revealed clear of the next control and of the fading edge", { skip }, async () => {
    const shots = process.env.SHOTS_DIR
    if (shots !== undefined) mkdirSync(shots, { recursive: true })
    for (const width of [390, 1440]) {
        const page = await open(width, "unhappy")
        if (shots !== undefined) await page.screenshot({ path: join(shots, `strips-${String(width)}.png`), clip: { x: 0, y: 0, width, height: 260 } })
        assertRevealed(await tabGeometry(page), `${String(width)}, first render`)
        for (const key of ["intro", "submit", "pattern", "happy"]) {
            await page.evaluate((next) => { (window as unknown as { selectTab: (key: string) => void }).selectTab(next) }, key)
            await page.waitForTimeout(250)
            assertRevealed(await tabGeometry(page), `${String(width)}, after selecting ${key}`)
        }
        await page.close()
    }
})

test.after(async () => {
    await browser?.close()
})
