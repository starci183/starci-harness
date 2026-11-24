/**
 * Standard tone tokens only (Grammar 0.55.0, owner 2026-11-22: "không dùng màu chuẩn soft và soft-surface ko vì thế chỉnh màu trò", then "alert nói
 * rõ là icon 24 soft-foreground trên nền soft thôi mà?"): every tone has `-soft` (HeroUI's, or Grammar's for info) and `-border` (Grammar's, one
 * derivation for every tone); no soft-surface step is left (it served only the Alert's tile); AA for the soft foreground on soft. Plus the one
 * tone-edge rule (SurfaceCard tone, MessageBubble content="card" tone), the small AI Chip, the quiet chosen RadioGroup row, the tile's AgentName,
 * Progress info, and no typed arrow in Grammar's own text.
 *
 *   node --import ./specs/support/register.mts --test specs/tone-tokens.spec.mts
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SurfaceCard } from "../src/core/frame/SurfaceCard/index.tsx"
import { MessageBubble } from "../src/core/composite/MessageBubble/index.tsx"
import { AgentName } from "../src/core/leaf/AgentName/index.tsx"
import { Progress } from "../src/core/leaf/Progress/index.tsx"
import { TONE_EDGES } from "../src/core/toneEdge.ts"
import { contrast, hexToLab, mixLab, oklchToLab, type Lab } from "./support/color.mts"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const TONES = ["default", "accent", "info", "success", "warning", "danger"] as const
type Tone = (typeof TONES)[number]

test("every tone has -border, one derivation each, in the lowest layer of the Common sheet; no soft-surface step is left", () => {
    const css = read("common/tones-border.css")
    assert.match(read("common/styles.css"), /@import "\.\/tones-border\.css";/)
    for (const tone of TONES) assert.match(css, new RegExp(`--${tone}-border: var\\(--${tone === "default" ? "border" : tone}\\);`, "u"), tone)
    const root = fileURLToPath(new URL("../src", import.meta.url))
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : /\.(css|tsx?)$/u.test(name) ? [path] : []
    })
    assert.deepEqual(walk(root).filter((file) => /-soft-surface/u.test(readFileSync(file, "utf8"))), [])
})

/** A value of core/theme.css (light, or dark over light), Grammar's info sheet, or HeroUI's soft formulas, as OKLab over the surface. */
const palette = (mode: "light" | "dark"): ((name: string) => Lab) => {
    const blocks = (css: string, opener: RegExp): Map<string, string> => {
        const start = opener.exec(css)?.index ?? -1
        assert.ok(start >= 0, String(opener))
        const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
        return new Map([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/gu)].map((match) => [match[1] ?? "", (match[2] ?? "").trim()]))
    }
    const theme = read("core/theme.css")
    const info = read("common/tones-info.css")
    const tokens = new Map([...blocks(theme, /:root,\s*\n\s*\.light/u), ...blocks(info, /:root,\s*\n\s*\.light/u)])
    if (mode === "dark") for (const [key, value] of [...blocks(theme, /\.dark,\s*\n\s*\[data-theme="dark"\]/u), ...blocks(info, /\.dark,\s*\n\s*\[data-theme="dark"\]/u)]) tokens.set(key, value)
    // HeroUI 3.2.6's own soft and soft-foreground formulas (@heroui/styles, the color-mix branch), light then dark; Core's theme overrides accent's.
    const SOFT: Record<Exclude<Tone, "info">, readonly [number, number]> = { default: [50, 50], accent: [15, 12], success: [15, 12], warning: [15, 12], danger: [15, 15] }
    const SOFT_FOREGROUND: Record<"success" | "warning" | "danger", readonly [readonly [number, number], readonly [number, number]]> = {
        success: [[80, 60], [80, 30]], warning: [[80, 70], [80, 30]], danger: [[70, 40], [80, 30]],
    }
    const resolve = (name: string): Lab => {
        const value = tokens.get(name)
        if (value !== undefined) {
            const reference = /^var\((--[a-z-]+)\)$/u.exec(value)
            if (reference !== null) return resolve(reference[1] ?? "")
            const oklch = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/u.exec(value)
            if (oklch !== null) return oklchToLab(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]))
            if (/^#[0-9a-f]{3,6}$/iu.test(value)) return hexToLab(value)
            const mix = /^color-mix\(in oklab, var\((--[a-z-]+)\) ([\d.]+)%, var\((--[a-z-]+)\)\)$/u.exec(value)
            if (mix !== null) return mixLab(resolve(mix[1] ?? ""), Number(mix[2]), resolve(mix[3] ?? ""), 100 - Number(mix[2]))
        }
        const soft = /^--([a-z]+)-soft$/u.exec(name)
        if (soft !== null) {
            const [light, dark] = SOFT[soft[1] as Exclude<Tone, "info">]
            const share = mode === "light" ? light : dark
            // a translucent tone over the surface it stands on
            return mixLab(resolve(`--${soft[1] ?? ""}`), share, resolve("--surface"), 100 - share)
        }
        const softForeground = /^--(success|warning|danger)-soft-foreground$/u.exec(name)
        if (softForeground !== null) {
            const [tone, fg] = SOFT_FOREGROUND[softForeground[1] as "success" | "warning" | "danger"][mode === "light" ? 0 : 1]
            return mixLab(resolve(`--${softForeground[1] ?? ""}`), tone, resolve("--foreground"), fg)
        }
        if (name === "--default-soft-foreground" || name === "--default-foreground") return resolve("--foreground")
        throw new Error(`no ${name} in ${mode}`)
    }
    return resolve
}

test("AA in both themes, every tone: the soft foreground on the soft (an Alert box, a tile, a Badge)", () => {
    for (const mode of ["light", "dark"] as const) {
        const token = palette(mode)
        for (const tone of TONES) {
            const onSoft = contrast(token(`--${tone}-soft-foreground`), token(`--${tone}-soft`))
            assert.ok(onSoft >= 4.5, `${mode} ${tone}: soft foreground on soft ${onSoft.toFixed(2)}:1`)
        }
    }
})

test("THE TONE EDGE: one rule, read by SurfaceCard tone and MessageBubble content=card tone; only the edge's colour, the fill and width stay the face's", () => {
    const css = read("common/styles.css")
    for (const tone of TONE_EDGES) {
        const token = tone === "neutral" ? "default" : tone
        assert.match(css, new RegExp(`\\[data-grammar-tone-edge="${tone}"\\] \\{ --grammar-tone-edge: var\\(--${token}-border\\); \\}`, "u"), tone)
    }
    assert.match(css, /\[data-grammar-tone-edge\] \{ border-color: var\(--grammar-tone-edge\) !important; \}/u)
    assert.doesNotMatch(css, /data-grammar-tone-edge[^{]*\{[^}]*(background|border-width|border:)/u, "the fill and the width stay the face's")
    assert.doesNotMatch(css, /data-grammar-surface-tone/u, "no second implementation")
    const card = renderToStaticMarkup(createElement(SurfaceCard, { label: "Chờ duyệt", tone: "warning", children: "x" }))
    assert.match(card, /class="[^"]*starci-core-surface[^"]*"[^>]*data-grammar-tone-edge="warning"|data-grammar-tone-edge="warning"[^>]*class="[^"]*starci-core-surface/u)
})

test("MessageBubble content=card takes tone: the card face (the bubble body) carries the tone edge; a text bubble's tone stays its outgoing face", () => {
    const bubble = renderToStaticMarkup(createElement(MessageBubble, { body: "Báo giá chờ duyệt", content: "card", tone: "warning" }))
    assert.match(bubble, /class="starci-core-message-bubble-body"[^>]*data-grammar-tone-edge="warning"/u)
    assert.match(bubble, /data-grammar-bubble-tone="brand"/u)
    for (const tone of TONE_EDGES) assert.match(renderToStaticMarkup(createElement(MessageBubble, { body: "x", content: "card", tone })), new RegExp(`data-grammar-tone-edge="${tone}"`, "u"), tone)
    const text = renderToStaticMarkup(createElement(MessageBubble, { body: "x", side: "outgoing", tone: "soft" }))
    assert.match(text, /data-grammar-bubble-tone="soft"/u)
    assert.doesNotMatch(text, /data-grammar-tone-edge/u)
    assert.doesNotMatch(renderToStaticMarkup(createElement(MessageBubble, { body: "x", content: "card" })), /data-grammar-tone-edge/u)
    // A text bubble takes the outgoing face, never an edge tone: its props do not admit one.
    type TextBubble = Extract<Parameters<typeof MessageBubble>[0], { readonly content?: "text" }>
    const edgeOnText: "warning" extends NonNullable<TextBubble["tone"]> ? true : false = false
    assert.equal(edgeOnText, false)
})

test("AgentName: the AI Chip is SMALL, the caption size in a 16px box on the name's baseline, never the 24px Badge pill", () => {
    const markup = renderToStaticMarkup(createElement(AgentName, { name: "Sales", isAgent: true }))
    assert.match(markup, /data-component="AgentName"[^>]*>Sales<[^]*data-component="Badge"/u)
    const css = read("common/components-navigation.css")
    const rule = /\.starci-core-agent-name > \[data-component="Badge"\]\[data-loading\] \{([^}]*)\}/u.exec(css)?.[1] ?? ""
    assert.match(rule, /block-size: var\(--grammar-type-caption-line\);/u)
    assert.match(rule, /font-size: var\(--grammar-type-caption-size\);/u)
    assert.match(rule, /line-height: var\(--grammar-type-caption-line\);/u)
    assert.match(css, /\.starci-core-agent-name \{[^}]*align-items: baseline;/u)
    const ramps = read("common/ramps.css")
    assert.match(ramps, /--grammar-type-caption-size: 0\.75rem;/u)
    assert.match(ramps, /--grammar-type-caption-line: 1rem;/u)
})

test("RadioGroup rows: the chosen row is quiet, its unselected edge coloured at most --accent-border", () => {
    const css = read("common/components-forms.css")
    const rule = /\[data-grammar-radio-appearance="rows"\] \.starci-core-radio\[data-selected="true"\] \{([^}]*)\}/u.exec(css)?.[1] ?? ""
    assert.match(rule, /border: var\(--starci-core-plate-border, 0\);/u)
    assert.match(rule, /border-color: var\(--accent-border\);/u)
    assert.doesNotMatch(rule, /--foreground|outline/u)
})

test("SurfaceCard kind=tile takes isAgent: the AgentName Chip follows the tile's name", () => {
    const tile = (isAgent: boolean) => renderToStaticMarkup(createElement(SurfaceCard, { kind: "tile", name: "Sales AI", isAgent, agentLabel: "AI" } as never))
    assert.match(tile(true), /data-component="AgentName"[^>]*>.*Sales AI.*data-component="Badge"/su)
    assert.doesNotMatch(tile(false), /data-component="AgentName"/u)
})

test("Progress takes tone=info: a built-in tone (not an app's custom), its fill --info", () => {
    const markup = renderToStaticMarkup(createElement(Progress, { label: "Đang đồng bộ", value: 40, tone: "info" }))
    assert.match(markup, /data-grammar-progress-tone="info"/u)
    assert.doesNotMatch(markup, /data-grammar-tone-custom="true"/u)
    assert.match(read("common/styles.css"), /\.starci-core-progress\[data-grammar-progress-tone="info"\] \{ --progress-bar-fill: var\(--info\);/u)
})

test("Grammar's own source and stories type no arrow character (U+2190-U+21FF, U+2794-U+27BF, U+27F0-U+27FF)", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url))
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|mdx?)$/u.test(name) ? [path] : []
    })
    const arrows = /[←-⇿➔-➿⟰-⟿]/u
    const found = walk(root).filter((file) => arrows.test(readFileSync(file, "utf8")))
    assert.deepEqual(found, [])
})
