/**
 * Alert actions take the banner's tone (Grammar 0.55.1, owner 2026-11-23, "Chốt, làm luôn"): a button inside a tinted notice has a fill one step stronger than
 * the notice's soft background, the tone's strong text colour, the button label weight (500) and Grammar's pill. No white or neutral button on a tinted
 * banner; several equal actions (`actions`) and none primary; a destructive action stays danger. Every Button label is 500.
 *
 *   node --import ./specs/support/register.mts --test specs/alert-actions.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Alert, type AlertProps } from "../src/core/composite/Alert/index.tsx"
import { Button } from "../src/core/leaf/Button/index.tsx"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const render = (props: AlertProps): string => renderToStaticMarkup(createElement(Alert, props))
/** Every Grammar Button of a markup (a command is a <button>, a destination an <a>). */
const buttons = (markup: string): string[] => markup.match(/<(?:button|a)[^>]*data-component="Button"[^>]*>/gu) ?? []
const noop = (): void => undefined
const TONES = ["informative", "accent", "affirmative", "cautionary", "negative", "neutral", "pending", "unavailable"] as const

test("every action of a banner, in every tone, is the border rank: none is primary, none wears a solid tone", () => {
    for (const tone of TONES) {
        const one = render({ tone, title: "T", action: { label: "Làm", onAction: noop }, secondaryAction: { label: "Sau", onAction: noop } })
        assert.equal(buttons(one).length, 2, tone)
        assert.ok(buttons(one).every((b) => /data-grammar-variant="border"/u.test(b)), `${tone}: border rank`)
        assert.doesNotMatch(one, /data-grammar-variant="primary"|data-grammar-button-tone/u, `${tone}: no primary, no solid tone`)
    }
})

test("several equal actions: each a tinted button in order, none primary; a destination is an anchor, a command a button", () => {
    const markup = render({
        tone: "informative",
        title: "Phòng này chưa có agent nào",
        actions: [{ label: "Nhắn Quảng cáo", href: "/office/ads" }, { label: "Nhắn Chăm sóc khách", href: "/office/care" }, { label: "Nhắn Mạng xã hội", onAction: noop }],
    })
    const found = buttons(markup)
    assert.equal(found.length, 3)
    assert.ok(found.every((b) => /data-grammar-variant="border"/u.test(b)), "none is primary")
    assert.match(found[0] ?? "", /^<a[^>]*href="\/office\/ads"/u)
    assert.match(found[1] ?? "", /^<a[^>]*href="\/office\/care"/u)
    assert.match(found[2] ?? "", /^<button/u)
    const order = ["Nhắn Quảng cáo", "Nhắn Chăm sóc khách", "Nhắn Mạng xã hội"].map((label) => markup.indexOf(label))
    assert.deepEqual([...order].sort((a, b) => a - b), order, "in the order given")
    assert.match(markup, /data-grammar-alert-actions="true"/u, "they stand in the actions slot")
})

test("actions beside action or secondaryAction is a development error", () => {
    assert.throws(() => render({ title: "T", actions: [{ label: "A", onAction: noop }], action: { label: "B", onAction: noop } } as never), /cannot stand beside/u)
})

test("a destructive action stays danger in every tone; a loading banner keeps its actions as border skeletons", () => {
    for (const tone of ["negative", "cautionary", "informative"] as const) {
        const markup = render({ tone, title: "T", action: { label: "Xoá", onAction: noop, isDestructive: true } })
        assert.equal(buttons(markup).filter((b) => /data-grammar-variant="danger"/u.test(b)).length, 1, tone)
    }
    const loading = render({ tone: "cautionary", title: "T", isLoading: true, actions: [{ label: "A", onAction: noop }, { label: "B", onAction: noop }] })
    assert.ok(buttons(loading).every((b) => /data-grammar-variant="border"/u.test(b) && /data-loading="true"/u.test(b)))
})

test("the stylesheet paints every Button in a banner with the banner's tint: one step over the soft fill, the tone's ink, weight 500, through tokens only", () => {
    const css = read("common/styles.css") + read("common/components-overlays.css")
    const overlays = read("common/components-overlays.css")
    assert.match(overlays, /--starci-core-alert-action: color-mix\(in oklab, var\(--starci-core-alert-ink\) 10%, transparent\);/u)
    assert.match(overlays, /--starci-core-alert-action-hover: color-mix\(in oklab, var\(--starci-core-alert-ink\) 16%, transparent\);/u)
    const rule = /\.starci-core-alert:not\(\[data-loading="true"\]\) \.starci-core-button:not\(\[data-grammar-variant="danger"\], \[data-grammar-button-ground\], \[data-loading="true"\]\) \{([^}]*)\}/u.exec(overlays)?.[1] ?? ""
    assert.match(rule, /border-color: transparent !important;/u)
    assert.match(rule, /background: var\(--starci-core-alert-action\) !important;/u)
    assert.match(rule, /color: var\(--starci-core-alert-ink\) !important;/u)
    assert.match(rule, /font-weight: var\(--grammar-type-label-item-weight\);/u)
    assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgb\(|oklch\(/iu, "no raw colour")
    assert.doesNotMatch(overlays, /\[data-grammar-tone="negative"\] \.starci-core-alert-actions > \[data-component="Button"\]\[data-grammar-variant="border"\] \{\s*border-color: var\(--danger\)/u, "the old white outline with a danger edge is gone")
    // the ink the tint is made of is the tone's soft foreground, in every built-in tone (light and dark come from the tokens themselves)
    for (const [tone, token] of [["informative", "info"], ["accent", "accent"], ["affirmative", "success"], ["cautionary", "warning"], ["negative", "danger"]] as const) {
        assert.match(overlays, new RegExp(`\\.starci-core-alert\\[data-grammar-tone="${tone}"\\] \\{[^}]*--starci-core-alert-ink: var\\((?:--informative-soft-foreground, )?var\\(--${token}-soft-foreground\\)|\\.starci-core-alert\\[data-grammar-tone="${tone}"\\] \\{[^}]*--starci-core-alert-ink: var\\(--${token}-soft-foreground\\)`, "u"), tone)
    }
    assert.match(css, /\.starci-core-button \{ font-weight: var\(--grammar-type-label-item-weight\); \}/u, "every Button label is 500, stated by Grammar")
})

test("a Button an app writes into the banner's copy is a Grammar button the tint rule reaches", () => {
    const markup = render({ tone: "informative", title: "T", description: createElement(Button, { variant: "border", href: "/x", children: "Mở" }) })
    assert.match(markup, /class="[^"]*starci-core-alert[^"]*"[\s\S]*class="[^"]*starci-core-button/u)
})
