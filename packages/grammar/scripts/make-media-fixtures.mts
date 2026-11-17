// Generates the small local media fixtures of the media stories: a two-second WebM (a moving bar), its WebVTT captions, and the SVG
// pictures the Image and Illustration stories use. It needs Playwright's own ffmpeg (VP8 only), which `npx playwright install` carries.
// Run by hand when a fixture changes; the outputs are committed in src/stories/media, so no build step needs ffmpeg.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { chromium } from "@playwright/test"
import { join, resolve } from "node:path"

const out = resolve(import.meta.dirname, "..", "src", "stories", "media")
mkdirSync(out, { recursive: true })

const svg = (width: number, height: number, hue: number, label: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="hsl(${hue} 70% 88%)"/>` +
    `<circle cx="${Math.round(width * 0.72)}" cy="${Math.round(height * 0.38)}" r="${Math.round(Math.min(width, height) * 0.2)}" fill="hsl(${hue} 80% 70%)"/>` +
    `<rect x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.62)}" width="${Math.round(width * 0.46)}" height="${Math.round(height * 0.1)}" rx="${Math.round(height * 0.05)}" fill="hsl(${hue} 50% 40%)"/>` +
    `<text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.5)}" font-family="sans-serif" font-size="${Math.round(height * 0.11)}" fill="hsl(${hue} 50% 25%)">${label}</text></svg>\n`

writeFileSync(join(out, "photo-320.svg"), svg(320, 240, 210, "Photo 320"))
writeFileSync(join(out, "photo-960.svg"), svg(960, 720, 210, "Photo 960"))
writeFileSync(join(out, "photo-1920.svg"), svg(1920, 1440, 210, "Photo 1920"))
writeFileSync(join(out, "art-wide.svg"), svg(1680, 720, 330, "Wide crop"))
writeFileSync(join(out, "art-compact.svg"), svg(640, 800, 330, "Compact crop"))
writeFileSync(join(out, "art-square.svg"), svg(800, 800, 160, "Square art"))
writeFileSync(join(out, "poster.svg"), svg(640, 360, 270, "Poster"))
writeFileSync(join(out, "captions.vtt"), "WEBVTT\n\n00:00.000 --> 00:01.000\nThe bar starts at the left.\n\n00:01.000 --> 00:02.000\nThe bar reaches the right.\n")

const ffmpeg = join(homedir(), "AppData", "Local", "ms-playwright")
const folder = readdirSync(ffmpeg).filter((name) => name.startsWith("ffmpeg-")).sort().at(-1)
const binary = folder === undefined ? null : join(ffmpeg, folder, "ffmpeg-win64.exe")
if (binary === null || !existsSync(binary)) throw new Error("Playwright ffmpeg not found; run `npx playwright install`")

// Frames are JPEGs painted by the browser (the bundled ffmpeg reads only the image pipe Playwright itself feeds it).
const browser = await chromium.launch()
const page = await browser.newPage()
const jpegs = await page.evaluate(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 320
    canvas.height = 180
    const context = canvas.getContext("2d")
    if (context === null) throw new Error("no 2d context")
    return Array.from({ length: 20 }, (_, index) => {
        context.fillStyle = "#1e3c78"
        context.fillRect(0, 0, 320, 180)
        context.fillStyle = "#f0b446"
        context.fillRect(Math.round((index / 19) * 240), 70, 80, 40)
        return canvas.toDataURL("image/jpeg", 0.9).split(",")[1] ?? ""
    })
})
await browser.close()
execFileSync(binary, ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "10", "-i", "pipe:0", "-c:v", "libvpx", "-b:v", "150k", "-an", join(out, "clip.webm")], { input: Buffer.concat(jpegs.map((data) => Buffer.from(data, "base64"))) })
