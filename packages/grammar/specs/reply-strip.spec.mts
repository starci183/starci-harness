/**
 * ReplyStrip (Grammar 0.55.1): the message an answer replies to, one compact line at the top inside the answer's bubble. Its parts in order, no colon label and
 * no quotation marks, a button with the app's accessible name when pressable, the agent tone on the bar, caption size and a 3px bar in the sheet.
 *
 *   node --import ./specs/support/register.mts --test specs/reply-strip.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReplyStrip, type ReplyStripProps } from "../src/core/composite/ReplyStrip/index.tsx"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const strip = (props: Partial<ReplyStripProps> = {}): string =>
    renderToStaticMarkup(createElement(ReplyStrip, { author: "Lan Nguyễn", text: "chào em", label: "Trả lời tin của Lan Nguyễn: chào em", ...props }))

test("parts: the glyph, the author, then the words; no colon label, no quotation marks", () => {
    const html = strip()
    const glyph = html.indexOf("starci-core-reply-strip-glyph")
    const author = html.indexOf('starci-core-reply-strip-author">Lan Nguyễn<')
    const words = html.indexOf('starci-core-reply-strip-text">chào em<')
    assert.ok(glyph > -1 && author > glyph && words > author, html)
    assert.ok(!/[“”"]chào em[“”"]/.test(html.replace(/title="[^"]*"/, "")))
    assert.ok(!html.includes("Lan Nguyễn:<"))
    assert.ok(html.includes('aria-hidden="true"'), "the glyph is decorative")
    assert.ok(html.includes('width="1em"') && html.includes('height="1em"'), "the glyph is 1em of its text")
})

test("press: with onPress it is a button named by the app's label; without, a static group", () => {
    const button = strip({ onPress: () => undefined })
    assert.ok(/^<button[^>]*type="button"/.test(button))
    assert.ok(button.includes('aria-label="Trả lời tin của Lan Nguyễn: chào em"'))
    const still = strip()
    assert.ok(/^<div[^>]*role="group"/.test(still))
    assert.ok(!still.includes("<button"))
})

test("tone: the app's tone slot marks the strip and carries its ink for the bar; a person's is neutral", () => {
    const slotted = strip({ tone: { soft: "var(--app-soft)", ink: "var(--app-ink)" } })
    assert.ok(slotted.includes('data-tone="slot"') && /--grammar-tone-slot-ink:\s*var\(--app-ink\)/.test(slotted))
    assert.ok(!strip().includes("data-tone"))
    assert.ok(!strip({ tone: "neutral" }).includes("data-tone"))
})

test("sheet: caption size, the 3px edge token, the slot ink on the bar, ellipsized words, a focus ring", () => {
    const sheet = read("common/components-reply-strip.css")
    assert.ok(sheet.includes("font-size: var(--grammar-type-caption-size)"))
    assert.ok(sheet.includes("border-inline-start: var(--grammar-reply-edge) solid var(--starci-core-reply-strip-edge)"))
    assert.ok(/\[data-tone="slot"\] \{ --starci-core-reply-strip-edge: var\(--grammar-tone-slot-ink\); \}/.test(sheet))
    assert.ok(/\.starci-core-reply-strip-text \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/.test(sheet))
    assert.ok(/:focus-visible \{[^}]*outline: var\(--grammar-ring-width\) solid var\(--focus\)/.test(sheet))
    assert.ok(read("common/ramps.css").includes("--grammar-reply-edge: 3px;"))
    assert.ok(read("common/styles.css").includes('@import "./components-reply-strip.css";'))
})
