/**
 * MessageActions in a real browser: the keyboard and pointer behaviour a server render cannot show. The component is bundled with the package's own Vite
 * and driven in Chromium through Playwright (both are devDependencies). Skipped, loudly, when no Chromium is installed.
 *
 *   node --import ./specs/support/register.mts --test specs/message-actions.browser.spec.mts
 */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { chromium, type Browser, type Page } from "playwright"
import { build } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

const bundle = async (): Promise<string> => {
    const dir = mkdtempSync(join(root, "specs", ".bundle-"))
    try {
        const entry = join(dir, "entry.tsx")
        writeFileSync(entry, `
import { createRoot } from "react-dom/client"
import { MessageActions } from "../../src/core/composite/MessageActions/index.tsx"
const calls: string[] = []
;(window as unknown as { calls: string[] }).calls = calls
const labels = { react: "Bày tỏ cảm xúc", reply: "Trả lời", more: "Thêm", picker: "Chọn cảm xúc", reactWith: (e: string) => "Bày tỏ " + e, allEmoji: "Tất cả" }
createRoot(document.getElementById("app")!).render(
    <MessageActions side="incoming" labels={labels} onReact={(e) => calls.push("react " + e)} onReply={() => calls.push("reply")} onMore={() => calls.push("all")}
        menu={[{ id: "copy", label: "Sao chép" }, { id: "pin", label: "Ghim tin nhắn" }]} onMenuAction={(id) => calls.push("menu " + id)} />,
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

const open = async (code: string): Promise<Page> => {
    assert.ok(browser !== undefined)
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><html lang="vi"><body><div class="grammar-common-root"><p id="outside">Ngoài</p><div id="app"></div></div></body></html>`)
    await page.addScriptTag({ type: "module", content: code })
    await page.waitForSelector('[data-grammar-message-action="react"]')
    return page
}

test("message actions in Chromium", { skip: browser === undefined ? "no Chromium installed (npx playwright install chromium)" : false }, async (t) => {
    const code = await bundle()
    const calls = async (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { calls: string[] }).calls)

    await t.test("keyboard: every button is reachable by Tab, in order react, reply, more", async () => {
        const page = await open(code)
        const order: string[] = []
        for (let index = 0; index < 3; index += 1) {
            await page.keyboard.press("Tab")
            order.push(await page.evaluate(() => document.activeElement?.getAttribute("data-grammar-message-action") ?? ""))
        }
        assert.deepEqual(order, ["react", "reply", "more"])
        await page.close()
    })

    await t.test("Esc closes the picker and gives focus back to the react button", async () => {
        const page = await open(code)
        await page.getByRole("button", { name: "Bày tỏ cảm xúc" }).press("Enter")
        const picker = page.getByRole("dialog", { name: "Chọn cảm xúc" })
        await picker.waitFor()
        assert.equal(await picker.getByRole("button").count(), 7, "six emoji and the +")
        assert.deepEqual(await picker.getByRole("button").evaluateAll((nodes) => nodes.slice(0, 6).map((node) => node.textContent)), ["❤️", "😆", "😮", "😢", "😡", "👍"])
        await page.keyboard.press("Escape")
        await picker.waitFor({ state: "detached" })
        await page.waitForFunction(() => document.activeElement?.getAttribute("data-grammar-message-action") === "react")
        assert.equal(await page.getByRole("button", { name: "Bày tỏ cảm xúc" }).getAttribute("aria-expanded"), "false")
        await page.close()
    })

    await t.test("an outside press closes it; choosing an emoji reacts and closes; + hands over to the app", async () => {
        const page = await open(code)
        const react = page.getByRole("button", { name: "Bày tỏ cảm xúc" })
        await react.click()
        const picker = page.getByRole("dialog", { name: "Chọn cảm xúc" })
        await picker.waitFor()
        assert.equal(await react.getAttribute("aria-expanded"), "true", "the open trigger says so (the sheet keeps its hover fill)")
        await page.mouse.click(2, 2)
        await picker.waitFor({ state: "detached" })
        await react.click()
        await picker.waitFor()
        await page.getByRole("button", { name: "Bày tỏ 😆" }).click()
        await picker.waitFor({ state: "detached" })
        await react.click()
        await page.getByRole("button", { name: "Tất cả" }).click()
        await picker.waitFor({ state: "detached" })
        assert.deepEqual(await calls(page), ["react 😆", "all"])
        await page.close()
    })

    await t.test("reply fires, and the more menu lists the app's items and reports the chosen one", async () => {
        const page = await open(code)
        await page.getByRole("button", { name: "Trả lời" }).click()
        await page.getByRole("button", { name: "Thêm" }).click()
        const items = page.getByRole("menuitem")
        await items.first().waitFor()
        assert.deepEqual(await items.allTextContents(), ["Sao chép", "Ghim tin nhắn"])
        await page.keyboard.press("Escape")
        await items.first().waitFor({ state: "detached" })
        await page.getByRole("button", { name: "Thêm" }).click()
        await page.getByRole("menuitem", { name: "Ghim tin nhắn" }).click()
        assert.deepEqual(await calls(page), ["reply", "menu pin"])
        await page.close()
    })
})

test.after(async () => { await browser?.close() })
