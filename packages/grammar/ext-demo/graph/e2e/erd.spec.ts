import { expect, test, type Page } from "@playwright/test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { measure, type Positions } from "./shared/collision.ts"

/** The ERD stories of the demo and how many edge crossings each may have (the default is 0). */
const STORIES = ["erd-shop", "erd-library", "erd-self", "erd-big", "erd-long"] as const
const CROSSINGS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    "1440": { "erd-shop": 0, "erd-library": 0, "erd-self": 0, "erd-big": 6, "erd-long": 0 },
}
const SNAPSHOT = join(import.meta.dirname, "erd.snap.json")
const SHOTS = process.env.GRAPH_SHOTS_DIR ?? join(import.meta.dirname, "shots")

const open = async (page: Page, story: string, theme = "light"): Promise<void> => {
    await page.goto(`/?story=${story}&theme=${theme}`)
    if (story === "erd-loading") await page.locator(".starci-graph-skeleton").waitFor()
    else await page.locator(".react-flow__node, .starci-erd-list li").first().waitFor()
    await page.waitForTimeout(700)
}

/**
 * The ERD rules on top of the shared layout spec: every line starts on the border of its field's box at the middle of that field's row and ends on the border of the
 * other box at the middle of its head (2px); each marker sits on the end of its line; the words of a line stay 8px clear of every marker.
 */
const measureErd = (page: Page): Promise<string[]> =>
    page.evaluate(() => {
        const hits: string[] = []
        const canvas = document.querySelector(".react-flow")
        if (canvas === null) return hits
        const viewport = canvas.querySelector(".react-flow__viewport")
        const zoom = viewport === null ? 1 : new DOMMatrix(getComputedStyle(viewport).transform).a
        const tol = 2 * zoom
        const nodes = new Map([...canvas.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => [el.dataset.id ?? "", el]))
        const pillBoxes = [...canvas.querySelectorAll<HTMLElement>(".starci-erd-pill")].map((el) => el.getBoundingClientRect())
        const marks: DOMRect[] = []
        for (const group of canvas.querySelectorAll<SVGGElement>(".react-flow__edge")) {
            const id = group.dataset.id ?? ""
            const own = group.querySelector("[data-edge-source]")
            const path = group.querySelector<SVGPathElement>(".react-flow__edge-path")
            const matrix = path?.getScreenCTM()
            const source = nodes.get(own?.getAttribute("data-edge-source") ?? "")
            const target = nodes.get(own?.getAttribute("data-edge-target") ?? "")
            if (path === null || matrix === null || matrix === undefined || source === undefined || target === undefined) {
                hits.push(`${id}: no line or no end`)
                continue
            }
            const at = (length: number): [number, number] => {
                const p = path.getPointAtLength(length).matrixTransform(matrix)
                return [p.x, p.y]
            }
            const start = at(0)
            const end = at(path.getTotalLength())
            const s = source.getBoundingClientRect()
            const t = target.getBoundingClientRect()
            const onBorder = (p: [number, number], b: DOMRect): boolean => (Math.abs(p[0] - b.left) <= tol || Math.abs(p[0] - b.right) <= tol) && p[1] >= b.top - tol && p[1] <= b.bottom + tol
            if (!onBorder(start, s)) hits.push(`${id}: start off the box border`)
            if (!onBorder(end, t)) hits.push(`${id}: end off the box border`)
            const rows = [...source.querySelectorAll<HTMLElement>(".starci-erd-row[data-link]")].map((row) => (row.getBoundingClientRect().top + row.getBoundingClientRect().bottom) / 2)
            if (!rows.some((y) => Math.abs(y - start[1]) <= tol)) hits.push(`${id}: start is not at the middle of a field row`)
            if (Math.abs(t.top + 32 * zoom - end[1]) > tol) hits.push(`${id}: end is not at the middle of the head`)
            const drawn = [...group.querySelectorAll<SVGGElement>(".starci-erd-mark")]
            if (drawn.length !== 2) hits.push(`${id}: ${String(drawn.length)} markers`)
            for (const [index, mark] of drawn.entries()) {
                const origin = new DOMPoint(0, 0).matrixTransform(mark.getScreenCTM() ?? undefined)
                const want = index === 0 ? start : end
                if (Math.abs(origin.x - want[0]) > tol || Math.abs(origin.y - want[1]) > tol) hits.push(`${id}: marker ${String(index)} is off its port`)
                marks.push(mark.getBoundingClientRect())
            }
        }
        // the zoom controls: no box, word, marker or run of a line stands under them (8px)
        const controls = canvas.querySelector(".starci-graph-zoom")?.getBoundingClientRect()
        if (controls !== undefined) {
            const g = 8
            const hitBox = (b: { left: number; right: number; top: number; bottom: number }): boolean => b.left < controls.right + g && b.right > controls.left - g && b.top < controls.bottom + g && b.bottom > controls.top - g
            for (const [id, el] of nodes) if (hitBox(el.getBoundingClientRect())) hits.push(`${id}: under the zoom controls`)
            for (const pill of pillBoxes) if (hitBox(pill)) hits.push("a label is under the zoom controls")
            for (const mark of marks) if (hitBox(mark)) hits.push("a marker is under the zoom controls")
            for (const group of canvas.querySelectorAll<SVGGElement>(".react-flow__edge")) {
                const path = group.querySelector<SVGPathElement>(".react-flow__edge-path")
                const matrix = path?.getScreenCTM()
                if (path === null || matrix === null || matrix === undefined) continue
                for (let at = 0; at <= path.getTotalLength(); at += 3) {
                    const p = path.getPointAtLength(at).matrixTransform(matrix)
                    if (hitBox({ left: p.x, right: p.x, top: p.y, bottom: p.y })) {
                        hits.push(`${group.dataset.id ?? ""}: a line is under the zoom controls`)
                        break
                    }
                }
            }
        }
        const gap = 8 * zoom - 0.01
        for (const pill of pillBoxes)
            for (const mark of marks) if (pill.left - gap < mark.right && mark.left < pill.right + gap && pill.top - gap < mark.bottom && mark.top < pill.bottom + gap) hits.push("a label is within 8px of a marker")
        return hits
    })

/** The sizes of the text of the map, by role: a phone shows the same sizes as a wide page. */
const textSizes = (page: Page): Promise<Record<string, string>> =>
    page.evaluate(() => {
        const sizes: Record<string, string> = {}
        for (const el of document.querySelectorAll<HTMLElement>(".starci-erd .starci-core-text, .starci-erd-pill *")) sizes[el.dataset.role ?? el.className.split(" ")[0] ?? ""] = getComputedStyle(el).fontSize
        return sizes
    })

/** On a phone the map is the desktop map at 100% in a window: the same layout and text sizes, the controls over nothing, a finger (a drag) pans it. */
const phoneSpec = async (page: Page, story: string, project: string): Promise<void> => {
    await open(page, story)
    const zoom = await page.locator(".react-flow__viewport").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
    expect(zoom).toBeCloseTo(1, 5)
    expect((await measureErd(page)).filter((hit) => hit.includes("zoom controls"))).toEqual([])
    const phone = await textSizes(page)
    const box = await page.locator(".starci-graph").boundingBox()
    expect(box?.height).toBeGreaterThan(0.69 * 844)
    expect(box?.height).toBeLessThan(0.71 * 844)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, `${story}-${project}.png` ) })
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, story)
    expect(await textSizes(page)).toEqual(phone)
}

const committed: Record<string, Positions> = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, Positions>) : {}
const taken: Record<string, Positions> = {}

for (const story of STORIES) {
    test(`erd layout spec: ${story}`, async ({ page }, info) => {
        if (info.project.name === "390") {
            await phoneSpec(page, story, info.project.name)
            return
        }
        const crossings = CROSSINGS[info.project.name]?.[story] ?? 0
        await open(page, story)
        const first = await measure(page, crossings)
        expect(first.hits).toEqual([])
        expect(await measureErd(page)).toEqual([])
        mkdirSync(SHOTS, { recursive: true })
        await page.screenshot({ path: join(SHOTS, `${story}-${info.project.name}.png`) })
        // the same input gives the same coordinates again, and the ones in the committed snapshot
        await open(page, story)
        expect((await measure(page, crossings)).positions).toEqual(first.positions)
        const name = `${story} ${info.project.name}`
        taken[name] = first.positions
        if (process.env.UPDATE_SNAPSHOT === undefined) expect(committed[name], `no snapshot for ${name}; run once with UPDATE_SNAPSHOT=1`).toEqual(first.positions)
    })
}

test.afterAll(() => {
    if (process.env.UPDATE_SNAPSHOT !== undefined) writeFileSync(SNAPSHOT, `${JSON.stringify({ ...committed, ...taken }, null, 1)}\n`)
})

test("an entity is pressed: onOpen gets its type @desktop", async ({ page }) => {
    await open(page, "erd-shop")
    await page.locator('.react-flow__node[data-id="product"]').click()
    await expect(page.getByTestId("opened")).toHaveText("product")
    await page.locator('.react-flow__node[data-id="customer"]').focus()
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("opened")).toHaveText("customer")
})

test("hovering a relation lights both ends, the field and the line @desktop", async ({ page }) => {
    await open(page, "erd-shop")
    const middle = await page.locator('[data-testid="rf__edge-order.buyer>customer"] .react-flow__edge-path').evaluate((path: SVGPathElement) => {
        const p = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM() ?? undefined)
        return [p.x, p.y] as const
    })
    await page.mouse.move(middle[0], middle[1])
    await expect(page.locator('.react-flow__node[data-id="order"] .starci-erd')).toHaveAttribute("data-lit", "true")
    await expect(page.locator('.react-flow__node[data-id="customer"] .starci-erd')).toHaveAttribute("data-lit", "true")
    await expect(page.locator('.react-flow__node[data-id="product"] .starci-erd')).not.toHaveAttribute("data-lit", "true")
    await expect(page.locator('.react-flow__node[data-id="order"] .starci-erd-row[data-lit="true"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="rf__edge-order.buyer>customer"] .starci-erd-edge')).toHaveAttribute("data-lit", "true")
    const empty = await page.evaluate(() => {
        const pane = document.querySelector(".react-flow__pane")?.getBoundingClientRect()
        for (let y = (pane?.top ?? 0) + 8; y < (pane?.bottom ?? 0); y += 24)
            for (let x = (pane?.left ?? 0) + 60; x < (pane?.right ?? 0); x += 24) if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane") === true) return [x, y] as const
        return [0, 0] as const
    })
    await page.mouse.move(empty[0], empty[1], { steps: 12 })
    await expect(page.locator('.react-flow__node[data-id="order"] .starci-erd')).not.toHaveAttribute("data-lit", "true")
})

test("the zoom controls are 40px", async ({ page }) => {
    await open(page, "erd-shop")
    for (const button of await page.locator(".starci-graph-zoom button").all()) {
        const box = await button.boundingBox()
        expect(box?.width).toBe(40)
        expect(box?.height).toBe(40)
    }
})

test("the words are the app's: none of the developer words are on the page", async ({ page }) => {
    await open(page, "erd-shop")
    const text = (await page.locator(".starci-graph").innerText()).toLowerCase()
    for (const word of ["fk", "pk", "schema", "cardinality", "foreign key"]) expect(text).not.toContain(word)
})

test("narrow: a drag pans the map, the size stays @phone", async ({ page }) => {
    await open(page, "erd-shop")
    const view = (): Promise<DOMMatrix> => page.locator(".react-flow__viewport").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform))
    const before = await view()
    const empty = await page.evaluate(() => {
        const pane = document.querySelector(".react-flow__pane")?.getBoundingClientRect()
        for (let y = (pane?.top ?? 0) + 8; y < (pane?.bottom ?? 0); y += 20)
            for (let x = (pane?.left ?? 0) + 80; x < (pane?.right ?? 0); x += 20) if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane") === true) return [x, y] as const
        return [0, 0] as const
    })
    await page.mouse.move(empty[0], empty[1])
    await page.mouse.down()
    await page.mouse.move(empty[0] - 60, empty[1] - 40, { steps: 6 })
    await page.mouse.up()
    const after = await view()
    expect(after.a).toBeCloseTo(1, 5)
    expect(before.e - after.e).toBeCloseTo(60, 0)
    expect(before.f - after.f).toBeCloseTo(40, 0)
})

test("the graph keeps clear of the zoom controls at 800 wide too @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    for (const story of ["erd-shop", "erd-library", "erd-big", "erd-long"]) {
        await open(page, story)
        expect(await measureErd(page), story).toEqual([])
    }
})

test("wide: the entities stand in columns @desktop", async ({ page }) => {
    await open(page, "erd-big")
    const boxes = await page.locator(".react-flow__node").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))
    expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBeGreaterThan(2)
})

test("loading is all skeleton: no words", async ({ page }) => {
    await open(page, "erd-loading")
    expect((await page.locator(".starci-graph").innerText()).trim()).toBe("")
})

test("no typed arrow is in the words of any story: a link is an icon", async ({ page }) => {
    for (const story of [...STORIES, "erd-loading"]) {
        await open(page, story)
        const text = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll("[title], [aria-label]")].map((el) => `${el.getAttribute("title") ?? ""}${el.getAttribute("aria-label") ?? ""}`).join(" "))
        expect(text, story).not.toMatch(/[\u2190-\u21FF\u2794-\u27BF]/u)
    }
    await open(page, "erd-shop")
    await expect(page.locator('.starci-erd-row[data-link] svg.starci-core-icon').first()).toBeVisible()
})
