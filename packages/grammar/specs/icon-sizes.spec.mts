/**
 * The icon size table (owner 2026-11-23, ramps.css). Text-sized: a caret, a breadcrumb separator and a status mark inside a line are 1em of the
 * text beside them (`--grammar-icon-text`, Icon `text`). Fixed: 16 in a 32 button (`--grammar-icon-xs`); 20 in a 40 button, beside text, in a chip,
 * badge or field and in a 40 tile (`--grammar-icon-sm`, Icon `chip`); 24 for a left navigation entry, a section or heading lead and in the 48 tile
 * of an empty state (`--grammar-icon-md`, Icon `heading`, `leading`). Every glyph size Grammar's own stylesheets set is one of those tokens (or
 * fills a control part's box).
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

/** A selector that sizes a glyph: an Icon, a status glyph, the inline status spinner or a caret slot. */
const GLYPH = /\.starci-core-(?:icon|status-glyph|inline-status-glyph|inline-status-spinner|disclosure-indicator|generic-accordion-indicator|select-indicator|tabs-more-caret|alert-chevron|schedule-group-chevron)(?![-\w])/
const SIZE_DECL = /(?:^|;)\s*(width|height|inline-size|block-size)\s*:\s*([^;]+)/g
const ALLOWED = new Set(["var(--grammar-icon-text)", "var(--grammar-icon-xs)", "var(--grammar-icon-sm)", "var(--grammar-icon-md)", "var(--grammar-empty-tile-size)", "100%"])

test("ramps.css holds the icon size tokens: text 1em, 16, 20, 24", () => {
    const ramps = read("common/ramps.css")
    assert.match(ramps, /--grammar-icon-text: 1em;/)
    assert.match(ramps, /--grammar-icon-xs: 1rem;/)
    assert.match(ramps, /--grammar-icon-sm: 1\.25rem;/)
    assert.match(ramps, /--grammar-icon-md: 1\.5rem;/)
    const tokens = [...ramps.matchAll(/(--grammar-icon-[\w-]+):/g)].map((m) => m[1])
    assert.deepEqual([...new Set(tokens)].sort(), ["--grammar-icon-md", "--grammar-icon-sm", "--grammar-icon-text", "--grammar-icon-xs"])
})

test("every glyph size in Grammar's stylesheets is one of the tokens", () => {
    const off: string[] = []
    for (const { file, css } of sheets()) {
        for (const { selector, body } of rules(css)) {
            if (!GLYPH.test(selector)) continue
            for (const m of body.matchAll(SIZE_DECL)) {
                const value = (m[2] ?? "").replace(/\s*!important/, "").trim()
                if (!ALLOWED.has(value)) off.push(`${file}: ${selector} { ${m[1] ?? ""}: ${value} }`)
            }
        }
    }
    assert.deepEqual(off, [])
})

test("the usage map: heading and leading 24, chip 20, text 1em; a 40 button, tile, logo, badge and icon button glyph 20, a 32 one 16", () => {
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-icon:is\(\[data-usage="heading"\], \[data-usage="leading"\]\) \{\s*width: var\(--grammar-icon-md\);\s*height: var\(--grammar-icon-md\);/)
    assert.match(css, /\.starci-core-icon\[data-usage="chip"\] \{\s*width: var\(--grammar-icon-sm\);\s*height: var\(--grammar-icon-sm\);/)
    assert.match(css, /:is\(\.starci-core-icon-button, \.starci-core-icon-tile, \.starci-core-logo-stack-logo, \[data-component="Badge"\]\) \.starci-core-icon \{\s*width: var\(--grammar-icon-sm\);/)
    assert.match(css, /\.starci-core-icon-button\[data-size="sm"\] \.starci-core-icon \{\s*width: var\(--grammar-icon-xs\);/)
    assert.match(css, /\.starci-core-button:is\(\[data-grammar-button-start="glyph"\], \[data-grammar-button-end="glyph"\]\) \.starci-core-icon \{\s*width: var\(--grammar-icon-sm\);/)
    assert.match(css, /\.starci-core-button\[data-size="sm"\]:is\(\[data-grammar-button-start="glyph"\], \[data-grammar-button-end="glyph"\]\) \.starci-core-icon \{\s*width: var\(--grammar-icon-xs\);/)
    for (const usage of ["heading", "leading", "chip", "text"] as const) {
        assert.match(renderToStaticMarkup(createElement(Icon, { source: CalendarIcon, usage })), new RegExp(`data-usage="${usage}"`))
    }
})

test("one text-sized rule sizes every caret, separator and inline status mark at 1em", () => {
    const css = read("common/styles.css").replace(/\/\*[\s\S]*?\*\//g, "")
    const rule = /:is\(([^{]*?)\)[^{]*\{\s*flex: none;\s*width: var\(--grammar-icon-text\) !important;\s*height: var\(--grammar-icon-text\) !important;/.exec(css)
    assert.ok(rule !== null, "the text-sized glyph rule")
    for (const part of ['.starci-core-icon[data-usage="text"]', ".starci-core-disclosure-indicator", ".starci-core-generic-accordion-indicator", ".starci-core-select-indicator", '[data-slot="submenu-indicator"]', ".starci-core-tabs-more-caret", ".starci-core-alert-chevron", ".starci-core-schedule-group-chevron", '[data-slot="breadcrumbs-separator"]', ".starci-core-inline-status .starci-core-inline-status-glyph"]) {
        assert.ok(rule[1]?.includes(part), `the text-sized rule names ${part}`)
    }
    assert.match(read("core/frame/Section/FigureCells.tsx"), /glyphSource\("chevron-end"\)\} usage="text"/)
    assert.match(read("core/composite/ListRow/index.tsx"), /glyphSource\("chevron-end"\)\} usage="text"/)
    assert.match(read("core/branch/Select/index.tsx"), /inlineGlyph\("chevron-down", \{\}, "text"\)/)
})

test("InlineStatus: the glyph is text-sized, its words' 1em; no size prop", () => {
    const css = read("common/styles.css")
    assert.doesNotMatch(css, /\.starci-core-inline-status :is\(\.starci-core-inline-status-glyph, \.starci-core-inline-status-spinner\) \{ width:/)
    assert.match(css, /:is\(\.starci-type-caption[^)]*\) \.starci-core-inline-status \{\s*font-size: inherit;/)
    const markup = renderToStaticMarkup(createElement(InlineStatus, { state: "done", label: "Xong" }))
    assert.doesNotMatch(markup, /data-size|style=/)
    assert.doesNotMatch(read("core/leaf/InlineStatus/index.tsx"), /readonly size\?/)
})

test("the empty state's tile is 48 with a 24 glyph", () => {
    const css = read("common/styles.css")
    assert.match(read("common/ramps.css"), /--grammar-empty-tile-size: 3rem;/)
    assert.match(css, /\.starci-core-empty-notice > \.starci-core-icon-tile \{\s*width: var\(--grammar-empty-tile-size\);/)
    assert.match(css, /\.starci-core-empty-notice > \.starci-core-icon-tile :is\(\.starci-core-icon, \.starci-core-status-glyph\) \{\s*width: var\(--grammar-icon-md\);/)
})
