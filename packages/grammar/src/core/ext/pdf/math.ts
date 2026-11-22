/**
 * The pure arithmetic of the PDF viewer: page bounds, the zoom ladder, fit-to-width, pinch, and where a highlight falls on a page. No
 * pdfjs import here, so an app (or a server) can compute the same text offsets the viewer marks, and the specs run without a browser.
 */

/** The zoom steps the zoom in and zoom out buttons walk (1 = the page at its own size, 72 points to the inch). */
export const PDF_ZOOM_STEPS: readonly number[] = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 3])
export const PDF_ZOOM_MIN = 0.5
export const PDF_ZOOM_MAX = 3

/** A zoom held inside the ladder's ends. */
export const clampZoom = (zoom: number): number => (Number.isFinite(zoom) ? Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, zoom)) : 1)

/** The next step up from `zoom` (from a fitted 0.83 that is 1), or the top. */
export const zoomIn = (zoom: number): number => PDF_ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? PDF_ZOOM_MAX

/** The next step down from `zoom`, or the bottom. */
export const zoomOut = (zoom: number): number => [...PDF_ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? PDF_ZOOM_MIN

/** A page number held inside the document (1-based); a document with no pages reads as page 1. */
export const clampPage = (page: number, total: number): number => {
    if (!Number.isFinite(total) || total < 1) return 1
    if (!Number.isFinite(page)) return 1
    return Math.min(Math.floor(total), Math.max(1, Math.round(page)))
}

/** The zoom at which a page `pageWidth` points wide fills a box `boxWidth` pixels wide, inside the ladder's ends. */
export const fitWidthZoom = (boxWidth: number, pageWidth: number): number => (boxWidth > 0 && pageWidth > 0 ? clampZoom(boxWidth / pageWidth) : 1)

/** The zoom after a pinch: the zoom when the two fingers landed, times how far they spread since, inside the ladder's ends. */
export const pinchZoom = (startZoom: number, startDistance: number, distance: number): number =>
    startDistance > 0 && distance > 0 ? clampZoom(startZoom * (distance / startDistance)) : clampZoom(startZoom)

/** The distance between two touch points, in pixels. */
export const pointerDistance = (a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)

/** A box on a page in PDF points (1/72 inch), measured from the page's TOP-LEFT corner as a reader sees it (x to the right, y down). */
export type PdfRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** One text run of a page, the shape pdfjs's `page.getTextContent()` gives (`transform` is the run's matrix in PDF space, y up). */
export type PdfTextItem = {
    readonly str: string
    readonly transform: readonly number[]
    readonly width: number
    readonly height: number
    readonly hasEOL?: boolean
}

/** The page's box in PDF space: pdfjs's `page.view` (`[left, bottom, right, top]`). */
export type PdfPageView = readonly [number, number, number, number]

/**
 * The text of a page that a text highlight's `start` and `end` count into: each run's `str` in order, a line feed after a run that
 * ends a line (`hasEOL`). An app computes its offsets on this same string (`pageTextOf(await page.getTextContent()).items`).
 */
export const pageTextOf = (items: readonly PdfTextItem[]): string => items.map((item) => `${item.str}${item.hasEOL === true ? "\n" : ""}`).join("")

/**
 * The boxes a text range covers on a page, one per run it meets (horizontal text; a run's characters share its width evenly).
 * `start` and `end` are offsets into `pageTextOf(items)`, end exclusive.
 */
export const textRangeRects = (items: readonly PdfTextItem[], view: PdfPageView, start: number, end: number): PdfRect[] => {
    const rects: PdfRect[] = []
    if (!(end > start)) return rects
    let offset = 0
    for (const item of items) {
        const length = item.str.length
        const from = Math.max(start, offset) - offset
        const to = Math.min(end, offset + length) - offset
        if (to > from && length > 0) {
            const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform
            const height = item.height > 0 ? item.height : Math.hypot(c, d) || Math.hypot(a, b)
            rects.push({
                x: e - view[0] + (item.width * from) / length,
                y: view[3] - f - height,
                width: (item.width * (to - from)) / length,
                height,
            })
        }
        offset += length + (item.hasEOL === true ? 1 : 0)
        if (offset >= end) break
    }
    return rects
}

/** A page box in CSS pixels at a zoom: what the overlay of a highlight is drawn at. */
export const rectAtZoom = (rect: PdfRect, zoom: number): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } => ({
    left: rect.x * zoom,
    top: rect.y * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom,
})
