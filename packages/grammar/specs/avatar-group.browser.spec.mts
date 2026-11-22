/**
 * AvatarGroup's member list in a real browser (owner 2026-11-22): hover, focus or a tap on the group opens the list of every member (its avatar, its name and an
 * agent's small "AI" Chip); the pointer leaving, Escape, a blur or a press outside closes it. Bundled with the package's own Vite and driven in Chromium through
 * Playwright. Skipped, loudly, when no Chromium is installed.
 *
 *   node --import ./specs/support/register.mts --test specs/avatar-group.browser.spec.mts
 */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { chromium, devices, type Browser, type Page } from "playwright"
import { build } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

const bundle = async (): Promise<string> => {
    const dir = mkdtempSync(join(root, "specs", ".bundle-"))
    try {
        const entry = join(dir, "entry.tsx")
        writeFileSync(entry, `
import { createRoot } from "react-dom/client"
import { AvatarGroup } from "../../src/core/composite/AvatarGroup/index.tsx"
const items = [
    { id: "an", name: "Nguyễn Văn An" },
    { id: "hoa", name: "Đỗ Thị Hoa" },
    { id: "sales", name: "Trợ lý bán hàng", kind: "agent" as const },
    { id: "dat", name: "Lê Quang Đạt" },
    { id: "care", name: "Chăm sóc khách", kind: "agent" as const },
    { id: "binh", name: "Trần Bình" },
]
createRoot(document.getElementById("app")!).render(
    <AvatarGroup label="Nhóm phụ trách" items={items} size="sm" overflowLabel={(n) => n + " người khác"} agentLabel="AI" />,
)
`)
        const result = await build({
            root: dir, configFile: false, logLevel: "silent", mode: "production",
            define: { "process.env.NODE_ENV": '"production"' },
            build: { write: false, minify: false, lib: { entry, formats: ["es"], fileName: "bundle" } },
        })
        const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => ("output" in item ? item.output : []))
        const chunks = outputs.filter((output) => output.type === "chunk")
        assert.equal(chunks.length, 1, "one self-contained bundle")
        const chunk = chunks[0]
        assert.ok(chunk !== undefined && chunk.type === "chunk")
        return chunk.code
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

let browser: Browser | undefined
try { browser = await chromium.launch() } catch { browser = undefined }

const open = async (code: string, touch = false): Promise<Page> => {
    assert.ok(browser !== undefined)
    const page = touch ? await (await browser.newContext({ ...devices["Pixel 7"] })).newPage() : await browser.newPage()
    await page.setContent(`<!doctype html><html lang="vi"><body><div class="grammar-common-root"><p id="outside" style="margin:200px 0 0">Ngoài</p><div id="app"></div><button id="next">Sau</button></div></body></html>`)
    await page.addScriptTag({ type: "module", content: code })
    await page.waitForSelector("[data-grammar-avatar-group-trigger]")
    return page
}

const LIST = '[data-grammar-avatar-members="true"]'

test("AvatarGroup member list in Chromium", { skip: browser === undefined ? "no Chromium installed (npx playwright install chromium)" : false }, async (t) => {
    const code = await bundle()
    const trigger = (page: Page) => page.getByRole("group", { name: "Nhóm phụ trách" })

    await t.test("the group shows alone: max 4 gives three avatars and +3, no name printed beside it, and the list is closed", async () => {
        const page = await open(code)
        assert.equal(await page.locator('[data-component="Avatar"]').count(), 3)
        assert.equal(await page.locator('[data-grammar-avatar-count="true"]').count(), 1)
        assert.equal(await page.locator(LIST).count(), 0)
        const text = await page.locator("#app").innerText()
        assert.ok(!/Nguyễn|Hoa|Trợ lý/.test(text), `no member name as text: ${text}`)
        assert.equal(await trigger(page).getAttribute("aria-expanded"), "false")
        await page.close()
    })

    await t.test("hover opens the list of every member, each its avatar, its name and an agent's AI Chip; leaving closes it", async () => {
        const page = await open(code)
        await trigger(page).hover()
        const list = page.getByRole("list", { name: "Nhóm phụ trách" })
        await list.waitFor()
        assert.equal(await trigger(page).getAttribute("aria-expanded"), "true")
        const rows = list.getByRole("listitem")
        assert.deepEqual((await rows.allTextContents()).map((row) => row.trim()), ["Nguyễn Văn An", "Đỗ Thị Hoa", "Trợ lý bán hàngAI", "Lê Quang Đạt", "Chăm sóc kháchAI", "Trần Bình"], "every member in order, an agent's name then its Chip")
        assert.equal(await list.locator('[data-component="Avatar"][data-grammar-avatar-size="sm"]').count(), 6, "each row leads with its 24px avatar")
        assert.equal(await list.locator('[data-component="AgentName"] [data-component="Badge"]').count(), 2, "the AI Chip only after the agents")
        // The pointer may cross into the list without closing it.
        await list.hover()
        await page.waitForTimeout(300)
        assert.equal(await page.locator(LIST).count(), 1, "the list stays while the pointer is over it")
        await page.mouse.move(5, 5)
        await page.locator(LIST).waitFor({ state: "detached" })
        await page.close()
    })

    await t.test("focus (Tab) opens it, Escape closes it, Tab away closes it; it never takes the focus", async () => {
        const page = await open(code)
        await page.keyboard.press("Tab")
        await page.locator(LIST).waitFor()
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-grammar-avatar-group-trigger")), "row", "focus stays on the group")
        await page.keyboard.press("Escape")
        await page.locator(LIST).waitFor({ state: "detached" })
        await page.keyboard.press("Enter")
        await page.locator(LIST).waitFor()
        await page.keyboard.press("Tab")
        await page.locator(LIST).waitFor({ state: "detached" })
        await page.close()
    })

    await t.test("a tap opens it, a second tap or a tap outside closes it", async () => {
        const page = await open(code, true)
        await trigger(page).tap()
        await page.locator(LIST).waitFor()
        await trigger(page).tap()
        await page.locator(LIST).waitFor({ state: "detached" })
        await trigger(page).tap()
        await page.locator(LIST).waitFor()
        await page.locator("#outside").tap()
        await page.locator(LIST).waitFor({ state: "detached" })
        await page.context().close()
    })
})

test.after(async () => { await browser?.close() })
