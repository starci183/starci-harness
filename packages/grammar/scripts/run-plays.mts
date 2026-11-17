// Runs the play functions of the built Storybook (`npm run build-storybook`) in a real browser at 1440 and 390, and fails when one throws.
// Usage: node scripts/run-plays.mts [title-substring] [--widths=1440,390] [--shots=<folder>]
// A story's play function is its proof; `--shots` also writes a full-page picture (device scale factor 2) of each story after it played.
import { spawn } from "node:child_process"
import { readFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "@playwright/test"

const args = process.argv.slice(2)
const filter = args.find((arg) => !arg.startsWith("--")) ?? ""
const widths = (args.find((arg) => arg.startsWith("--widths="))?.slice(9) ?? "1440,390").split(",").map(Number)
const shots = args.find((arg) => arg.startsWith("--shots="))?.slice(8)
const family = args.find((arg) => arg.startsWith("--family="))?.slice(9) ?? "core"
const port = 6008

const index: { entries: Record<string, { id: string; title: string; name: string; type: string; tags?: string[] }> } = JSON.parse(readFileSync("storybook-static/index.json", "utf8"))
const stories = Object.values(index.entries).filter((entry) => entry.type === "story" && entry.title.includes(filter) && entry.tags?.includes("play-fn") === true)
if (stories.length === 0) throw new Error(`no story with a play function matches "${filter}"`)

const server = spawn(process.execPath, ["scripts/serve-static.mts", "storybook-static", String(port)], { stdio: "ignore" })
const browser = await chromium.launch()
let failed = 0
try {
    for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" })
        for (const story of stories) {
            const page = await context.newPage()
            await page.addInitScript(() => {
                const state = { done: false, error: null as string | null }
                ;(window as unknown as { __plays: typeof state }).__plays = state
                const timer = setInterval(() => {
                    const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__?: { on: (event: string, handler: (payload: unknown) => void) => void } }).__STORYBOOK_ADDONS_CHANNEL__
                    if (channel === undefined) return
                    clearInterval(timer)
                    channel.on("storyRendered", () => { state.done = true })
                    for (const event of ["playFunctionThrewException", "storyThrewException", "storyErrored", "storyMissing"]) {
                        channel.on(event, (payload) => {
                            state.error = typeof payload === "object" && payload !== null && "message" in payload ? String((payload as { message: unknown }).message) : JSON.stringify(payload)
                            state.done = true
                        })
                    }
                }, 2)
            })
            await page.goto(`http://127.0.0.1:${port}/iframe.html?id=${story.id}&viewMode=story&globals=grammarFamily:${family}`)
            const outcome = await page.waitForFunction(() => (window as unknown as { __plays: { done: boolean; error: string | null } }).__plays.done, undefined, { timeout: 45000 })
                .then(() => page.evaluate(() => (window as unknown as { __plays: { error: string | null } }).__plays.error))
                .catch(() => "timed out waiting for the play function")
            if (outcome !== null) failed += 1
            console.log(`${outcome === null ? "PASS" : "FAIL"} ${width} ${story.title} / ${story.name}${outcome === null ? "" : `\n     ${outcome.split("\n").slice(0, 6).join("\n     ")}`}`)
            if (shots !== undefined) {
                mkdirSync(shots, { recursive: true })
                await page.waitForLoadState("networkidle").catch(() => undefined)
                await page.screenshot({ path: join(shots, `${story.id}-${width}.png`), fullPage: true })
            }
            await page.close()
        }
        await context.close()
    }
} finally {
    await browser.close()
    server.kill()
}
console.log(failed === 0 ? `all plays passed (${stories.length} stories x ${widths.length} widths)` : `${failed} play(s) failed`)
process.exit(failed === 0 ? 0 : 1)
