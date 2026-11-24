/**
 * The charts extension `@starci/grammar/core/ext/recharts` (owner rule: apps use it for EVERY chart and sparkline): the states render, a tone is a token,
 * the tooltip is a shadowless surface, core never imports the extension or recharts, and no source holds a hex colour.
 *
 *   node --import ./specs/support/register.mts --test specs/recharts-ext.spec.mts
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AreaChart, BarChart, CHART_TONES, CHART_TONE_TOKEN, DONUT_RING_WIDTH, DonutChart, LineChart, Sparkline, barFills, chartToneColor, chartToneSoftColor, donutSlices, type DonutSegment } from "../src/core/ext/recharts/index.ts"
import { AreaFill } from "../src/core/ext/recharts/AreaChart.tsx"
import { ChartTooltip } from "../src/core/ext/recharts/shared.tsx"

const src = fileURLToPath(new URL("../src/", import.meta.url))
const ext = join(src, "core", "ext", "recharts")
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : []
    })
const rel = (path: string): string => relative(src, path).replaceAll("\\", "/")

type Week = { readonly week: string; readonly orders: number }
const weekly: readonly Week[] = [
    { week: "2026-11-02", orders: 66 },
    { week: "2026-11-09", orders: 88 },
    { week: "2026-11-16", orders: 94 },
]
const words = { xKey: "week", yKey: "orders", ariaLabel: "Orders per week", emptyLabel: "No orders yet" } as const

test("with data each chart is one named image in a box of its own height", () => {
    const bar = renderToStaticMarkup(createElement(BarChart<Week>, { ...words, data: weekly, height: 200 }))
    assert.match(bar, /data-component="BarChart"/)
    assert.match(bar, /data-state="ready"/)
    assert.match(bar, /role="img"/)
    assert.match(bar, /aria-label="Orders per week"/)
    assert.match(bar, /block-size:200px/)
    const line = renderToStaticMarkup(createElement(LineChart<Week>, { ...words, data: weekly }))
    assert.match(line, /data-component="LineChart"/)
    assert.match(line, /block-size:240px/)
    const spark = renderToStaticMarkup(createElement(Sparkline<Week>, { ...words, data: weekly }))
    assert.match(spark, /data-component="Sparkline"/)
    assert.match(spark, /block-size:32px/)
    const area = renderToStaticMarkup(createElement(AreaChart<Week>, { ...words, data: weekly }))
    assert.match(area, /data-component="AreaChart"/)
    assert.match(area, /data-state="ready"/)
    assert.equal(area.match(/role="img"/g)?.length, 1)
    assert.match(area, /block-size:240px/)
})

test("highlightLast: the latest bar in the full tone, the others in its soft pair, and the name ends with the latest value", () => {
    assert.deepEqual(barFills(3, "accent", false), ["var(--accent)", "var(--accent)", "var(--accent)"])
    assert.deepEqual(barFills(3, "success", true), [chartToneSoftColor("success"), chartToneSoftColor("success"), "var(--success)"])
    assert.equal(chartToneSoftColor("accent"), "color-mix(in oklab, var(--accent) 32%, var(--surface))")
    assert.deepEqual(barFills(0, "accent", true), [])
    const named = renderToStaticMarkup(createElement(BarChart<Week>, { ...words, data: weekly, highlightLast: true, formatY: (value: number) => `${String(value)} orders` }))
    assert.match(named, /aria-label="Orders per week, 2026-11-16: 94 orders"/)
    assert.match(renderToStaticMarkup(createElement(BarChart<Week>, { ...words, data: weekly })), /aria-label="Orders per week"/)
    // Empty: the chart's own empty line, no latest value to name.
    assert.match(renderToStaticMarkup(createElement(BarChart<Week>, { ...words, data: [], highlightLast: true })), /No orders yet/)
})

test("loading is a Grammar Skeleton of the box, with no name announced and the box busy", () => {
    for (const Chart of [BarChart<Week>, LineChart<Week>, Sparkline<Week>, AreaChart<Week>]) {
        const html = renderToStaticMarkup(createElement(Chart, { ...words, data: weekly, isLoading: true }))
        assert.match(html, /data-state="loading"/)
        assert.match(html, /aria-busy="true"/)
        assert.match(html, /data-component="Skeleton"/)
        assert.doesNotMatch(html, /role="img"/)
    }
})

test("empty shows the label from props in the same box, and no drawing", () => {
    for (const Chart of [BarChart<Week>, LineChart<Week>, AreaChart<Week>]) {
        const html = renderToStaticMarkup(createElement(Chart, { ...words, data: [] }))
        assert.match(html, /data-state="empty"/)
        assert.match(html, /No orders yet/)
        assert.doesNotMatch(html, /role="img"/)
    }
})

test("a Sparkline with no data, or only zeros, draws nothing", () => {
    assert.equal(renderToStaticMarkup(createElement(Sparkline<Week>, { ...words, data: [] })), "")
    assert.equal(renderToStaticMarkup(createElement(Sparkline<Week>, { ...words, data: weekly.map((row) => ({ ...row, orders: 0 })) })), "")
    assert.match(renderToStaticMarkup(createElement(Sparkline<Week>, { ...words, data: [], isLoading: true })), /data-state="loading"/)
})

test("a tone is a Grammar token, never a literal colour", () => {
    assert.deepEqual([...CHART_TONES], ["default", "accent", "info", "success", "warning", "danger"])
    for (const tone of CHART_TONES) assert.match(CHART_TONE_TOKEN[tone], /^var\(--[a-z-]+\)$/)
    assert.equal(chartToneColor("accent"), "var(--accent)")
    assert.equal(chartToneColor("info"), "var(--info)")
    assert.equal(chartToneColor("default"), "var(--muted)")
})

test("the tooltip is a Grammar surface with no shadow, its numbers and dates formatted by the app", () => {
    const html = renderToStaticMarkup(
        createElement(ChartTooltip, { active: true, label: "2026-11-09", payload: [{ value: 88 }], formatX: (value) => `week ${value}`, formatY: (value) => `${value} orders`, seriesLabel: "Orders" }),
    )
    assert.match(html, /box-shadow:none/)
    assert.match(html, /background:var\(--surface\)/)
    assert.match(html, /week 2026-11-09/)
    assert.match(html, /Orders: <strong[^>]*>88 orders<\/strong>/)
    assert.equal(renderToStaticMarkup(createElement(ChartTooltip, { active: false, formatX: String, formatY: String, seriesLabel: "Orders" })), "")
})

test("core never imports the extension, and recharts is imported only inside it", () => {
    for (const file of walk(src)) {
        if (file.startsWith(ext) || /[\\/]stories[\\/]/.test(file)) continue
        const text = readFileSync(file, "utf8")
        assert.doesNotMatch(text, /from\s+["'][^"']*core\/ext\/recharts|from\s+["'][^"']*ext\/recharts/, `${rel(file)} imports the charts extension`)
        assert.doesNotMatch(text, /from\s+["']recharts(?:\/[^"']*)?["']|import\s*\(\s*["']recharts/, `${rel(file)} imports recharts`)
    }
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, Record<string, unknown>>
    assert.equal(manifest["peerDependencies"]?.["recharts"], "^3.8.1")
    assert.deepEqual(manifest["peerDependenciesMeta"]?.["recharts"], { optional: true })
    assert.equal(manifest["dependencies"]?.["recharts"], undefined)
    assert.ok(manifest["exports"]?.["./core/ext/recharts"], "the ./core/ext/recharts subpath is exported")
})

test("no source of the extension holds a hex colour or a colour function", () => {
    for (const file of walk(ext)) {
        const text = readFileSync(file, "utf8")
        assert.doesNotMatch(text, /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/, `${rel(file)} holds a hex colour`)
        assert.doesNotMatch(text, /(?:^|[^\w-])(?:rgba?|hsla?|oklch|oklab)\(/, `${rel(file)} holds a colour function`)
    }
})

type Day = { readonly day: string; readonly lessons: number; readonly quizzes: number }
const days: readonly Day[] = [
    { day: "2026-11-16", lessons: 3, quizzes: 1 },
    { day: "2026-11-17", lessons: 5, quizzes: 2 },
    { day: "2026-11-18", lessons: 4, quizzes: 4 },
]
const area = { data: days, xKey: "day", yKey: "lessons", ariaLabel: "Activity per day", emptyLabel: "No activity yet", seriesLabel: "Lessons" } as const

test("an area chart of several series is one named image, its soft fill a gradient of the series token, and a text legend", () => {
    const html = renderToStaticMarkup(createElement(AreaChart<Day>, { ...area, series: [{ key: "quizzes", label: "Quizzes" }], stacked: true }))
    assert.equal(html.match(/role="img"/g)?.length, 1)
    assert.match(html, /aria-label="Activity per day"/)
    assert.match(html, /data-component="ChartLegend"/)
    assert.match(html, /<li[^>]*>(?:(?!<\/li>).)*Lessons/)
    assert.match(html, /<li[^>]*>(?:(?!<\/li>).)*Quizzes/)
    assert.match(html, /background:var\(--success\)/, "an untoned second series takes the next categorical tone")
    const soft = renderToStaticMarkup(createElement("svg", null, createElement(AreaFill, { id: "fill", color: "var(--accent)", stacked: false })))
    assert.match(soft, /stop-color:var\(--accent\);stop-opacity:var\(--grammar-opacity-faded\)/)
    assert.match(soft, /offset="100%" style="stop-color:var\(--accent\);stop-opacity:0"/)
    const stack = renderToStaticMarkup(createElement("svg", null, createElement(AreaFill, { id: "fill", color: "var(--info)", stacked: true })))
    assert.match(stack, /stop-opacity:var\(--grammar-opacity-dimmed\)/, "stacked areas keep a dimmed floor")
    const single = renderToStaticMarkup(createElement(AreaChart<Day>, area))
    assert.doesNotMatch(single, /data-component="ChartLegend"/, "one series needs no legend")
    const loading = renderToStaticMarkup(createElement(AreaChart<Day>, { ...area, series: [{ key: "quizzes", label: "Quizzes" }], isLoading: true }))
    assert.match(loading, /data-state="loading"/)
    assert.doesNotMatch(loading, /Quizzes|role="img"/)
})

test("the tooltip names each series of a chart with several", () => {
    const html = renderToStaticMarkup(
        createElement(ChartTooltip, { active: true, label: "2026-11-17", payload: [{ value: 5 }, { value: 2 }], formatX: String, formatY: String, seriesLabel: "Lessons", seriesLabels: ["Lessons", "Quizzes"] }),
    )
    assert.match(html, /Lessons: <strong[^>]*>5<\/strong>/)
    assert.match(html, /Quizzes: <strong[^>]*>2<\/strong>/)
    assert.match(html, /box-shadow:none/)
})

const topics: readonly DonutSegment[] = [
    { label: "Algebra", value: 30 },
    { label: "Geometry", value: 20 },
    { label: "Calculus", value: 25 },
    { label: "Statistics", value: 10 },
    { label: "Logic", value: 5 },
    { label: "Sets", value: 6 },
    { label: "Proofs", value: 4 },
]
const donut = { ariaLabel: "Lessons by topic", emptyLabel: "No lessons yet" } as const

test("a donut is one named image, with its centre figure and a text legend of values and shares", () => {
    const html = renderToStaticMarkup(createElement(DonutChart, { ...donut, data: topics.slice(0, 3), centerFigure: "75", centerCaption: "lessons", formatValue: (value: number) => `${value} lessons` }))
    assert.match(html, /data-component="DonutChart"/)
    assert.match(html, /data-state="ready"/)
    assert.equal(html.match(/role="img"/g)?.length, 1)
    assert.match(html, /aria-label="Lessons by topic"/)
    assert.match(html, /data-role="figure"[^>]*>75</)
    assert.match(html, /data-role="caption"[^>]*>lessons</)
    assert.match(html, /Algebra(?:(?!<\/li>).)*30 lessons(?:(?!<\/li>).)*40%/)
    assert.match(html, /Calculus(?:(?!<\/li>).)*25 lessons(?:(?!<\/li>).)*33%/)
    assert.match(html, /Geometry(?:(?!<\/li>).)*20 lessons(?:(?!<\/li>).)*27%/)
    const imageEnd = html.indexOf('data-slot="center"')
    assert.ok(imageEnd > html.indexOf('role="img"') && html.indexOf("Algebra") > imageEnd, "the centre and the legend are text outside the image")
})

test("a donut's shares are whole percents that add up to 100", () => {
    const thirds = donutSlices([{ label: "A", value: 1 }, { label: "B", value: 1 }, { label: "C", value: 1 }])
    assert.deepEqual(thirds.map(({ percent }) => percent), [34, 33, 33])
    const odd = donutSlices([{ label: "A", value: 2 }, { label: "B", value: 3 }, { label: "C", value: 7 }])
    assert.equal(odd.reduce((sum, { percent }) => sum + percent, 0), 100)
    const share = renderToStaticMarkup(createElement(DonutChart, { ...donut, data: [{ label: "Done", value: 68 }, { label: "Left", value: 32 }], formatShare: (percent: number) => `${percent} phần trăm` }))
    assert.match(share, /68 phần trăm/)
    assert.match(share, /32 phần trăm/)
})

test("past six parts the smallest fold into Other, named by the app, in the muted tone and last", () => {
    const folded = donutSlices(topics)
    assert.deepEqual(folded.map(({ label }) => label), ["Algebra", "Geometry", "Calculus", "Statistics", "Sets", "Other"])
    assert.deepEqual(folded.map(({ value }) => value), [30, 20, 25, 10, 6, 9])
    assert.deepEqual(folded.map(({ tone }) => tone), ["accent", "success", "warning", "danger", "info", "default"])
    assert.equal(folded.at(-1)?.isOther, true)
    assert.deepEqual(donutSlices(topics, 3, "Khác").map(({ label }) => label), ["Algebra", "Calculus", "Khác"])
    assert.equal(donutSlices(topics, 99).length, 6, "the cap never passes six")
    assert.equal(donutSlices(topics.slice(0, 6)).some(({ isOther }) => isOther), false, "six parts draw as they are")
    const html = renderToStaticMarkup(createElement(DonutChart, { ...donut, data: topics, otherLabel: "Khác" }))
    assert.match(html, /Khác/)
    assert.doesNotMatch(html, /Logic|Proofs/)
    assert.equal(donutSlices([{ label: "A", value: 5, tone: "danger" }, { label: "B", value: 5 }])[0]?.tone, "danger", "a tone from the app wins")
})

test("a donut loads as all Skeleton, and with no positive part shows the empty label", () => {
    const loading = renderToStaticMarkup(createElement(DonutChart, { ...donut, data: topics, centerFigure: "100", isLoading: true }))
    assert.match(loading, /data-state="loading"/)
    assert.match(loading, /aria-busy="true"/)
    assert.match(loading, /data-component="Skeleton"/)
    assert.doesNotMatch(loading, /role="img"|Algebra|>100</)
    for (const data of [[], [{ label: "Zero", value: 0 }]]) {
        const empty = renderToStaticMarkup(createElement(DonutChart, { ...donut, data }))
        assert.match(empty, /data-state="empty"/)
        assert.match(empty, /No lessons yet/)
        assert.doesNotMatch(empty, /role="img"/)
        assert.match(empty, /data-slot="track"[^>]*border:8px solid var\(--grammar-bar-track/, "the empty state is the bare track ring")
    }
})

test("bars follow HeroUI ProgressBar sizes: the ring is the md track thick (8px) over a ring of the track colour", () => {
    assert.equal(DONUT_RING_WIDTH, 8)
    const html = renderToStaticMarkup(createElement(DonutChart, { ...donut, data: topics.slice(0, 3), size: 120 }))
    assert.match(html, /data-slot="track"[^>]*border:8px solid var\(--grammar-bar-track/)
    assert.ok(html.indexOf('data-slot="track"') < html.indexOf('role="img"'), "the track ring is under the parts")
})
