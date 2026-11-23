/**
 * Bars follow HeroUI ProgressBar sizes (owner 2026-11-23, "= size progress của heroui cả"): every bar-like data mark (Meter and its
 * segments, Progress steps, ProportionBar, a FunnelChart stage) is the vendor's track, sm 4px, md 8px, lg 12px, at the vendor's corner
 * for that size and never a pill, through the `--grammar-bar-*` tokens of ramps.css "BARS". The FunnelChart draws each stage as
 * "label · count" with the step into it (a down arrow icon, never a typed arrow, and "60%") over such a track, the largest drop in the danger ink.
 *
 *   node --import ./specs/support/register.mts --test specs/bar-sizes.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { FunnelChart, type FunnelChartStage } from "../src/core/composite/FunnelChart/index.tsx"
import { ProportionBar } from "../src/core/composite/ProportionBar/index.tsx"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const ruleOf = (css: string, selector: string): string => {
    const at = css.indexOf(`${selector} {`)
    assert.ok(at >= 0, `no rule for ${selector}`)
    return css.slice(at, css.indexOf("}", at))
}

test("the bar tokens are HeroUI ProgressBar's steps of --spacing and --radius", () => {
    const ramps = read("common/ramps.css")
    assert.match(ramps, /--grammar-bar-sm: calc\(var\(--spacing\) \* 1\);/)
    assert.match(ramps, /--grammar-bar-md: calc\(var\(--spacing\) \* 2\);/)
    assert.match(ramps, /--grammar-bar-lg: calc\(var\(--spacing\) \* 3\);/)
    assert.match(ramps, /--grammar-bar-radius-sm: calc\(var\(--radius\) \* 0\.25\);/)
    assert.match(ramps, /--grammar-bar-radius-md: calc\(var\(--radius\) \* 0\.5\);/)
    assert.match(ramps, /--grammar-bar-radius-lg: calc\(var\(--radius\) \* 0\.75\);/)
})

test("every bar reads the bar tokens, never a height of its own or a pill", () => {
    const styles = read("common/styles.css")
    const overlays = read("common/components-overlays.css")
    const funnel = read("common/components-funnel-chart.css")
    const bars: readonly [string, string][] = [
        [styles, ".starci-core-proportion-track"],
        [styles, ".starci-core-progress-step"],
        [overlays, ".starci-core-meter-skeleton-bar"],
        [overlays, ".starci-core-meter-segments"],
        [funnel, ".starci-core-funnel-track"],
    ]
    for (const [css, selector] of bars) {
        const rule = ruleOf(css, selector)
        assert.match(rule, /(?:block-size|height): var\(--grammar-bar-(?:sm|md)\)/, `${selector} height`)
        assert.match(rule, /border-radius: var\(--grammar-bar-radius-(?:sm|md)\)/, `${selector} corner`)
        assert.doesNotMatch(rule, /radius-pill/, `${selector} is no pill`)
    }
})

test("a ProportionBar is md by default and takes sm and lg", () => {
    const parts = [{ id: "a", label: "A", value: 2 }, { id: "b", label: "B", value: 1 }]
    assert.match(renderToStaticMarkup(createElement(ProportionBar, { label: "Parts", parts, empty: "None" })), /data-size="md"/)
    assert.match(renderToStaticMarkup(createElement(ProportionBar, { label: "Parts", parts, empty: "None", size: "sm" })), /data-size="sm"/)
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-proportion-bar\[data-size="lg"\] \.starci-core-proportion-track \{ block-size: var\(--grammar-bar-lg\); border-radius: var\(--grammar-bar-radius-lg\); \}/)
})

const stages: readonly FunnelChartStage[] = [
    { label: "New", count: 10 },
    { label: "Talking", count: 6 },
    { label: "Booked", count: 2, value: "20%" },
    { label: "Won", count: 2, tone: "success" },
]
/** The words of each step, its icon left out. */
const stepTexts = (html: string): string[] =>
    [...html.replace(/<span class="starci-core-funnel-step-mark"[^]*?<\/svg><\/span>/g, "").matchAll(/class="starci-core-funnel-step"[^>]*>([^<]*)</g)].map((match) => match[1] ?? "")
const funnel = (props: Partial<Parameters<typeof FunnelChart>[0]> = {}): string =>
    renderToStaticMarkup(createElement(FunnelChart, { label: "Leads by stage", stages, empty: "Nothing yet", ...props }))

test("a funnel stage reads label · count over its track, the step into it as the arrow icon and its rate", () => {
    const html = funnel()
    assert.match(html, /<ol class="starci-core-funnel-stages" aria-label="Leads by stage">/)
    assert.equal(html.match(/<li /g)?.length, 4)
    assert.match(html, /New<span class="starci-core-funnel-count"> · 10<\/span>/)
    assert.match(html, /Talking<span class="starci-core-funnel-count"> · 6<\/span>/)
    assert.deepEqual(stepTexts(html), ["60%", "33.3%", "100%"])
    assert.equal(html.match(/class="starci-core-funnel-step-mark" aria-hidden="true"><svg/g)?.length, 3)
    assert.match(html, /--starci-core-funnel-share:100%/)
    assert.match(html, /--starci-core-funnel-share:60%/)
    assert.match(html, /--starci-core-funnel-share:20%/)
    assert.match(html, /class="starci-core-funnel-value">20%</)
    assert.match(html, /class="starci-core-funnel-track" aria-hidden="true"/)
})

test("only the step that lost the largest share is marked, in the danger ink", () => {
    const html = funnel()
    assert.deepEqual([...html.matchAll(/data-grammar-drop="(\w+)"/g)].map((match) => match[1]), ["lost", "largest", "kept"])
    assert.match(read("common/components-funnel-chart.css"), /\.starci-core-funnel-step\[data-grammar-drop="largest"\] \{ color: var\(--danger\);/)
    const flat = funnel({ stages: [{ label: "A", count: 4 }, { label: "B", count: 4 }] })
    assert.doesNotMatch(flat, /data-grammar-drop="largest"/)
})

test("no stages, or every stage at zero, is the empty state; a step after zero reads a dash", () => {
    assert.equal(funnel({ stages: [] }), "Nothing yet")
    assert.equal(funnel({ stages: [{ label: "A", count: 0 }, { label: "B", count: 0 }] }), "Nothing yet")
    const afterZero = funnel({ stages: [{ label: "A", count: 3 }, { label: "B", count: 0 }, { label: "C", count: 0 }] })
    assert.deepEqual(stepTexts(afterZero), ["0%", "–"])
})

test("a written step replaces the rate; loading keeps the labels and draws no count", () => {
    assert.match(funnel({ stages: [{ label: "A", count: 3 }, { label: "B", count: 1, stepLabel: "2 left" }] }), /data-grammar-drop="largest">.*?<\/svg><\/span>2 left</)
    const loading = funnel({ isLoading: true })
    assert.match(loading, /data-loading="true"/)
    assert.match(loading, /aria-busy="true"/)
    assert.match(loading, />Talking</)
    assert.doesNotMatch(loading, /starci-core-funnel-count/)
})
