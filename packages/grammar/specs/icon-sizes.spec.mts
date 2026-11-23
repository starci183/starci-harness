/**
 * The icon table (owner 2026-11-23, ramps.css "THE ICON TABLE"). Four roles, never pixels: `control` 16 (the one leading icon beside 14px
 * words, every labelled button, a field, a chip, a navigation entry; a status mark is that 14/16 pair), `row` 20 in the 40 tile (radius 10),
 * `head` 24 in the 48 tile (radius 12), `text` 1em of the words it trails (carets only). An icon-only 40 button is 20 (`--grammar-icon-alone`).
 * The stroke follows the weight of the text: every rule that sets a font weight sets `--grammar-icon-stroke`, and a text that carries an icon is
 * regular (400, stroke 1.5). Every glyph size Grammar's own stylesheets set is one of those tokens (or fills a control part's box).
 *
 *   node --import ./specs/support/register.mts --test specs/icon-sizes.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Icon } from "../src/core/leaf/Icon/index.tsx"
import { IconTile } from "../src/core/leaf/IconTile/index.tsx"
import { InlineStatus } from "../src/core/leaf/InlineStatus/index.tsx"
import { TablerCalendar } from "../src/core/leaf/Icon/tabler.tsx"

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
const ALLOWED = new Set(["var(--grammar-icon-text)", "var(--grammar-icon-control)", "var(--grammar-icon-alone)", "var(--grammar-icon-row)", "var(--grammar-icon-head)", "var(--grammar-tile-row-size)", "var(--grammar-tile-head-size)", "100%"])

test("ramps.css holds the icon table: text 1em, control 16, alone 20, row 20, head 24, the two tiles and the three strokes", () => {
    const ramps = read("common/ramps.css")
    for (const line of ["--grammar-icon-text: 1em;", "--grammar-icon-control: 1rem;", "--grammar-icon-alone: 1.25rem;", "--grammar-icon-row: 1.25rem;", "--grammar-icon-head: 1.5rem;", "--grammar-tile-row-size: 2.5rem;", "--grammar-tile-row-radius: 0.625rem;", "--grammar-tile-head-size: 3rem;", "--grammar-tile-head-radius: 0.75rem;", "--grammar-icon-stroke-regular: 1.5;", "--grammar-icon-stroke-medium: 1.75;", "--grammar-icon-stroke-semibold: 2;"]) {
        assert.ok(ramps.includes(line), line)
    }
    const sizes = [...ramps.matchAll(/(--grammar-icon-(?!stroke)[\w-]+):/g)].map((m) => m[1])
    assert.deepEqual([...new Set(sizes)].sort(), ["--grammar-icon-alone", "--grammar-icon-control", "--grammar-icon-head", "--grammar-icon-row", "--grammar-icon-text"])
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

test("the roles: control 16, row 20, head 24; a labelled button glyph 16 at every size, an icon-only 40 one 20, a 32 one 16", () => {
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-icon\[data-usage="control"\] \{\s*width: var\(--grammar-icon-control\);/)
    assert.match(css, /\.starci-core-icon\[data-usage="row"\] \{\s*width: var\(--grammar-icon-row\);/)
    assert.match(css, /\.starci-core-icon\[data-usage="head"\] \{\s*width: var\(--grammar-icon-head\);/)
    assert.match(css, /\.starci-core-button \.starci-core-icon \{\s*width: var\(--grammar-icon-control\);/)
    assert.match(css, /\.starci-core-icon-button \.starci-core-icon \{\s*width: var\(--grammar-icon-alone\);/)
    assert.match(css, /\.starci-core-icon-button\[data-size="sm"\] \.starci-core-icon \{\s*width: var\(--grammar-icon-control\);/)
    for (const usage of ["text", "control", "row", "head"] as const) {
        assert.match(renderToStaticMarkup(createElement(Icon, { source: TablerCalendar, usage })), new RegExp(`data-usage="${usage}"`))
    }
})

test("the tiles: row 40 at radius 10 with a 20 glyph (the default), head 48 at radius 12 with a 24 glyph; a status mark stays round", () => {
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-icon-tile \{[^}]*width: var\(--grammar-tile-row-size\);[^}]*border-radius: var\(--grammar-tile-row-radius\);/)
    assert.match(css, /\.starci-core-icon-tile\[data-size="head"\] \{[^}]*width: var\(--grammar-tile-head-size\);[^}]*border-radius: var\(--grammar-tile-head-radius\);/)
    assert.match(css, /\.starci-core-icon-tile\[data-grammar-mark="status"\] \{\s*border-radius: var\(--grammar-radius-pill\);/)
    assert.match(renderToStaticMarkup(createElement(IconTile, { source: TablerCalendar })), /data-size="row"[\s\S]*data-usage="row"/)
    assert.match(renderToStaticMarkup(createElement(IconTile, { source: TablerCalendar, size: "head" })), /data-size="head"[\s\S]*data-usage="head"/)
})

test("one text-sized rule sizes every caret, separator and status glyph at 1em", () => {
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

test("a leading icon is the 14/16 pair, one inline step apart, at regular weight; a status mark takes a 12px line's size", () => {
    const css = read("common/styles.css")
    assert.match(css, /:is\(\.starci-type-caption[^)]*\) \.starci-core-inline-status \{\s*font-size: inherit;/)
    assert.match(css, /\.starci-core-text:is\(:not\(\[data-role\]\), \[data-role="body"\], \[data-role="label\.item"\], \[data-role="label\.field"\]\):has\(> \.starci-core-icon\) \{\s*display: flex;\s*align-items: center;\s*gap: var\(--grammar-inline-gap\);/)
    assert.match(css, /\.starci-core-text > \.starci-core-icon \{\s*width: var\(--grammar-icon-control\);/)
    assert.match(css, /font-weight: var\(--grammar-weight-regular\) !important;\s*--grammar-icon-stroke: var\(--grammar-icon-stroke-regular\);/)
    const markup = renderToStaticMarkup(createElement(InlineStatus, { state: "done", label: "Xong" }))
    assert.doesNotMatch(markup, /data-size|style=/)
})

test("the stroke follows the weight: every rule that sets a font weight from a token sets --grammar-icon-stroke from the same value", () => {
    const off: string[] = []
    for (const { file, css } of sheets()) {
        for (const { selector, body } of rules(css)) {
            const weight = /font-weight:\s*(var\([^;!]+\))/.exec(body)
            if (weight === null) continue
            if (!body.includes("--grammar-icon-stroke")) off.push(`${file}: ${selector}`)
        }
    }
    assert.deepEqual(off, [])
    assert.match(read("common/styles.css"), /\.starci-core-icon :where\(path, circle, line, polyline, polygon, rect, ellipse\)/)
})

test("the empty state's tile is the head tile: 48 with a 24 glyph", () => {
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-empty-notice > \.starci-core-icon-tile \{\s*border-radius: var\(--grammar-tile-head-radius\);\s*width: var\(--grammar-tile-head-size\);/)
    assert.match(css, /\.starci-core-empty-notice > \.starci-core-icon-tile :is\(\.starci-core-icon, \.starci-core-status-glyph\) \{\s*width: var\(--grammar-icon-head\);/)
})
