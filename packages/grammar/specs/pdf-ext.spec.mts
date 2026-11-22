/**
 * The PDF extension `@starci/grammar/core/ext/pdf`: page navigation and the zoom ladder, fit-to-width and pinch, where a highlight falls on a
 * page, and the viewer's loading (all Skeleton, no words) and error (a Grammar Alert) states. Core never imports the extension or pdfjs.
 *
 *   node --import ./specs/support/register.mts --test specs/pdf-ext.spec.mts
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PDF_VIEWER_LABELS, PDF_ZOOM_MAX, PDF_ZOOM_MIN, PDF_ZOOM_STEPS, PdfViewer, pageTextOf, textRangeRects, type PdfHighlight, type PdfTextItem } from "../src/core/ext/pdf/index.ts"
import { clampPage, clampZoom, fitWidthZoom, pinchZoom, pointerDistance, rectAtZoom, zoomIn, zoomOut } from "../src/core/ext/pdf/math.ts"
import { PdfViewerFrame, highlightBoxes, highlightGround, type PdfViewerFrameProps } from "../src/core/ext/pdf/PdfViewer.tsx"

const src = fileURLToPath(new URL("../src/", import.meta.url))
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : []
    })
const rel = (path: string): string => relative(src, path).replaceAll("\\", "/")
const noop = (): void => undefined

test("page navigation stays inside the document", () => {
    assert.equal(clampPage(0, 5), 1)
    assert.equal(clampPage(-3, 5), 1)
    assert.equal(clampPage(6, 5), 5)
    assert.equal(clampPage(3.4, 5), 3)
    assert.equal(clampPage(2, 0), 1)
    assert.equal(clampPage(Number.NaN, 5), 1)
})

test("zoom walks the ladder and stops at its ends", () => {
    assert.deepEqual([...PDF_ZOOM_STEPS], [0.5, 0.75, 1, 1.25, 1.5, 2, 3])
    assert.equal(zoomIn(1), 1.25)
    assert.equal(zoomOut(1), 0.75)
    assert.equal(zoomIn(0.83), 1, "from a fitted zoom, in goes to the next step")
    assert.equal(zoomOut(0.83), 0.75)
    assert.equal(zoomIn(PDF_ZOOM_MAX), PDF_ZOOM_MAX)
    assert.equal(zoomOut(PDF_ZOOM_MIN), PDF_ZOOM_MIN)
    assert.equal(clampZoom(9), PDF_ZOOM_MAX)
    assert.equal(clampZoom(0.1), PDF_ZOOM_MIN)
    assert.equal(clampZoom(Number.NaN), 1)
})

test("fit to width fills the box, inside the ladder", () => {
    assert.equal(fitWidthZoom(612, 612), 1)
    assert.equal(fitWidthZoom(918, 612), 1.5)
    assert.equal(fitWidthZoom(340, 595), 340 / 595, "a 390 phone fits an A4 page")
    assert.equal(fitWidthZoom(100, 612), PDF_ZOOM_MIN)
    assert.equal(fitWidthZoom(0, 612), 1)
})

test("a pinch scales the zoom by how far the fingers spread", () => {
    assert.equal(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5)
    assert.equal(pinchZoom(1, 100, 150), 1.5)
    assert.equal(pinchZoom(1, 100, 50), 0.5)
    assert.equal(pinchZoom(2, 100, 400), PDF_ZOOM_MAX)
    assert.equal(pinchZoom(1.25, 0, 80), 1.25)
})

const view = [0, 0, 600, 800] as const
const items: readonly PdfTextItem[] = [
    { str: "Invoice 2026", transform: [12, 0, 0, 12, 72, 700], width: 120, height: 12, hasEOL: true },
    { str: "Total: 500", transform: [10, 0, 0, 10, 72, 680], width: 100, height: 10 },
]

test("the page text a text highlight counts into joins the runs, a line feed after each line", () => {
    assert.equal(pageTextOf(items), "Invoice 2026\nTotal: 500")
})

test("a text range becomes one box per run it meets, measured from the page's top-left in points", () => {
    const text = pageTextOf(items)
    const start = text.indexOf("2026")
    assert.deepEqual(textRangeRects(items, view, start, start + 4), [{ x: 72 + 80, y: 800 - 700 - 12, width: 40, height: 12 }])
    const across = textRangeRects(items, view, text.indexOf("2026"), text.indexOf(":"))
    assert.equal(across.length, 2)
    assert.deepEqual(across[1], { x: 72, y: 800 - 680 - 10, width: 50, height: 10 })
    assert.deepEqual(textRangeRects(items, view, 5, 5), [])
    assert.deepEqual(textRangeRects(items, [10, 20, 610, 820], 0, 1)[0], { x: 62, y: 820 - 700 - 12, width: 10, height: 12 })
})

test("a highlight's box scales with the zoom, on its own page only, in its tone's soft pair", () => {
    assert.deepEqual(rectAtZoom({ x: 10, y: 20, width: 30, height: 40 }, 2), { left: 20, top: 40, width: 60, height: 80 })
    const highlights: readonly PdfHighlight[] = [
        { id: "total", page: 1, start: 13, end: 23, tone: "success" },
        { id: "stamp", page: 1, rect: { x: 400, y: 50, width: 100, height: 60 } },
        { id: "other", page: 2, rect: { x: 0, y: 0, width: 10, height: 10 } },
    ]
    const boxes = highlightBoxes(highlights, 1, view, items, 1.5)
    assert.deepEqual(boxes.map((entry) => entry.highlight.id), ["total", "stamp"])
    assert.deepEqual(boxes[0]?.box, { left: 72 * 1.5, top: 110 * 1.5, width: 150, height: 15 })
    assert.deepEqual(boxes[1]?.box, { left: 600, top: 75, width: 150, height: 90 })
    assert.equal(highlightGround("warning"), "var(--warning-soft)")
    assert.equal(highlightGround("neutral"), "var(--default-soft)")
})

const frame = (over: Partial<PdfViewerFrameProps>): string =>
    renderToStaticMarkup(createElement(PdfViewerFrame, {
        status: "ready", ariaLabel: "Invoice", labels: PDF_VIEWER_LABELS, page: 2, total: 5, zoom: 1, isFit: true, height: 480,
        onPrevious: noop, onNext: noop, onZoomIn: noop, onZoomOut: noop, onFit: noop, onDownload: noop, onRetry: noop,
        pageView: createElement("canvas", { "data-test-page": "true" }),
        ...over,
    }))

test("ready: the counter, the commands named by the app's words, the page", () => {
    const html = frame({ labels: { ...PDF_VIEWER_LABELS, fitWidth: "Vừa khung", pageOf: (page, total) => `Trang ${page} / ${total}` } })
    assert.match(html, /data-component="PdfViewer"/)
    assert.match(html, /data-state="ready"/)
    assert.match(html, /Trang 2 \/ 5/)
    assert.match(html, /Vừa khung/)
    for (const label of ["Previous page", "Next page", "Zoom in", "Zoom out", "Download"]) assert.match(html, new RegExp(`aria-label="${label}"`))
    assert.match(html, /aria-pressed="true"/)
    assert.match(html, /data-test-page="true"/)
    assert.match(html, /block-size:480px/)
    assert.match(html, /touch-action:pan-x pan-y/, "one finger pans, the viewer owns the pinch")
    assert.match(html, /box-shadow:none/)
    assert.match(html, /border:var\(--grammar-hairline\) solid var\(--separator\)/)
})

const disabled = (html: string, label: string): boolean => new RegExp(`<(?:button|a)[^>]*aria-label="${label}"[^>]*(?:disabled=""|aria-disabled="true"|data-disabled="true")`).test(html)
    || new RegExp(`<(?:button|a)[^>]*(?:disabled=""|aria-disabled="true"|data-disabled="true")[^>]*aria-label="${label}"`).test(html)

test("navigation stops at the first and the last page; zoom stops at its ends", () => {
    assert.equal(disabled(frame({ page: 1 }), "Previous page"), true)
    assert.equal(disabled(frame({ page: 1 }), "Next page"), false)
    assert.equal(disabled(frame({ page: 5 }), "Next page"), true)
    assert.equal(disabled(frame({ zoom: PDF_ZOOM_MAX }), "Zoom in"), true)
    assert.equal(disabled(frame({ zoom: PDF_ZOOM_MIN }), "Zoom out"), true)
    assert.equal(disabled(frame({ zoom: 1 }), "Zoom in"), false)
})

test("loading is all Skeleton: the commands' boxes and the page box, no words, the box busy", () => {
    const html = frame({ status: "loading" })
    assert.match(html, /data-state="loading"/)
    assert.match(html, /aria-busy="true"/)
    assert.match(html, /data-grammar-pdf-page="loading"/)
    assert.match(html, /aspect-ratio:210 \/ 297/)
    assert.equal((html.match(/data-component="Skeleton"/g) ?? []).length >= 8, true)
    for (const word of ["Fit width", "2 / 5", "Previous page", "Download"]) assert.doesNotMatch(html, new RegExp(word))
    assert.doesNotMatch(html, /<button/)
    assert.doesNotMatch(html, /data-test-page/)
})

test("the viewer itself starts loading (no file is read during a server render)", () => {
    const html = renderToStaticMarkup(createElement(PdfViewer, { source: "/files/invoice.pdf", ariaLabel: "Invoice" }))
    assert.match(html, /data-state="loading"/)
    assert.doesNotMatch(html, /<canvas/)
    const loading = renderToStaticMarkup(createElement(PdfViewer, { source: new Uint8Array([37, 80, 68, 70]), ariaLabel: "Invoice", isLoading: true, height: 300 }))
    assert.match(loading, /block-size:300px/)
})

test("error is a negative Grammar Alert with the app's title and a retry, and no page", () => {
    const html = frame({ status: "error", labels: { ...PDF_VIEWER_LABELS, errorTitle: "Không mở được tài liệu", retry: "Thử lại" } })
    assert.match(html, /data-state="error"/)
    assert.match(html, /data-component="Alert"/)
    assert.match(html, /role="alert"/)
    assert.match(html, /Không mở được tài liệu/)
    assert.match(html, /Thử lại/)
    assert.doesNotMatch(html, /data-test-page/)
    assert.doesNotMatch(html, /data-grammar-pdf-toolbar/)
})

test("core never imports the PDF ext or pdfjs; only the ext imports pdfjs-dist", () => {
    for (const file of walk(src)) {
        const path = rel(file)
        if (path.startsWith("core/ext/pdf/") || path.startsWith("stories/")) continue
        const text = readFileSync(file, "utf8")
        assert.doesNotMatch(text, /from\s+["'][^"']*ext\/pdf/, `${path} imports the PDF ext`)
        assert.doesNotMatch(text, /["']pdfjs-dist(?:\/[^"']*)?["']/, `${path} imports pdfjs-dist`)
    }
})

test("the ext holds no literal colour", () => {
    for (const file of walk(join(src, "core", "ext", "pdf"))) assert.doesNotMatch(readFileSync(file, "utf8"), /#[0-9a-fA-F]{3,8}\b|rgba?\(/, rel(file))
})
