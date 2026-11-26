// Shoots the stories of the built Storybook (`npm run build-storybook`) for a person to look at: every story, or those whose title
// holds the filter, at 390 and 1440 wide, light and dark, device scale factor 2, into one folder. A story's play function only
// drives what its picture needs (a hover, an open, a typed value) and is let finish first. Nothing here is a check: a story that
// throws or never settles is still shot and its note printed, and the run always exits 0 (contexts/ui/proof.md GRAMMAR-NO-TESTS).
// Usage: node scripts/shoot.mts [title-substring] [--out=shots] [--widths=390,1440] [--modes=light,dark] [--family=core|offset-pop]
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "@playwright/test"

const args = process.argv.slice(2)
const option = (name: string, fallback: string): string => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const filter = args.find((arg) => !arg.startsWith("--")) ?? ""
const out = option("out", "shots")
const widths = option("widths", "390,1440").split(",").map(Number)
const modes = option("modes", "light,dark").split(",")
const family = option("family", "core")
const port = 6008

const index: { entries: Record<string, { id: string; title: string; name: string; type: string }> } = JSON.parse(readFileSync("storybook-static/index.json", "utf8"))
const stories = Object.values(index.entries).filter((entry) => entry.type === "story" && entry.title.includes(filter))
if (stories.length === 0) {
    console.log(`no story matches "${filter}"`)
    process.exit(0)
}

mkdirSync(out, { recursive: true })
const server = spawn(process.execPath, ["scripts/serve-static.mts", "storybook-static", String(port)], { stdio: "ignore" })
const browser = await chromium.launch()
let shot = 0
try {
    for (const mode of modes) {
        for (const width of widths) {
            const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" })
            for (const story of stories) {
                const page = await context.newPage()
                await page.addInitScript(() => {
                    const state = { done: false, note: null as string | null }
                    ;(window as unknown as { __shoot: typeof state }).__shoot = state
                    const timer = setInterval(() => {
                        const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__?: { on: (event: string, handler: (payload: unknown) => void) => void } }).__STORYBOOK_ADDONS_CHANNEL__
                        if (channel === undefined) return
                        clearInterval(timer)
                        channel.on("storyRendered", () => { state.done = true })
                        for (const event of ["playFunctionThrewException", "storyThrewException", "storyErrored", "storyMissing"]) {
                            channel.on(event, (payload) => {
                                state.note = typeof payload === "object" && payload !== null && "message" in payload ? String((payload as { message: unknown }).message) : JSON.stringify(payload)
                                state.done = true
                            })
                        }
                    }, 2)
                })
                await page.goto(`http://127.0.0.1:${port}/iframe.html?id=${story.id}&viewMode=story&globals=grammarFamily:${family};grammarTheme:${mode}`)
                const note = await page.waitForFunction(() => (window as unknown as { __shoot: { done: boolean } }).__shoot.done, undefined, { timeout: 45000 })
                    .then(() => page.evaluate(() => (window as unknown as { __shoot: { note: string | null } }).__shoot.note))
                    .catch(() => "did not settle in 45 s")
                await page.waitForLoadState("networkidle").catch(() => undefined)
                const file = join(out, `${story.id}-${family}-${mode}-${width}.png`)
                await page.screenshot({ path: file, fullPage: true })
                shot += 1
                console.log(`${file}${note === null ? "" : `\n     note: ${note.split("\n")[0] ?? ""}`}`)
                await page.close()
            }
            await context.close()
        }
    }
} finally {
    await browser.close()
    server.kill()
}
console.log(`${String(shot)} picture(s) in ${out}: look at them`)
