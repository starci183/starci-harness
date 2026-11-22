import { expect, test, type Page } from "@playwright/test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Hit } from "./shared/collision.ts"

const STORIES = ["knowledge-brain", "knowledge-docs", "knowledge-sparse", "knowledge-long"] as const
const SNAPSHOT = join(import.meta.dirname, "knowledge.snap.json")
const RESULTS = join(import.meta.dirname, "results")

type Snapshot = Record<string, unknown>

interface Report {
    readonly hits: Hit[]
    /** The centre and the radius of each bubble in graph units, and the box of each name. */
    readonly snapshot: unknown
    /** The computed font size of a cluster name, in px. */
    readonly nameSize: number
    readonly zoom: number
}

/**
 * Measures the knowledge map. The layout is checked in graph units (the offsets inside the stage, so they do not depend on the window): a bubble within 6 of
 * another, a name within 8 of a bubble or of another name. The view is checked in screen pixels: at desktop width every bubble and name lies inside the canvas,
 * and on every width the zoom buttons cover nothing (they sit in their own toolbar, so no bubble or name may reach into it).
 */
const measure = (page: Page): Promise<Report> =>
    page.evaluate(() => {
        interface Box {
            l: number
            t: number
            r: number
            b: number
        }
        const hits: { rule: string; a: string; b: string }[] = []
        const root = document.querySelector<HTMLElement>(".starci-knowledge")
        const stage = root?.querySelector<HTMLElement>(".starci-knowledge-stage") ?? null
        if (root === null || stage === null) return { hits: [{ rule: "no map", a: "", b: "" }], snapshot: null, nameSize: 0, zoom: 0 }
        const rect = (r: DOMRect): Box => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })
        const meet = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
        const inflate = (b: Box, by: number): Box => ({ l: b.l - by, t: b.t - by, r: b.r + by, b: b.b + by })
        const px = (v: string): number => Number.parseFloat(v)
        const zoom = new DOMMatrix(getComputedStyle(stage).transform).a
        const bubbleEls = [...stage.querySelectorAll<HTMLElement>(".starci-knowledge-bubble")]
        const nameEls = [...stage.querySelectorAll<HTMLElement>(".starci-knowledge-name")]
        const bubbles = bubbleEls.map((el) => ({ id: el.dataset.id ?? "", x: px(el.style.left) + px(el.style.inlineSize) / 2, y: px(el.style.top) + px(el.style.blockSize) / 2, r: px(el.style.inlineSize) / 2, box: rect(el.getBoundingClientRect()) }))
        const names = nameEls.map((el) => ({ id: `name:${el.dataset.cluster ?? ""}`, l: px(el.style.left), t: px(el.style.top), r: px(el.style.left) + px(el.style.inlineSize), b: px(el.style.top) + px(el.style.blockSize), box: rect(el.getBoundingClientRect()) }))

        for (let i = 0; i < bubbles.length; i += 1)
            for (let j = i + 1; j < bubbles.length; j += 1) {
                const a = bubbles[i]
                const b = bubbles[j]
                if (a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + 6 - 0.05) hits.push({ rule: "bubble within 6 of bubble", a: a.id, b: b.id })
            }
        for (let i = 0; i < names.length; i += 1) {
            const a = names[i]
            if (a === undefined) continue
            for (let j = i + 1; j < names.length; j += 1) {
                const b = names[j]
                if (b !== undefined && a.l < b.r + 8 && b.l < a.r + 8 && a.t < b.b + 8 && b.t < a.b + 8) hits.push({ rule: "name within 8 of name", a: a.id, b: b.id })
            }
            for (const bubble of bubbles) {
                const nx = Math.max(a.l, Math.min(bubble.x, a.r))
                const ny = Math.max(a.t, Math.min(bubble.y, a.b))
                if (Math.hypot(bubble.x - nx, bubble.y - ny) < bubble.r + 8 - 0.05) hits.push({ rule: "name within 8 of bubble", a: a.id, b: bubble.id })
            }
        }

        // The view: the zoom buttons cover nothing; at desktop width the whole map is in the canvas.
        const canvas = rect((root.querySelector(".starci-knowledge-canvas") ?? root).getBoundingClientRect())
        const controls = inflate(rect((root.querySelector(".starci-knowledge-zoom") ?? root).getBoundingClientRect()), 8)
        for (const item of [...bubbles, ...names]) {
            if (meet(item.box, canvas) && meet(controls, item.box)) hits.push({ rule: "under the zoom controls", a: item.id, b: "" })
            if (window.innerWidth >= 1000 && (item.box.l < canvas.l - 1 || item.box.r > canvas.r + 1 || item.box.t < canvas.t - 1 || item.box.b > canvas.b + 1)) hits.push({ rule: "out of the canvas at desktop width", a: item.id, b: "" })
        }
        if (document.documentElement.scrollWidth > window.innerWidth) hits.push({ rule: "page scrolls sideways", a: "", b: "" })
        if (window.innerWidth >= 1000 && document.documentElement.scrollHeight > window.innerHeight + 1) hits.push({ rule: "page scrolls", a: "", b: "" })

        const round = (v: number): number => Math.round(v * 10) / 10
        const snapshot = {
            bubbles: Object.fromEntries(bubbles.map((bubble) => [bubble.id, [round(bubble.x), round(bubble.y), round(bubble.r)]])),
            names: Object.fromEntries(names.map((name) => [name.id, [name.l, name.t, name.r - name.l, name.b - name.t]])),
        }
        // A cluster's name is the core's Text in the caption role (12px).
        const first = nameEls[0]?.querySelector("[data-component=Text]") ?? nameEls[0]
        return { hits, snapshot, nameSize: first === undefined ? 0 : Number.parseFloat(getComputedStyle(first).fontSize), zoom }
    })

const open = async (page: Page, story: string): Promise<void> => {
    await page.goto(`/?story=${story}&theme=light`)
    await page.locator(".starci-knowledge-bubble").first().waitFor()
    await page.waitForTimeout(300)
}

const committed: Snapshot = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot) : {}
const taken: Snapshot = {}

for (const story of STORIES) {
    test(`knowledge collision spec: ${story}`, async ({ page }) => {
        await open(page, story)
        const first = await measure(page)
        // The graph is the same on every screen: the same units, the same text size, 100% zoom at the start.
        expect(first.zoom).toBe(1)
        expect(first.nameSize).toBe(12)
        const desktop = (page.viewportSize()?.width ?? 0) >= 1000
        // At desktop width every rule; on a phone the view is a window onto the same layout, so only the zoom buttons and the text size are the view's to answer.
        const relevant = desktop ? first.hits : first.hits.filter((hit) => hit.rule === "under the zoom controls")
        expect(relevant, JSON.stringify(first.hits.slice(0, 6))).toEqual([])
        // The same input gives the same positions again, and the ones in the committed snapshot.
        await page.reload()
        await page.locator(".starci-knowledge-bubble").first().waitFor()
        await page.waitForTimeout(300)
        const second = await measure(page)
        expect(second.snapshot).toEqual(first.snapshot)
        taken[story] = first.snapshot
        if (process.env.UPDATE_SNAPSHOT === undefined) expect(committed[story], `no snapshot for ${story}; run once with UPDATE_SNAPSHOT=1`).toEqual(first.snapshot)
        else writeFileSync(SNAPSHOT, `${JSON.stringify({ ...committed, ...taken }, null, 1)}\n`)
    })
}

test("the layout is the same at 1440 and 390", async ({ page }, info) => {
    await open(page, "knowledge-brain")
    const report = await measure(page)
    mkdirSync(RESULTS, { recursive: true })
    writeFileSync(join(RESULTS, `knowledge-layout-${info.project.name}.json`), JSON.stringify(report.snapshot))
    const other = join(RESULTS, `knowledge-layout-${info.project.name === "1440" ? "390" : "1440"}.json`)
    if (existsSync(other)) expect(JSON.parse(readFileSync(other, "utf8"))).toEqual(report.snapshot)
})

test("the brain has 4 to 6 clusters, 30 or more bubbles and lines from items to sources", async ({ page }) => {
    await open(page, "knowledge-brain")
    expect(await page.locator(".starci-knowledge-name").count()).toBeGreaterThanOrEqual(4)
    expect(await page.locator(".starci-knowledge-name").count()).toBeLessThanOrEqual(6)
    expect(await page.locator(".starci-knowledge-bubble").count()).toBeGreaterThanOrEqual(30)
    expect(await page.locator(".starci-knowledge-line").count()).toBeGreaterThan(20)
})

test("a click opens a bubble and the zoom buttons are 40px", async ({ page }) => {
    await open(page, "knowledge-sparse")
    await page.locator('.starci-knowledge-bubble[data-id="a1"]').dispatchEvent("click")
    expect(await page.evaluate(() => (window as unknown as { knowledgeOpened?: string }).knowledgeOpened)).toBe("a1")
    for (const name of ["Phóng to", "Thu nhỏ", "Vừa khung"]) {
        const box = await page.getByRole("button", { name }).boundingBox()
        expect([box?.width, box?.height]).toEqual([40, 40])
    }
    await page.getByRole("button", { name: "Phóng to" }).click()
    expect((await measure(page)).zoom).toBeGreaterThan(1)
    await page.getByRole("button", { name: "Vừa khung" }).click()
    expect((await measure(page)).hits.filter((hit) => hit.rule === "under the zoom controls")).toEqual([])
})

test("hover names a bubble @desktop", async ({ page }) => {
    await open(page, "knowledge-brain")
    await page.locator('.starci-knowledge-bubble[data-id="p-f1"]').hover()
    await expect(page.locator(".starci-knowledge-tip")).toContainText("Gói Cơ bản 1,2 triệu mỗi tháng")
})

test("shots", async ({ page }, info) => {
    // The pictures go to GRAPH_SHOTS_DIR, else to e2e/shots (ignored), like the other modes'.
    const dir = process.env.GRAPH_SHOTS_DIR ?? join(import.meta.dirname, "shots")
    for (const story of [...STORIES, "knowledge-loading", "knowledge-empty"]) {
        await page.goto(`/?story=${story}&theme=light`)
        await page.waitForTimeout(700)
        await page.screenshot({ path: join(dir ?? "", `${story}-${info.project.name}.png`) })
    }
})
