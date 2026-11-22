/**
 * The two icon sizes (Grammar 0.55.0, owner 2026-11-22): 24px before 14px text, 20px in a chip or badge and before 12px text. Every glyph size
 * Grammar's own stylesheets set is one of the two tokens (or fills a control part's box); a Button's own glyph keeps the Button's scale.
 *
 *   node --import ./specs/support/register.mts --test specs/icon-sizes.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CalendarIcon } from "@heroicons/react/24/outline"
import { Icon } from "../src/core/leaf/Icon/index.tsx"
import { InlineStatus } from "../src/core/leaf/InlineStatus/index.tsx"

const SRC = new URL("../src/", import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, SRC), "utf8")
const sheets = (): { readonly file: string; readonly css: string }[] =>
    ["common/", "core/", "offset-pop/"].flatMap((dir) => readdirSync(new URL(dir, SRC)).filter((name) => name.endsWith(".css")).map((name) => ({ file: `${dir}${name}`, css: read(`${dir}${name}`) })))

/** Every innermost rule of a sheet, comments stripped. */
const rules = (css: string): { readonly selector: string; readonly body: string }[] =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" }))

/** A selector that sizes a glyph: an Icon, a status glyph or the inline status spinner. */
const GLYPH = /\.starci-core-(?:icon|status-glyph|inline-status-glyph|inline-status-spinner)(?![-\w])/
/** A Button's own glyph keeps the Button's scale (20 on a phone, 16 from 640px and on sm): the Button, the message rail's sm Buttons, the scroll arrows. */
const BUTTON_SCOPE = /\.starci-core-button\b|\.starci-core-message-actions\b|\.starci-horizontal-scroll-frame/
const SIZE_DECL = /(?:^|;)\s*(width|height|inline-size|block-size)\s*:\s*([^;]+)/g
const ALLOWED = new Set(["var(--grammar-icon-md)", "var(--grammar-icon-sm)", "100%"])

test("ramps.css holds exactly two icon size tokens, 24 and 20", () => {
    const ramps = read("common/ramps.css")
    assert.match(ramps, /--grammar-icon-md: 1\.5rem;/)
    assert.match(ramps, /--grammar-icon-sm: 1\.25rem;/)
    const tokens = [...ramps.matchAll(/(--grammar-icon-[\w-]+):/g)].map((m) => m[1])
    assert.deepEqual([...new Set(tokens)].sort(), ["--grammar-icon-md", "--grammar-icon-sm"])
})

test("every glyph size in Grammar's stylesheets is one of the two tokens, outside a Button's own scale", () => {
    const off: string[] = []
    for (const { file, css } of sheets()) {
        for (const { selector, body } of rules(css)) {
            if (!GLYPH.test(selector) || BUTTON_SCOPE.test(selector)) continue
            for (const m of body.matchAll(SIZE_DECL)) {
                const value = (m[2] ?? "").replace(/\s*!important/, "").trim()
                if (!ALLOWED.has(value)) off.push(`${file}: ${selector} { ${m[1] ?? ""}: ${value} }`)
            }
        }
    }
    assert.deepEqual(off, [])
})

test("the usage map: heading and leading are 24, chip is 20; a tile, logo, badge and icon button glyph is 20", () => {
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-icon:is\(\[data-usage="heading"\], \[data-usage="leading"\]\) \{\s*width: var\(--grammar-icon-md\);\s*height: var\(--grammar-icon-md\);/)
    assert.match(css, /\.starci-core-icon\[data-usage="chip"\] \{\s*width: var\(--grammar-icon-sm\);\s*height: var\(--grammar-icon-sm\);/)
    assert.match(css, /:is\(\.starci-core-icon-button, \.starci-core-icon-tile, \.starci-core-logo-stack-logo, \[data-component="Badge"\]\) \.starci-core-icon \{\s*width: var\(--grammar-icon-sm\);/)
    for (const usage of ["heading", "leading", "chip"] as const) {
        assert.match(renderToStaticMarkup(createElement(Icon, { source: CalendarIcon, usage })), new RegExp(`data-usage="${usage}"`))
    }
})

test("InlineStatus: the glyph follows the text beside it, 24 by its own 14px words, 20 in a 12px line; no size prop", () => {
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-inline-status :is\(\.starci-core-inline-status-glyph, \.starci-core-inline-status-spinner\) \{ width: var\(--grammar-icon-md\); height: var\(--grammar-icon-md\);/)
    const small = /:is\(\.starci-type-caption, \.starci-type-label-group, \.starci-type-badge, \.starci-type-code, \[data-component="Badge"\]\) \.starci-core-inline-status :is\(\.starci-core-inline-status-glyph, \.starci-core-inline-status-spinner\) \{ width: var\(--grammar-icon-sm\); height: var\(--grammar-icon-sm\); \}/
    assert.match(css, small)
    assert.match(css, /:is\(\.starci-type-caption[^)]*\) \.starci-core-inline-status \{\s*font-size: inherit;/)
    const markup = renderToStaticMarkup(createElement(InlineStatus, { state: "done", label: "Xong" }))
    assert.doesNotMatch(markup, /data-size|style=/)
    assert.doesNotMatch(read("core/leaf/InlineStatus/index.tsx"), /readonly size\?/)
})
