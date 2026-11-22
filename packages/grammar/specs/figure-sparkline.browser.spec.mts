/**
 * The ext `Sparkline` inside `FigureCells` (a figure's `trendChart`) in a real browser: the trend line takes the full width of its cell, with no
 * fixed box around it. The cell aligns its rows to the start, so before 0.55.1 the line's row shrank to its content and the chart measured 0px.
 * Bundled with the package's own Vite and its stylesheet, driven in Chromium through Playwright (GRAPH_CHROMIUM names a Chromium to launch).
 * Skipped, loudly, when no Chromium is installed.
 *
 *   node --import ./specs/support/register.mts --test specs/figure-sparkline.browser.spec.mts
 */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { chromium, type Browser } from "playwright"
import { build } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

const bundle = async (): Promise<{ readonly code: string; readonly css: string }> => {
    const dir = mkdtempSync(join(root, "specs", ".bundle-"))
    try {
        const entry = join(dir, "entry.tsx")
        writeFileSync(entry, `
import "../../src/core/styles.css"
import "../../src/core/theme.css"
import { createRoot } from "react-dom/client"
import { FigureCells } from "../../src/core/frame/Section/FigureCells.tsx"
import { Sparkline } from "../../src/core/ext/recharts/index.ts"
const rows = [3, 5, 4, 8, 6, 9, 12].map((value, index) => ({ index, value }))
const line = <Sparkline data={rows} xKey="index" yKey="value" ariaLabel="Đơn theo tuần" emptyLabel="Chưa có số liệu" />
const items = [
    { id: "orders", term: "Đơn hàng", value: "1.240", meta: "tuần này", trendChart: line },
    { id: "leads", term: "Khách mới", value: "86", meta: "tuần này", trendChart: line },
    { id: "replies", term: "Trả lời", value: "92%", meta: "tuần này", trendChart: line },
]
createRoot(document.getElementById("app")!).render(<FigureCells items={items} isLoading={false} />)
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
        assert.ok(css.includes("starci-core-description-trend-line"), "the Grammar stylesheet is bundled")
        return { code: chunk.code, css }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

let browser: Browser | undefined
try {
    browser = await chromium.launch(process.env.GRAPH_CHROMIUM === undefined ? {} : { executablePath: process.env.GRAPH_CHROMIUM })
} catch {
    browser = undefined
}

test("a Sparkline in FigureCells takes its cell's full width", { skip: browser === undefined ? "no Chromium installed (npx playwright install chromium)" : false }, async () => {
    assert.ok(browser !== undefined)
    const { code, css } = await bundle()
    for (const width of [960, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } })
        await page.setContent(`<!doctype html><html lang="vi"><body style="margin:0"><div class="grammar-common-root" data-grammar-family="core"><div id="app"></div></div></body></html>`)
        await page.addStyleTag({ content: css })
        await page.addScriptTag({ type: "module", content: code })
        await page.waitForSelector('[data-component="Sparkline"] svg')
        const cells = await page.evaluate(() =>
            [...document.querySelectorAll(".starci-core-description-pair")].map((cell) => {
                const chart = cell.querySelector('[data-component="Sparkline"]')
                const svg = chart?.querySelector("svg")
                const row = cell.querySelector(".starci-core-description-trend-line")
                const inset = Number.parseFloat(getComputedStyle(cell).paddingLeft) + Number.parseFloat(getComputedStyle(cell).paddingRight)
                return { cell: cell.getBoundingClientRect().width - inset, row: row?.getBoundingClientRect().width ?? 0, chart: chart?.getBoundingClientRect().width ?? 0, svg: svg?.getBoundingClientRect().width ?? 0 }
            }),
        )
        assert.equal(cells.length, 3)
        for (const cell of cells) {
            assert.ok(cell.svg > 0, `the line draws at ${String(width)}: ${JSON.stringify(cell)}`)
            assert.ok(Math.abs(cell.row - cell.cell) < 1, `the line's row is the cell's full width at ${String(width)}: ${JSON.stringify(cell)}`)
            assert.ok(Math.abs(cell.chart - cell.row) < 1 && Math.abs(cell.svg - cell.chart) < 1, `the chart fills its row at ${String(width)}: ${JSON.stringify(cell)}`)
        }
        await page.close()
    }
})

test.after(async () => {
    await browser?.close()
})
