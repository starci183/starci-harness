/**
 * The status-mark rule (Grammar 0.55.0, owner "chốt") and EntitySummaryCard: every IconTile is round; a standalone status mark (B) is the 40px tile whose
 * plate tone is the state; what it carries follows the reader's question (case 1 the status glyph, case 2 the subject icon); an inline status (A) is a
 * bare glyph and its words with no plate. Timeline, Stepper, the setup checklist and the all-clear follow it;
 * the Alert does NOT (owner: "alert nói rõ là icon 24 soft-foreground trên nền soft thôi mà?"): its mark is the bare 24px Heroicon.
 *
 *   node --import ./specs/support/register.mts --test specs/status-marks.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { IconTile } from "../src/core/leaf/IconTile/index.tsx"
import { InlineStatus } from "../src/core/leaf/InlineStatus/index.tsx"
import { BareCircleIcon, CircleIcon, MARK_STATES, MARK_STATE_TONE, STATUS_GLYPH } from "../src/core/statusMark.tsx"
import { Timeline, timelineMarkState } from "../src/core/composite/Timeline/index.tsx"
import { Stepper, stepperMarkState } from "../src/core/composite/Stepper/index.tsx"
import { EmptyNotice } from "../src/core/composite/EmptyNotice/index.tsx"
import { Alert } from "../src/core/composite/Alert/index.tsx"
import { EntitySummaryCard, type EntitySummaryCardProps } from "../src/core/frame/EntitySummaryCard/index.tsx"
import { TablerCheck, TablerCircleCheck, TablerCircleX, TablerMessages, TablerX } from "../src/core/leaf/Icon/tabler.tsx"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)
const count = (markup: string, pattern: RegExp): number => [...markup.matchAll(pattern)].length

test("an IconTile is the row tile (40, radius 10) or the head tile (48, radius 12); a status mark stays the round 40", () => {
    const css = read("common/styles.css")
    assert.match(css, /\.starci-core-icon-tile \{[^}]*width: var\(--grammar-tile-row-size\);[^}]*border-radius: var\(--grammar-tile-row-radius\)/u)
    assert.match(css, /\.starci-core-icon-tile\[data-grammar-mark="status"\] \{\s*border-radius: var\(--grammar-radius-pill\);/u)
})

test("the status map holds only these three (owner 2026-11-22): circle-check done, circle-x error, the plain circle waiting, skipped and not run; the tile carries their bare equivalents", () => {
    assert.deepEqual({ ...STATUS_GLYPH.inline }, { done: TablerCircleCheck, error: TablerCircleX, waiting: CircleIcon, skipped: CircleIcon, notRun: CircleIcon })
    assert.deepEqual({ ...STATUS_GLYPH.tile }, { done: TablerCheck, error: TablerX, waiting: BareCircleIcon, skipped: BareCircleIcon, notRun: BareCircleIcon })
    assert.equal(new Set(Object.values(STATUS_GLYPH.inline)).size, 3, "three inline glyphs")
    assert.equal(new Set(Object.values(STATUS_GLYPH.tile)).size, 3, "three tile glyphs")
    for (const glyph of [CircleIcon, BareCircleIcon]) assert.doesNotMatch(render(createElement(glyph)), /stroke-dasharray/u, "the circle is plain, never dashed")
    const source = read("core/statusMark.tsx")
    assert.doesNotMatch(source, /Pause|Minus|Clock|Information|Dashed/u, "no pause, minus, clock, info or dashed glyph is a status")
    // running is the same circle as a spinning ring, inline and in the tile
    const inlineRunning = render(createElement(InlineStatus, { state: "running", label: "Đang chạy" }))
    assert.match(inlineRunning, /starci-core-status-spin/)
    assert.equal(count(inlineRunning, /<circle[^>]*r="9"/gu), 2, "a faint track and its arc")
    assert.match(render(createElement(IconTile, { state: "running" })), /starci-core-status-spin/)
    assert.match(read("common/styles.css"), /@media \(prefers-reduced-motion: reduce\) \{\s*\.starci-core-status-spin \{ animation: none; \}/u)
    assert.match(render(createElement(IconTile, { state: "done" })), /data-grammar-status-glyph="done"/)
    assert.match(render(createElement(InlineStatus, { state: "error", label: "Lỗi" })), /data-grammar-status-glyph="error"/)
})

test("the plate tone of a state is fixed: done success, running info, waiting warning, error danger, skipped and notRun neutral", () => {
    assert.deepEqual({ ...MARK_STATE_TONE }, { done: "success", running: "info", waiting: "warning", error: "danger", skipped: "neutral", notRun: "neutral" })
})

test("case 1: IconTile state with no subject is the 40px tile carrying the STATUS glyph in the state's tone", () => {
    for (const state of MARK_STATES) {
        const markup = render(createElement(IconTile, { state }))
        assert.match(markup, /data-grammar-mark="status"/)
        assert.doesNotMatch(markup, /data-size/, `${state}: one plate, no size`)
        assert.match(markup, new RegExp(`data-tone="${MARK_STATE_TONE[state]}"`))
        assert.match(markup, /data-grammar-mark-subject="false"/)
        if (state === "running") assert.match(markup, /starci-core-status-spinner/)
        else assert.match(markup, new RegExp(`data-grammar-status-glyph="${state}"`))
    }
})

test("case 2: IconTile state with a subject carries the SUBJECT icon on the state's plate, a running subject wears the ring", () => {
    const done = render(createElement(IconTile, { source: TablerMessages, state: "done" }))
    assert.match(done, /data-grammar-mark-subject="true"/)
    assert.doesNotMatch(done, /data-grammar-status-glyph/)
    assert.doesNotMatch(done, /data-grammar-mark-ring/)
    assert.match(render(createElement(IconTile, { source: TablerMessages, state: "running" })), /data-grammar-mark-ring="true"/)
    // an identity tile is unchanged: no status attributes
    assert.doesNotMatch(render(createElement(IconTile, { source: TablerMessages, tone: "info" })), /data-grammar-mark/)
})

test("(A) InlineStatus: a bare glyph and its words in the state's tone, the meta trailing, no plate in its rule", () => {
    const markup = render(createElement(InlineStatus, { state: "waiting", label: "Chờ bạn duyệt", meta: "5 phút" }))
    assert.match(markup, /data-tone="warning"/)
    assert.match(markup, /data-grammar-status-glyph="waiting"[^>]*>.*Chờ bạn duyệt.*5 phút/su)
    const rule = /\.starci-core-inline-status \{([^}]*)\}/u.exec(read("common/styles.css"))?.[1] ?? ""
    assert.doesNotMatch(rule, /background/)
    assert.doesNotMatch(render(createElement(InlineStatus, { state: "done", label: "Xong", isLoading: true })), /Xong/, "loading is all skeleton")
})

test("Timeline: every marker is the 40px status tile, its glyph the status; the 0.48.0 dot rule and the marker prop are gone", () => {
    const markup = render(createElement(Timeline, { label: "Các bước", items: [
        { id: "a", title: "Đọc", status: "done" },
        { id: "b", title: "Soạn", status: "running", isCurrent: true },
        { id: "c", title: "Gửi", state: "negative" },
        { id: "d", title: "Nhắc", status: "notRun" },
    ] }))
    assert.equal(count(markup, /data-grammar-mark="status"/g), 4)
    assert.match(markup, /data-grammar-mark-state="error"/, "a negative state is the error mark")
    assert.doesNotMatch(read("core/composite/Timeline/index.tsx"), /readonly marker\?/u, "marker is deleted (v0550 codemod)")
    assert.equal(timelineMarkState({ state: "neutral" }), "done")
    assert.equal(timelineMarkState({ state: "neutral", isCurrent: true }), "running")
    assert.equal(timelineMarkState({ state: "pending" }), "running")
    assert.equal(timelineMarkState({ state: "cautionary" }), "waiting")
    assert.equal(timelineMarkState({ state: "unavailable" }), "skipped")
    assert.equal(timelineMarkState({ state: "affirmative", status: "error" }), "error", "status wins")
    const css = read("common/components-navigation.css")
    assert.doesNotMatch(css, /data-grammar-current="true"\] \.starci-core-timeline-marker \{\s*color: var\(--accent\)/u, "no current-only dot colour")
})

test("Stepper: complete the check, error the x, paused and upcoming the plain ring (waiting and not run), the current step its number on the info tile", () => {
    assert.deepEqual((["complete", "current", "upcoming", "error", "paused"] as const).map(stepperMarkState), ["done", "current", "notRun", "error", "waiting"])
    const markup = render(createElement(Stepper, { label: "Thiết lập", currentStepId: "b", steps: [
        { id: "a", label: "Một" }, { id: "b", label: "Hai" }, { id: "c", label: "Ba", state: "error" }, { id: "d", label: "Bốn", state: "paused" }, { id: "e", label: "Năm" },
    ] }))
    for (const glyph of ["done", "error", "waiting", "notRun"]) assert.match(markup, new RegExp(`data-grammar-status-glyph="${glyph}"`))
    assert.match(markup, /data-tone="info"[^>]*>2</u, "the current step is its number on the info tile")
    assert.equal(count(markup, /data-grammar-mark="status"/g), 5, "every marker is a 40px status tile")
    assert.equal(count(markup, /class="starci-core-icon-tile"/g), 5)
    // dense is inline: bare glyphs, no tile
    const dense = render(createElement(Stepper, { label: "Hàng", size: "dense", currentStepId: "b", steps: [{ id: "a", label: "Một" }, { id: "b", label: "Hai" }] }))
    assert.doesNotMatch(dense, /data-grammar-mark="status"/)
    assert.match(dense, /starci-core-inline-status-glyph/)
})

test("the setup checklist and the all-clear: status tiles; the all-clear's check is the only mark with no subject", () => {
    const steps = render(createElement(EmptyNotice, { message: "Bắt đầu", steps: [{ id: "a", label: "Một", isDone: true }, { id: "b", label: "Hai" }, { id: "c", label: "Ba" }], actionLabel: "Làm", onAction: () => undefined } as never))
    assert.match(steps, /data-grammar-status-glyph="done"/)
    assert.match(steps, /data-grammar-status-glyph="notRun"/)
    assert.equal(count(steps, /data-grammar-mark="status"/g), 3)
    const clear = render(createElement(EmptyNotice, { isAllClear: true, message: "Không có gì cần bạn" }))
    assert.match(clear, /data-grammar-mark="status"[^>]*data-grammar-mark-state="done"|data-grammar-mark-state="done"[^>]*data-grammar-mark="status"/u)
    assert.match(clear, /data-grammar-status-glyph="done"/)
})

test("Alert: its mark is the bare 24px Heroicon in the soft foreground on the soft box, never a status tile; the label.item copy stays", () => {
    const glyphOf = (tone: string) => /data-grammar-alert-glyph="([a-zA-Z]+)"/u.exec(render(createElement(Alert, { tone: tone as never, title: "T" })))?.[1]
    for (const tone of ["affirmative", "negative", "cautionary", "informative", "neutral", "unavailable"]) assert.equal(glyphOf(tone), tone)
    for (const tone of ["affirmative", "negative", "cautionary", "informative", "pending", "accent"]) {
        const markup = render(createElement(Alert, { tone: tone as never, title: "T" }))
        assert.doesNotMatch(markup, /data-grammar-mark="status"|starci-core-icon-tile/u, `${tone}: no tile`)
    }
    const glyph = render(createElement(Alert, { tone: "cautionary", title: "T" }))
    assert.match(glyph, /<svg[^>]*width="24"[^>]*height="24"[^>]*class="starci-core-alert-glyph"/u)
    const css = read("common/components-overlays.css")
    const alert = css.slice(css.indexOf("alert banner"), css.indexOf("Below 30rem"))
    assert.match(alert, /\.starci-core-alert \.starci-core-alert-title \{ font-weight: var\(--grammar-type-label-item-weight\); \}/u)
    assert.match(alert, /\.starci-core-alert \.starci-core-alert-indicator \{\s*inline-size: 1\.5rem;\s*block-size: 1\.5rem;/u)
    for (const [state, tone] of [["affirmative", "success"], ["cautionary", "warning"], ["negative", "danger"], ["accent", "accent"]] as const) {
        assert.match(alert, new RegExp(`\\[data-grammar-tone="${state}"\\] \\{ --starci-core-alert-soft: var\\(--${tone}-soft\\); --starci-core-alert-ink: var\\(--${tone}-soft-foreground\\); \\}`, "u"), state)
    }
    assert.match(alert, /\[data-grammar-tone="informative"\] \{ --starci-core-alert-soft: var\(--informative-soft, var\(--info-soft\)\);/u)
    assert.doesNotMatch(css, /soft-surface|--starci-core-alert-plate|data-tone="alert"/u, "no soft-surface box, no plate")
})

const FIGURES: EntitySummaryCardProps["figures"] = [
    { label: "Đơn chốt", value: "42", delta: { text: "+12%", direction: "up", goodWhen: "up" } },
    { label: "Doanh thu", value: "18tr" },
    { label: "Khách phàn nàn", value: "3", delta: { text: "+2", direction: "up", goodWhen: "down" } },
]
const card = (over: Partial<EntitySummaryCardProps> = {}): string => render(createElement(EntitySummaryCard, {
    name: "Sales AI", isAgent: true, role: "Trả lời khách hỏi giá.", status: { state: "running", label: "Đang làm việc" }, periodLabel: "Tuần này",
    figures: FIGURES, needsYou: { label: "3 báo giá chờ bạn duyệt" }, href: "/agents/sales", linkLabel: "Mở Sales AI", ...over,
}))

test("EntitySummaryCard: name with the AI Chip and the status (A) in the head, the role, Tuần này with exactly three figures, one needs-you line, one whole-card link", () => {
    const markup = card()
    assert.match(markup, /data-component="AgentName"/)
    assert.match(markup, /data-component="InlineStatus"[^>]*data-tone="info"/u)
    assert.match(markup, /Tuần này/)
    assert.equal(count(markup, /class="starci-core-entity-summary-figure"/g), 3)
    assert.match(markup, /data-tone="success"[^>]*>\+12%/u, "up is good for orders")
    assert.match(markup, /data-tone="danger"[^>]*>\+2/u, "up is bad for complaints")
    assert.match(markup, /3 báo giá chờ bạn duyệt/)
    assert.match(markup, /href="\/agents\/sales"/)
    assert.equal(count(markup, /<button/g), 0, "the card holds no control of its own")
    const loading = card({ isLoading: true })
    for (const word of ["Sales AI", "Tuần này", "Đơn chốt", "42", "Đang làm việc"]) assert.doesNotMatch(loading, new RegExp(`>${word}<`), `loading shows no real ${word}`)
})

test("EntitySummaryCard figures are a 3-tuple: two or four do not compile", () => {
    type Figure = EntitySummaryCardProps["figures"][number]
    type Fits<T> = T extends EntitySummaryCardProps["figures"] ? true : false
    const two: Fits<readonly [Figure, Figure]> = false
    const four: Fits<readonly [Figure, Figure, Figure, Figure]> = false
    const three: Fits<readonly [Figure, Figure, Figure]> = true
    assert.deepEqual([two, four, three], [false, false, true])
})
