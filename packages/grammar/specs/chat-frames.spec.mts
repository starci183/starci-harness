/**
 * The chat frame card, the Markdown of a message, the centred empty thread and the figure that is a link (owner 2026-11-26, NIVO feedback 2, 3, 4):
 * a structured frame is ONE compact card (title, a status dot only for a real state, field and value rows, at most three actions, the first primary),
 * an unknown kind falls back to its text line, a message's Markdown is a safe subset, an empty thread stands in the middle, a linked figure draws no chevron.
 *
 *   node --import ./specs/support/register.mts --test specs/chat-frames.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"
import { MessageFrame, MESSAGE_FRAME_MAX_ACTIONS, type MessageFrameCard } from "../src/core/composite/MessageFrame/index.tsx"
import { MessageMarkdown, restrictMessageTree } from "../src/core/composite/MessageBubble/MessageMarkdown.tsx"
import { MessageBubble } from "../src/core/composite/MessageBubble/index.tsx"
import { ChatFrame } from "../src/core/frame/ChatFrame/index.tsx"
import { FigureCells } from "../src/core/frame/Section/FigureCells.tsx"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)
const markdown = (source: string): string => render(createElement(MessageMarkdown, { source }))

const lead: MessageFrameCard = {
    title: "Khách mới: Mai Phương",
    fields: [{ label: "Kênh", value: "Zalo" }, { label: "Dịch vụ", value: "Gội đầu dưỡng sinh" }],
    actions: [
        { id: "open", label: "Mở hồ sơ", href: "#lead" },
        { id: "reply", label: "Trả lời", onPress: () => undefined },
        { id: "assign", label: "Giao việc", onPress: () => undefined },
        { id: "extra", label: "Không hiện", onPress: () => undefined },
    ],
    meta: "14:16",
}

test("frame card: one compact card with the title, the field rows and at most three actions, the first primary", () => {
    const html = render(createElement(MessageFrame, { kind: "lead.new", card: lead, text: "Khách mới" }))
    assert.ok(html.includes('data-grammar-frame="card"') && html.includes('data-grammar-frame-kind="lead.new"'))
    assert.ok(html.includes('data-grammar-message-card-density="compact"'))
    assert.ok(html.includes("Khách mới: Mai Phương") && html.includes("Gội đầu dưỡng sinh") && html.includes("14:16"))
    assert.ok(html.includes("Kênh") && html.includes("Dịch vụ"), "the field labels are the terms of the rows")
    assert.equal(MESSAGE_FRAME_MAX_ACTIONS, 3)
    const actions = /<div class="starci-core-message-card-actions"[\s\S]*?<\/div>/u.exec(html)?.[0] ?? ""
    assert.equal((actions.match(/data-component="Button"/g) ?? []).length, 3, "a fourth action is not drawn")
    assert.ok(!html.includes("Không hiện"))
    assert.ok(actions.indexOf("Mở hồ sơ") < actions.indexOf("Trả lời") && actions.indexOf("Trả lời") < actions.indexOf("Giao việc"), "the order given is the order drawn")
    assert.match(actions, /data-grammar-variant="primary"[^>]*>[\s\S]*?Mở hồ sơ/u, "the first action is the card's primary")
    assert.equal((actions.match(/data-grammar-variant="primary"/g) ?? []).length, 1, "and only the first")
})

test("frame card: the status dot appears only for a real state", () => {
    const plain = render(createElement(MessageFrame, { kind: "booking.created", card: { title: "Đã ghi lịch" }, text: "Đã ghi lịch" }))
    assert.ok(!plain.includes('data-component="StatusDot"'), "an informing card has no dot")
    const overdue = render(createElement(MessageFrame, { kind: "lead.overdue", card: { title: "Quá hạn liên hệ", status: { tone: "danger", label: "Quá hạn" } }, text: "Quá hạn" }))
    assert.ok(overdue.includes('data-component="StatusDot"') && overdue.includes('aria-label="Quá hạn"') && overdue.includes('data-tone="danger"'))
})

test("frame card: an unknown kind, or a card with no title, falls back to its text line, which reads safe Markdown", () => {
    const unknown = render(createElement(MessageFrame, { kind: "thing.never.seen", text: "Có **việc mới** cần xem" }))
    assert.ok(unknown.includes('data-grammar-frame="text"') && unknown.includes('data-grammar-frame-kind="thing.never.seen"'))
    assert.ok(unknown.includes("<strong>việc mới</strong>") && !unknown.includes("starci-core-message-card"))
    const empty = render(createElement(MessageFrame, { kind: "lead.new", card: { title: "  " }, text: "Khách mới" }))
    assert.ok(empty.includes('data-grammar-frame="text"') && empty.includes("Khách mới"))
    const none = render(createElement(MessageFrame, { kind: "lead.new", card: null, text: "Khách mới", format: "plain" }))
    assert.ok(none.includes('data-grammar-frame="text"') && !none.includes("data-grammar-bubble-format"))
})

test("markdown: bold, italic, strikethrough, inline code, links and lists are drawn", () => {
    const html = markdown("**đậm** và *nghiêng* và ~~gạch~~ và `mã` và [trang](https://example.com/a)\n\n- một\n- hai\n\n1. ba\n2. bốn")
    assert.ok(html.includes("<strong>đậm</strong>") && html.includes("<em>nghiêng</em>") && html.includes("<del>gạch</del>"))
    assert.ok(html.includes('data-component="Code"') && html.includes(">mã<"))
    assert.ok(html.includes('href="https://example.com/a"') && html.includes("trang"))
    assert.ok(html.includes("<ul>") && html.includes("<li>một</li>") && html.includes("<ol>") && html.includes("<li>bốn</li>"))
})

test("markdown: raw HTML is never rendered, an unsafe link is its words, a heading, image, table or fence is plain words", () => {
    const html = markdown("<script>alert(1)</script> và <b>thô</b>")
    assert.ok(!html.includes("<script") && !html.includes("<b>"), html)
    assert.ok(html.includes("&lt;script&gt;") || html.includes("alert(1)"), "its characters stay as text")
    const unsafe = markdown("[bấm](javascript:alert(1)) và [thư](mailto:a@b.vn)")
    assert.ok(!unsafe.includes("javascript:") && unsafe.includes("bấm"), unsafe)
    assert.ok(unsafe.includes('href="mailto:a@b.vn"'))
    const heading = markdown("# Tiêu đề lớn\n\nthân")
    assert.ok(!/<h[1-6]/u.test(heading) && heading.includes("Tiêu đề lớn") && heading.includes("thân"))
    const image = markdown("![ảnh mèo](https://example.com/x.png)")
    assert.ok(!image.includes("<img") && image.includes("ảnh mèo"))
    const table = markdown("| a | b |\n| - | - |\n| 1 | 2 |")
    assert.ok(!table.includes("<table"))
    const fence = markdown("```js\nconst a = 1\n```")
    assert.ok(!fence.includes("<pre") && fence.includes("const a = 1"))
    const external = markdown("[ngoài](https://example.com)")
    assert.ok(external.includes('target="_blank"') || external.includes("noopener") || external.includes('data-kind="external"'), external)
})

test("markdown: the restricted tree only holds paragraphs and lists", () => {
    const tree = restrictMessageTree(fromMarkdown("# h\n\ntext\n\n> quote\n\n---\n\n- a\n\n```\ncode\n```", { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }))
    assert.deepEqual(tree.map((block) => block.type), ["paragraph", "paragraph", "paragraph", "list", "paragraph"])
})

test("bubble: format=markdown draws a string body as Markdown; a node body and the plain format are left as given", () => {
    const md = render(createElement(MessageBubble, { body: "**ok**", format: "markdown", author: "Hiền" }))
    assert.ok(md.includes("<strong>ok</strong>") && md.includes('data-grammar-bubble-format="markdown"'))
    const plain = render(createElement(MessageBubble, { body: "**ok**" }))
    assert.ok(plain.includes("**ok**") && !plain.includes("<strong>"))
    const node = render(createElement(MessageBubble, { body: createElement("span", null, "**ok**"), format: "markdown" }))
    assert.ok(node.includes("**ok**") && !node.includes("<strong>") && !node.includes("data-grammar-bubble-format"))
})

test("empty thread: the empty slot is drawn only with no message, marked for the centring rule, which is on both axes", () => {
    const frame = (children?: unknown) => render(createElement(ChatFrame, { label: "Chat", header: createElement("div", null, "Head"), empty: createElement("p", { className: "starci-core-empty-notice" }, "Chưa có tin nhắn"), children } as never))
    const empty = frame()
    assert.ok(empty.includes('data-grammar-chat-empty="true"') && empty.includes("Chưa có tin nhắn"))
    const full = frame(createElement("div", null, "xin chào"))
    assert.ok(!full.includes("data-grammar-chat-empty") && !full.includes("Chưa có tin nhắn") && full.includes("xin chào"))
    const css = read("common/styles.css")
    const rule = /\.starci-core-chat-frame-thread-content:is\(\[data-grammar-chat-empty="true"\], :has\(> \.starci-core-empty-notice:only-child\)\) \{([^}]*)\}/u.exec(css)?.[1] ?? ""
    assert.match(rule, /justify-content: center;/u)
    assert.match(rule, /align-items: center;/u)
})

test("figure link: a figure with a link draws no chevron or arrow, the cell is the target with a pointer and a hover surface", () => {
    const html = render(createElement(FigureCells, { isLoading: false, items: [{ id: "a", term: "Cần bạn hôm nay", value: 4, href: "#a" }, { id: "b", term: "Tỉ lệ", value: 18, unit: "%" }] }))
    assert.ok(html.includes("starci-core-figure-link") && html.includes('href="#a"'), "the link is still there")
    assert.ok(!html.includes("data-grammar-figure-cue") && !html.includes("starci-core-figure-cue"), "no cue glyph")
    const css = read("common/components-navigation.css")
    assert.ok(!css.includes(".starci-core-figure-cue"), "no cue rule is left in the sheet")
    assert.match(css, /\[data-grammar-figure-destination="true"\]:has\(> dd > \.starci-core-figure-link\) \{ cursor: pointer; \}/u)
    assert.match(css, /:has\(> dd > \.starci-core-figure-link\):hover \{ background: var\(--surface-secondary\); \}/u)
})
