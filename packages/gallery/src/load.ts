// Reads the gallery from the disk: gallery/pages (screen.yaml, or explain.md until a screen is migrated, links.json, the shots), gallery/flows.json, and the design canvas (`.starcistacks/canvas`: design.json,
// tokens.css, canvas.css and the fragments of pages/, skills/claude-design references/format.md). Nothing here is drawn; the plugin serves the result.
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { noteToMarkdown, SHOT_WIDTHS } from "./explain.ts"
import type { Width } from "./explain.ts"
import { frameFile } from "./frames.ts"
import type { RawFrame, RawGallery, RawScreen } from "./model.ts"

export interface LoadOptions {
    /** The gallery root (the Vite root). */
    readonly root: string
    /** The folder of the pages, relative to the root. */
    readonly pages: string
    /** The folder of the design canvas, relative to the root. */
    readonly canvas: string
}

/** One frame served as a page of its own: `<area>__<screen>__<width>.html`. */
export interface FrameDoc {
    readonly file: string
    readonly html: string
}

export interface Loaded {
    readonly raw: RawGallery
    /** The stylesheet every frame shares: the canvas tokens, the board and every fragment's own style. */
    readonly frameCss: string
    readonly frames: readonly FrameDoc[]
}

const read = (file: string): string | null => {
    try {
        return fs.readFileSync(file, "utf8")
    } catch {
        return null
    }
}
const readJson = (file: string): unknown => {
    const text = read(file)
    if (text === null) return undefined
    try {
        return JSON.parse(text) as unknown
    } catch {
        return undefined
    }
}
const dirs = (dir: string): string[] => {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
            .map((entry) => entry.name)
            .sort()
    } catch {
        return []
    }
}
const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex")

/** The element that opens at `start` (a `<tag`), up to its matching close tag, counting nested tags of the same name; null when it never closes. */
export function balanced(html: string, start: number, tag: string): string | null {
    const open = new RegExp(`<${tag}\\b|</${tag}>`, "giu")
    open.lastIndex = start
    let depth = 0
    for (let hit = open.exec(html); hit !== null; hit = open.exec(html)) {
        depth += hit[0].startsWith("</") ? -1 : 1
        if (depth === 0) return html.slice(start, hit.index + hit[0].length)
    }
    return null
}

interface Section {
    readonly pid: string
    readonly route: string | undefined
    readonly title: string | undefined
    readonly scr: Partial<Record<"1440" | "390", string>>
    readonly note: string | undefined
}

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`, "u").exec(tag)?.[1]

/** The screens of one fragment: each `<section class="page" data-pid=…>` with its 1440 and 390 frames (`.scr`) and its note. */
export function fragmentSections(html: string): Section[] {
    const sections: Section[] = []
    for (const open of html.matchAll(/<section\b[^>]*\bdata-pid="[^"]+"[^>]*>/gu)) {
        const body = balanced(html, open.index, "section") ?? ""
        const scr: Partial<Record<"1440" | "390", string>> = {}
        for (const frame of body.matchAll(/<div class="scr w(1440|390)\b[^"]*"/gu)) {
            const width = frame[1] as "1440" | "390"
            const element = balanced(body, frame.index, "div")
            if (element !== null) scr[width] = element
        }
        const noteStart = body.search(/<div class="note"/u)
        const note = noteStart < 0 ? undefined : (balanced(body, noteStart, "div") ?? undefined)
        sections.push({ pid: attr(open[0], "data-pid") ?? "", route: attr(open[0], "data-route"), title: attr(open[0], "data-title"), scr, note })
    }
    return sections
}

const heightOf = (element: string): number | undefined => {
    const px = /height:\s*(\d+(?:\.\d+)?)px/u.exec(/^<div[^>]*>/u.exec(element)?.[0] ?? "")?.[1]
    return px === undefined ? undefined : Number(px)
}

/** The sprites of a fragment (an `<svg>` that holds `<symbol>`s) and its `<style>` blocks. */
function sharedParts(html: string): { sprites: string[]; styles: string[] } {
    const sprites: string[] = []
    for (const open of html.matchAll(/<svg\b[^>]*>/gu)) {
        const element = balanced(html, open.index, "svg")
        if (element?.includes("<symbol") === true) sprites.push(element)
    }
    return { sprites, styles: [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map((style) => style[1] ?? "") }
}

/** The value of a screen.yaml text; undefined when it is not valid YAML (the screen then shows nothing of it; the gate reports the file). */
export function parseScreenYaml(text: string): unknown {
    try {
        return parseYaml(text, { version: "1.2", schema: "core", maxAliasCount: 0 }) ?? undefined
    } catch {
        return undefined
    }
}

export function loadGallery(options: LoadOptions): Loaded {
    const pagesDir = path.resolve(options.root, options.pages)
    const canvasDir = path.resolve(options.root, options.canvas)
    const design = readJson(path.join(canvasDir, "design.json"))
    const recorded = (id: string): Record<string, unknown> | null => {
        const pages = typeof design === "object" && design !== null ? (design as { pages?: unknown }).pages : undefined
        const entry = typeof pages === "object" && pages !== null ? (pages as Record<string, unknown>)[id] : undefined
        const shots = typeof entry === "object" && entry !== null ? (entry as { shots?: unknown }).shots : undefined
        return typeof shots === "object" && shots !== null ? (shots as Record<string, unknown>) : null
    }
    const screens: Record<string, RawScreen> = {}
    for (const area of dirs(pagesDir)) {
        for (const name of dirs(path.join(pagesDir, area))) {
            const dir = path.join(pagesDir, area, name)
            const id = `${area}/${name}`
            const shots = SHOT_WIDTHS.filter((width): width is Width => fs.existsSync(path.join(dir, `${width}.png`)))
            const sha = recorded(id)
            const compared = sha === null ? [] : (["1440", "390"] as const).filter((width) => shots.includes(width) && typeof sha[width] === "string")
            const yaml = read(path.join(dir, "screen.yaml"))
            const screen = yaml === null ? undefined : parseScreenYaml(yaml)
            // screen.yaml is the description; explain.md is read only while a screen has no screen.yaml (the transition).
            const explain = yaml === null ? read(path.join(dir, "explain.md")) : null
            const links = readJson(path.join(dir, "links.json"))
            screens[id] = {
                shots,
                ...(screen === undefined ? {} : { screen }),
                ...(explain === null ? {} : { explain }),
                ...(links === undefined ? {} : { links }),
                ...(compared.length === 0 || sha === null ? {} : { shotsMatchRecord: compared.every((width) => sha[width] === sha256(path.join(dir, `${width}.png`))) }),
            }
        }
    }

    const frames: Record<string, RawFrame> = {}
    const docs: { id: string; width: "1440" | "390"; element: string }[] = []
    const sprites = new Set<string>()
    const styles: string[] = []
    const fragmentDir = path.join(canvasDir, "pages")
    const fragments = ((): string[] => {
        try {
            return fs.readdirSync(fragmentDir).filter((name) => name.endsWith(".html")).sort()
        } catch {
            return []
        }
    })()
    for (const name of fragments) {
        const html = read(path.join(fragmentDir, name)) ?? ""
        const parts = sharedParts(html)
        for (const sprite of parts.sprites) sprites.add(sprite)
        styles.push(...parts.styles)
        for (const section of fragmentSections(html)) {
            const heights: Partial<Record<"1440" | "390", number>> = {}
            for (const width of ["1440", "390"] as const) {
                const element = section.scr[width]
                if (element === undefined) continue
                const height = heightOf(element)
                if (height !== undefined) heights[width] = height
                docs.push({ id: section.pid, width, element })
            }
            frames[section.pid] = {
                widths: (Object.keys(section.scr) as ("1440" | "390")[]),
                heights,
                ...(section.title === undefined ? {} : { title: section.title }),
                ...(section.route === undefined ? {} : { route: section.route }),
                ...(section.note === undefined ? {} : { noteMarkdown: noteToMarkdown(section.note) }),
            }
        }
    }
    const frameCss = [read(path.join(canvasDir, "tokens.css")) ?? "", read(path.join(canvasDir, "canvas.css")) ?? "", ...styles, "html,body{margin:0;background:#fff}"].join("\n")
    const sprite = [...sprites].join("\n")
    const frameDocs = docs.map(({ id, width, element }) => ({
        file: frameFile(id, width),
        // A frame is shown at real pixels by the viewer, which scales it: the board's `.zoom` (50%) would shrink it twice.
        html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="frames.css"></head><body>${sprite}${element.replace(/^(<div class=")([^"]*)"/u, (_all, head: string, classes: string) => `${head}${classes.split(/\s+/u).filter((one) => one !== "zoom").join(" ")}"`)}</body></html>`,
    }))
    const flows = readJson(path.join(options.root, "flows.json"))
    return { raw: { screens, frames, ...(flows === undefined ? {} : { flows }), ...(design === undefined ? {} : { design }) }, frameCss, frames: frameDocs }
}

/** The files the loader reads, for the watcher: the pages folder, the canvas folder and the flows file. */
export const watchedPaths = (options: LoadOptions): string[] => [path.resolve(options.root, options.pages), path.resolve(options.root, options.canvas), path.resolve(options.root, "flows.json")]
