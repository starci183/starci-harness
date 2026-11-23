/**
 * The code palette (Grammar 0.55.1, owner 2026-11-23: "Chốt, làm luôn"): code has its own light and dark colours, brand-independent, no red but
 * `deleted`, every ink at WCAG AA 4.5:1 on the ground and on each line tint, and every code surface reads it instead of a status tone or a grey wash.
 *
 *   node --import ./specs/support/register.mts --test specs/code-palette.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { contrast, hexToLab, type Lab } from "./support/color.mts"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const css = read("common/tones-code.css")

const INKS = ["fg", "gutter", "keyword", "function", "string", "number", "constant", "type", "comment", "punctuation", "inserted", "deleted"] as const
const GROUNDS = ["bg", "highlight-line", "inserted-bg", "deleted-bg"] as const
const OTHERS = ["border", "highlight-edge"] as const

/** The `--grammar-code-*` values (hex) of one block of the sheet. */
const block = (selector: RegExp): Record<string, string> => {
    const body = selector.exec(css)?.[1] ?? ""
    return Object.fromEntries([...body.matchAll(/--grammar-code-([a-z-]+): (#[0-9a-f]{6});/gu)].map((match) => [match[1] ?? "", match[2] ?? ""]))
}
const THEMES = [
    ["light", block(/:root,[^{]*\{([^}]*)\}/u)],
    ["dark", block(/\.dark,[^{]*\{([^}]*)\}/u)],
] as const

const hueOf = ([, a, b]: Lab): number => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
const chromaOf = ([, a, b]: Lab): number => Math.hypot(a, b)

test("Grammar ships the code palette in light and dark, in the theme layer, from the Common sheet every family imports", () => {
    assert.match(read("common/styles.css"), /@import "\.\/tones-code\.css";/u)
    assert.match(css, /@layer starci-grammar-theme \{/u)
    const expected = [...INKS, ...GROUNDS, ...OTHERS].sort()
    for (const [name, theme] of THEMES) assert.deepEqual(Object.keys(theme).sort(), expected, name)
})

test("the palette is brand-independent: every value is its own colour, none reads a token", () => {
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//gu, ""), /var\(/u)
})

test("every ink reaches AA 4.5:1 on the code ground and on each line tint, in both themes", () => {
    for (const [name, theme] of THEMES) {
        for (const ink of INKS) {
            for (const ground of GROUNDS) {
                const ratio = contrast(hexToLab(theme[ink] ?? ""), hexToLab(theme[ground] ?? ""))
                assert.ok(ratio >= 4.5, `${name}: ${ink} on ${ground} is ${ratio.toFixed(2)}:1`)
            }
        }
    }
})

test("no ink is red but deleted, and deleted is red", () => {
    const isRed = (lab: Lab): boolean => chromaOf(lab) > 0.06 && (hueOf(lab) < 33 || hueOf(lab) > 345)
    for (const [name, theme] of THEMES) {
        for (const ink of INKS.filter((one) => one !== "deleted")) assert.ok(!isRed(hexToLab(theme[ink] ?? "")), `${name}: ${ink} (${theme[ink] ?? ""}) is red`)
        assert.ok(isRed(hexToLab(theme.deleted ?? "")), `${name}: deleted is red`)
    }
})

test("the Shiki variables and every code surface read the code palette, never a status tone, the brand or a grey wash", () => {
    const markdown = read("core/ext/markdown/styles.css")
    for (const match of markdown.matchAll(/(--shiki-[a-z-]+): ([^;]+);/gu)) {
        const value = match[2] ?? ""
        assert.ok(value === "transparent" || /^var\(--grammar-code-[a-z-]+\)$/u.test(value), `${match[1] ?? ""}: ${value}`)
    }
    assert.match(markdown, /\.starci-md-line\[data-highlighted="true"\] \{ background: var\(--grammar-code-highlight-line\);/u)
    assert.match(markdown, /\.starci-md-line\[data-sign="add"\] \{ background: var\(--grammar-code-inserted-bg\); \}/u)
    assert.match(markdown, /\.starci-md-line\[data-sign="remove"\] \{ background: var\(--grammar-code-deleted-bg\); \}/u)
    const common = read("common/styles.css")
    const lesson = read("common/components-lesson.css")
    assert.doesNotMatch(lesson, /--code-surface/u)
    assert.match(common, /\.starci-core-fenced-code-block pre \{[^}]*background: var\(--grammar-code-bg\);[^}]*color: var\(--grammar-code-fg\);/u)
    assert.match(common, /\[data-grammar-fenced-code-highlight="true"\] \{[^}]*background: var\(--grammar-code-bg\);/u)
    assert.match(common, /\.starci-core-markdown-article :not\(pre\) > code \{[^}]*background: var\(--grammar-code-bg\);/u)
    assert.match(common, /\.starci-core-code-line\[data-grammar-line-highlighted="true"\] \{\s*background: var\(--grammar-code-highlight-line\);/u)
    assert.match(lesson, /\.starci-core-code-block-code \{[^}]*background: var\(--grammar-code-bg\);[^}]*color: var\(--grammar-code-fg\);/u)
})
