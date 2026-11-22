import { expect, test, type Page } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const SHOTS = process.env.GRAPH_SHOTS_DIR ?? join(import.meta.dirname, "shots")
const STORIES = ["states", "decision", "loop", "containers", "islands", "legend", "edges", "vertical", "editable", "loading", "schema"] as const

const open = async (page: Page, story: string, theme = "light"): Promise<void> => {
    await page.goto(`/?story=${story}&theme=${theme}`)
    if (story === "loading") await page.locator(".starci-graph-skeleton").waitFor()
    else await page.locator(".react-flow__node").first().waitFor()
    await page.waitForTimeout(400)
}

interface PathStyle {
    readonly animation: string
    readonly dash: string
    readonly opacity: string
    readonly stroke: string
}

const pathStyle = (page: Page, edgeId: string): Promise<PathStyle> =>
    page.locator(`[data-testid="rf__edge-${edgeId}"] .react-flow__edge-path`).evaluate((path) => {
        const style = getComputedStyle(path)
        return { animation: style.animationName, dash: style.strokeDasharray, opacity: style.opacity, stroke: style.stroke }
    })

test.describe("states", () => {
    test("the six states are drawn, in the words of the app", async ({ page }) => {
        await open(page, "states")
        const names = await page.locator(".react-flow__node").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))
        expect(names).toEqual(expect.arrayContaining(["Nhận đơn, Xong", "Gửi email, Đang chạy", "Chờ duyệt, Chờ", "Gọi thanh toán, Lỗi", "Nhắc lại, Bỏ qua", "Ghi nhận, Chưa chạy"]))
        for (const status of ["done", "running", "wait", "error", "skipped", "todo"]) await expect(page.locator(`.starci-graph-node[data-status=${status}]`).first()).toBeVisible()
        await expect(page.locator(".starci-graph-node[data-status=running] .starci-graph-status")).toHaveText("Đang chạy")
        // The node's mark is the core's round 40px IconTile in the running state.
        await expect(page.locator(".starci-graph-node[data-status=running] .starci-graph-node-icon [data-component=IconTile]").first()).toHaveAttribute("data-grammar-mark-state", "running")
    })

    test("the edge into a running step flows (moving dots on a solid line); the edge into a waiting step is solid amber and still", async ({ page }) => {
        await open(page, "states")
        const dots = page.locator('[data-testid="rf__edge-start->run"] .starci-graph-edge-flow')
        expect(await dots.evaluate((path) => getComputedStyle(path).animationName)).toBe('starci-graph-dash')
        const into = await pathStyle(page, 'start->run')
        expect(into.dash).toBe('none')
        const waiting = await pathStyle(page, 'start->wait')
        expect(waiting.animation).toBe('none')
        expect(waiting.dash).toBe('none')
        expect(into.stroke).not.toBe(waiting.stroke)
        await expect(page.locator('[data-testid="rf__edge-start->wait"] .starci-graph-edge-flow')).toHaveCount(0)
        await expect(page.locator('[data-testid="rf__edge-start->run"]')).toHaveClass(/animated/)
        await expect(page.locator('[data-testid="rf__edge-start->wait"]')).not.toHaveClass(/animated/)
        // not reached yet: dashed grey
        expect((await pathStyle(page, 'run->run2')).dash).not.toBe('none')
    })

    test("only the running tile turns (the core's ring or spinner)", async ({ page }) => {
        await open(page, "states")
        const turning = (status: string): Promise<number> =>
            page.locator(`.starci-graph-node[data-status=${status}] .starci-graph-node-icon`).first().evaluate((tile) => tile.querySelectorAll(".starci-core-icon-tile-ring, .starci-core-status-spinner").length)
        expect(await turning("running")).toBeGreaterThan(0)
        expect(await turning("wait")).toBe(0)
        expect(await turning("done")).toBe(0)
    })
})

test.describe("decisions", () => {
    test("every branch is drawn: the taken one solid, the untaken ones skipped and labelled from props", async ({ page }) => {
        await open(page, "decision")
        const taken = await pathStyle(page, "paid->ok")
        expect(taken.dash).toBe("none")
        expect(taken.opacity).toBe("1")
        for (const id of ["paid->remind", "paid->cancel", "ok->backorder"]) {
            await expect(page.locator(`[data-testid="rf__edge-${id}"]`)).toHaveClass(/starci-graph-edge--skipped/)
            const skipped = await pathStyle(page, id)
            expect(skipped.dash).toMatch(/^1\.5/)
            expect(Number(skipped.opacity)).toBeLessThan(1)
        }
        await expect(page.locator(".starci-graph-edge-pill", { hasText: "Bỏ qua" })).toHaveCount(3)
        await expect(page.locator(".starci-graph-edge-pill", { hasText: "Quá hạn" })).toBeVisible()
    })

    test("the edge variants have distinct styles", async ({ page }) => {
        await open(page, "edges")
        const styles = await Promise.all(["a->b", "a->c", "a->d"].map((id) => pathStyle(page, id)))
        expect(new Set(styles.map((style) => style.dash)).size).toBe(3)
    })
})

test.describe("editing", () => {
    test("read-only by default: a drag pans the canvas and moves no node against another", async ({ page }) => {
        await open(page, "legend")
        await expect(page.locator(".starci-graph-reset")).toHaveCount(0)
        const gap = async (): Promise<number> => {
            const first = await page.locator('.react-flow__node[data-id="t"]').boundingBox()
            const second = await page.locator('.react-flow__node[data-id="ask"]').boundingBox()
            return (second?.x ?? 0) - (first?.x ?? 0)
        }
        const before = await gap()
        const box = await page.locator('.react-flow__node[data-id="t"]').boundingBox()
        await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + 20)
        await page.mouse.down()
        await page.mouse.move((box?.x ?? 0) + 140, (box?.y ?? 0) + 120, { steps: 6 })
        await page.mouse.up()
        expect(await gap()).toBeCloseTo(before, 0)
    })

    test("editable drags, saves the positions and resets @desktop", async ({ page }) => {
        await open(page, "editable")
        const node = page.locator('.react-flow__node[data-id="start"]')
        const start = await node.boundingBox()
        expect(start).not.toBeNull()
        if (start === null) return
        const gap = async (): Promise<number> => ((await page.locator('.react-flow__node[data-id="run"]').boundingBox())?.x ?? 0) - ((await node.boundingBox())?.x ?? 0)
        const before = await gap()
        const grab = Math.max(start.x, 0) + 30
        await page.mouse.move(grab, start.y + 20)
        await page.mouse.down()
        await page.mouse.move(grab + 100, start.y + 120, { steps: 8 })
        await page.mouse.up()
        expect(await gap()).not.toBeCloseTo(before, 0)
        await expect(page.getByTestId("positions")).toContainText('"start"')
        await page.getByRole("button", { name: "Đặt lại bố cục" }).click()
        await expect(page.getByTestId("positions")).toHaveText("{}")
        await page.waitForTimeout(200)
        expect(await gap()).toBeCloseTo(before, 0)
    })
})

test.describe("surface", () => {
    test("the panel is the surface with a 1px border and every card is the surface and its border with no shadow", async ({ page }) => {
        await open(page, "states")
        const surface = await page.evaluate(() => {
            const probe = document.createElement("div")
            probe.style.background = "var(--surface)"
            document.body.append(probe)
            const colour = getComputedStyle(probe).backgroundColor
            probe.remove()
            return colour
        })
        const panel = page.locator(".starci-graph")
        await expect(panel).toHaveCSS("background-color", surface)
        await expect(panel).toHaveCSS("border-top-width", "1px")
        for (const card of await page.locator(".starci-graph-node, .starci-graph-container").all()) await expect(card).toHaveCSS("box-shadow", "none")
    })
})

test.describe("loading and containers", () => {
    test("loading is all skeleton, with no text", async ({ page }) => {
        await open(page, "loading")
        await expect(page.locator(".starci-graph[aria-busy=true]")).toBeVisible()
        expect((await page.locator(".starci-graph").innerText()).trim()).toBe("")
    })

    test("a loop draws its dashed frame and the words of its exits outside it, and its children stay inside it", async ({ page }) => {
        await open(page, "loop-two-exits")
        const frame = await page.locator('.react-flow__node[data-id="retry"]').boundingBox()
        const child = await page.locator('.react-flow__node[data-id="dial"]').boundingBox()
        expect(frame).not.toBeNull()
        expect(child).not.toBeNull()
        if (frame === null || child === null) return
        expect(child.x).toBeGreaterThan(frame.x)
        expect(child.x + child.width).toBeLessThan(frame.x + frame.width)
        expect(child.y).toBeGreaterThan(frame.y)
        await expect(page.locator(".starci-graph-container[data-container=loop]")).toHaveCSS("border-top-style", "solid")
        await expect(page.locator(".starci-graph-edge-pill", { hasText: "Đã liên lạc" })).toBeVisible()
        await expect(page.locator(".starci-graph-edge-pill", { hasText: "Bỏ cuộc" })).toBeVisible()
    })
})

const FLOWS = ["order-approval", "wait-person", "wait-time", "wait-external", "error-reason", "linear", "branch-merge", "nested-branch", "loop", "loop-two-exits", "parallel", "long-labels", "big"] as const
const MIXES = ["todo", "running", "waiting", "error", "done"] as const

test.describe("pictures", () => {
    // <story>/<state mix>-<width>.png, for every flow in every mix
    for (const story of FLOWS)
        for (const mix of MIXES) {
            test(`shoot ${story} ${mix}`, async ({ page }, info) => {
                mkdirSync(join(SHOTS, story), { recursive: true })
                await page.goto(`/?story=${story}&mix=${mix}&theme=light`)
                await page.locator(".react-flow__node").first().waitFor()
                await page.waitForTimeout(500)
                await page.screenshot({ path: join(SHOTS, story, `${mix}-${info.project.name}.png`), fullPage: true })
            })
        }

    for (const story of STORIES) {
        test(`shoot ${story}`, async ({ page }, info) => {
            mkdirSync(join(SHOTS, story), { recursive: true })
            await open(page, story)
            await page.screenshot({ path: join(SHOTS, story, `default-${info.project.name}.png`), fullPage: true })
        })
    }
})
