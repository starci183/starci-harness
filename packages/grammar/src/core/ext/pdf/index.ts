"use client"

/**
 * `@starci/grammar/core/ext/pdf`: the PDF extension of the core grammar. An app shows a PDF document with its `PdfViewer` (pages drawn to a
 * canvas by pdfjs), and uses it ONLY for showing PDF documents; it never imports `pdfjs-dist` itself (DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY). It
 * imports core's components and tokens; core never imports it. `pdfjs-dist` is an optional peer dependency, loaded lazily: install it
 * only in an app that shows PDF documents.
 */
export {
    DEFAULT_PDF_VIEWER_HEIGHT,
    PDF_VIEWER_LABELS,
    PdfViewer,
    type PdfHighlight,
    type PdfHighlightTone,
    type PdfSource,
    type PdfViewerLabels,
    type PdfViewerProps,
} from "./PdfViewer.js"
export { PDF_ZOOM_MAX, PDF_ZOOM_MIN, PDF_ZOOM_STEPS, pageTextOf, textRangeRects, type PdfPageView, type PdfRect, type PdfTextItem } from "./math.js"
