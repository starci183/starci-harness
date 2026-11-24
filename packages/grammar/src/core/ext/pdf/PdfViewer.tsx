"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react"
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist"
import { Alert } from "../../composite/Alert/index.js"
import { Button } from "../../leaf/Button/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { Text } from "../../leaf/Text/index.js"
import { useIsLoading, useRegionOwnsBusy } from "../../regionScope.js"
import type { NoChildren } from "../../tier.js"
import { PDF_ZOOM_MAX, PDF_ZOOM_MIN, clampPage, fitWidthZoom, pinchZoom, pointerDistance, rectAtZoom, textRangeRects, zoomIn, zoomOut, type PdfPageView, type PdfRect, type PdfTextItem } from "./math.js"
import { loadPdfjs } from "./pdfjs.js"
import { TablerDownload, TablerZoomIn, TablerZoomOut } from "../../leaf/Icon/tabler.js"

/** What the viewer opens: a URL (same origin, or one that allows CORS), or the file's bytes. */
export type PdfSource = string | ArrayBuffer | Uint8Array

/** The tone of a highlight: a Grammar soft pair (a Badge's tones), as Markdown's highlights. */
export type PdfHighlightTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"

/**
 * A passage the app marks on a page (the shape of Markdown's highlights, with a page). Either a `rect` in PDF points from the page's
 * top-left corner, or `start` and `end`: character offsets (end exclusive) into the page's text as `pageTextOf` joins it. `note` names
 * the mark for assistive technology and shows on hover. Drawn as a tone-soft overlay over the page.
 */
export type PdfHighlight = {
    readonly id: string
    /** The page it marks, 1-based. */
    readonly page: number
    readonly note?: string
    /** Default `warning`, as Markdown's. */
    readonly tone?: PdfHighlightTone
} & (
    | { readonly rect: PdfRect; readonly start?: never; readonly end?: never }
    | { readonly start: number; readonly end: number; readonly rect?: never }
)

/** The words of the viewer, in the app's language; each has an English default. */
export type PdfViewerLabels = {
    readonly previousPage: string
    readonly nextPage: string
    readonly zoomIn: string
    readonly zoomOut: string
    /** The fit-to-width command, e.g. "Vừa khung". */
    readonly fitWidth: string
    readonly download: string
    /** The page counter, e.g. `(page, total) => \`Trang ${page} / ${total}\``. Default "n / total". */
    readonly pageOf: (page: number, total: number) => string
    /** The title of the error banner when the document cannot be opened. */
    readonly errorTitle: string
    /** The retry action of the error banner (shown when `onRetry` is passed, or always: the viewer retries itself). */
    readonly retry: string
}

export const PDF_VIEWER_LABELS: PdfViewerLabels = Object.freeze({
    previousPage: "Previous page",
    nextPage: "Next page",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fitWidth: "Fit width",
    download: "Download",
    pageOf: (page: number, total: number) => `${page} / ${total}`,
    errorTitle: "The document could not be opened",
    retry: "Try again",
})

/** The height of the page area when the app passes none, in pixels. */
export const DEFAULT_PDF_VIEWER_HEIGHT = 640

/** An unknown page's proportions while it loads: A4 portrait, the commonest business page. */
const LOADING_PAGE_ASPECT = "210 / 297"

export type PdfViewerProps = NoChildren & {
    readonly source: PdfSource
    /** Names the document for assistive technology, e.g. its title. Required: the page is drawn on a canvas. */
    readonly ariaLabel: string
    readonly labels?: Partial<PdfViewerLabels>
    /** The name the download saves under. Default "document.pdf". */
    readonly fileName?: string
    /**
     * Where pdfjs's worker is served from. Default: pdfjs's own `pdf.worker.min.mjs` beside the library, which webpack, Turbopack and
     * Rspack resolve; a bundler that does not (Vite) passes its URL (`import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"`).
     */
    readonly workerSrc?: string
    readonly highlights?: readonly PdfHighlight[]
    /** Makes each highlight a press target (a button named by its `note`). */
    readonly onHighlightPress?: (id: string) => void
    /** The page shown first, 1-based. Default 1. */
    readonly initialPage?: number
    readonly onPageChange?: (page: number) => void
    /** The height of the page area in pixels (the toolbar stands above it). Default 640. */
    readonly height?: number
    /** Replaces the built-in download (the URL, or the bytes as a file). */
    readonly onDownload?: () => void
    /** The document is not known yet: the whole viewer is a Skeleton of its box. Inside a loading region it follows the region. */
    readonly isLoading?: boolean
}

export type PdfViewerStatus = "loading" | "error" | "ready"

/** What the frame draws: the state, the numbers and the commands. Exported for the specs; an app uses `PdfViewer`. */
export type PdfViewerFrameProps = NoChildren & {
    readonly status: PdfViewerStatus
    readonly ariaLabel: string
    readonly labels: PdfViewerLabels
    readonly page: number
    readonly total: number
    readonly zoom: number
    readonly isFit: boolean
    readonly height: number
    readonly onPrevious: () => void
    readonly onNext: () => void
    readonly onZoomIn: () => void
    readonly onZoomOut: () => void
    readonly onFit: () => void
    readonly onDownload: () => void
    readonly onRetry: () => void
    /** The drawn page (ready) or nothing: loading draws the page box's Skeleton. */
    readonly pageView?: ReactNode
    readonly scrollRef?: (node: HTMLDivElement | null) => void
    readonly onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerUp?: (event: PointerEvent<HTMLDivElement>) => void
}

const surfaceStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    minInlineSize: 0,
    inlineSize: "100%",
    background: "var(--surface)",
    border: "var(--grammar-hairline) solid var(--separator)",
    borderRadius: "var(--starci-core-surface-radius)",
    boxShadow: "none",
    overflow: "hidden",
}

const toolbarStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--grammar-inline-gap)",
    padding: "var(--grammar-inset-nested) var(--grammar-inset)",
    borderBlockEnd: "var(--grammar-hairline) solid var(--separator)",
}

const groupStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--grammar-identity-gap)", minInlineSize: 0 }

const areaStyle = (height: number): CSSProperties => ({
    blockSize: height,
    overflow: "auto",
    padding: "var(--grammar-inset)",
    background: "var(--surface-secondary)",
    // One finger pans (the browser scrolls), two fingers pinch (the viewer zooms): the browser never zooms the page itself.
    touchAction: "pan-x pan-y",
    overscrollBehavior: "contain",
})

/** The toolbar and the page area of the viewer, in each state; loading is all Skeleton, each command at its own 40 box. */
export const PdfViewerFrame = (props: PdfViewerFrameProps) => {
    const { status, ariaLabel, labels, page, total, zoom, isFit, height } = props
    const regionOwnsBusy = useRegionOwnsBusy()
    const isLoading = status === "loading"
    const common = { "data-tier": "ext", "data-component": "PdfViewer", "data-grammar-ext": "pdf", "data-state": status, style: surfaceStyle } as const
    if (status === "error") {
        return (
            <div {...common}>
                <div style={{ padding: "var(--grammar-inset)" }}>
                    <Alert tone="negative" title={labels.errorTitle} action={{ label: labels.retry, onAction: props.onRetry }} />
                </div>
            </div>
        )
    }
    return (
        <div {...common} {...(isLoading && !regionOwnsBusy ? { "aria-busy": true } : {})} role="group" aria-label={ariaLabel}>
            {isLoading ? (
                // Loading is all Skeleton (no words): each command's own box, the counter a text line.
                <div style={toolbarStyle} data-grammar-pdf-toolbar="loading">
                    <div style={groupStyle}>
                        <Skeleton shape="circle" size="md" />
                        <span data-grammar-pdf-page-count="loading" style={{ inlineSize: "var(--starci-core-control-min-size)", display: "inline-flex" }}><Skeleton shape="text" /></span>
                        <Skeleton shape="circle" size="md" />
                    </div>
                    <div style={groupStyle}>
                        <Skeleton shape="circle" size="md" />
                        <Skeleton shape="circle" size="md" />
                        <Skeleton shape="button" size="md" />
                        <Skeleton shape="circle" size="md" />
                    </div>
                </div>
            ) : (
                <div style={toolbarStyle} data-grammar-pdf-toolbar="true">
                    <div style={groupStyle}>
                        <IconButton label={labels.previousPage} source={glyphSource("chevron-start")} variant="border" isDisabled={page <= 1} onPress={props.onPrevious} />
                        <Text as="span" role="body" tabular><span data-grammar-pdf-page-count="true" aria-live="polite">{labels.pageOf(page, total)}</span></Text>
                        <IconButton label={labels.nextPage} source={glyphSource("chevron-end")} variant="border" isDisabled={page >= total} onPress={props.onNext} />
                    </div>
                    <div style={groupStyle}>
                        <IconButton label={labels.zoomOut} source={TablerZoomOut} variant="border" isDisabled={zoom <= PDF_ZOOM_MIN + 1e-6} onPress={props.onZoomOut} />
                        <IconButton label={labels.zoomIn} source={TablerZoomIn} variant="border" isDisabled={zoom >= PDF_ZOOM_MAX - 1e-6} onPress={props.onZoomIn} />
                        <Button variant="border" aria-pressed={isFit} onPress={props.onFit}>{labels.fitWidth}</Button>
                        <IconButton label={labels.download} source={TablerDownload} variant="border" onPress={props.onDownload} />
                    </div>
                </div>
            )}
            <div
                ref={props.scrollRef}
                style={areaStyle(height)}
                data-grammar-pdf-area="true"
                {...(props.onPointerDown === undefined ? {} : { onPointerDown: props.onPointerDown, onPointerMove: props.onPointerMove, onPointerUp: props.onPointerUp, onPointerCancel: props.onPointerUp })}
            >
                {isLoading || props.pageView === undefined
                    ? <div data-grammar-pdf-page="loading" style={{ inlineSize: "100%", aspectRatio: LOADING_PAGE_ASPECT }}><Skeleton shape="box" width="100%" height="100%" radius="none" /></div>
                    : props.pageView}
            </div>
        </div>
    )
}

/** The overlay colour of a highlight: its tone's soft pair, as Markdown's marks. */
export const highlightGround = (tone: PdfHighlightTone): string => (tone === "neutral" ? "var(--default-soft)" : `var(--${tone}-soft)`)

type PageMetrics = { readonly width: number; readonly height: number; readonly view: PdfPageView }

/** The boxes of the highlights on one page, at a zoom: a rect as given, a text range from the page's text runs. */
export const highlightBoxes = (highlights: readonly PdfHighlight[], page: number, view: PdfPageView, items: readonly PdfTextItem[], zoom: number) =>
    highlights
        .filter((highlight) => highlight.page === page)
        .flatMap((highlight) => {
            const rects = highlight.rect !== undefined ? [highlight.rect] : textRangeRects(items, view, highlight.start, highlight.end)
            return rects.map((rect, index) => ({ highlight, index, box: rectAtZoom(rect, zoom) }))
        })

const asTextItems = (items: readonly unknown[]): PdfTextItem[] =>
    items.filter((item): item is PdfTextItem => typeof item === "object" && item !== null && "str" in item && "transform" in item)

const bytesOf = (source: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> => (source instanceof Uint8Array ? source.slice() : new Uint8Array(source.slice(0)))

/** Saves the document: a URL is followed with `download`; bytes become a file. */
const saveDocument = (source: PdfSource, fileName: string): void => {
    const href = typeof source === "string" ? source : URL.createObjectURL(new Blob([bytesOf(source)], { type: "application/pdf" }))
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = fileName
    anchor.rel = "noopener"
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    if (typeof source !== "string") setTimeout(() => URL.revokeObjectURL(href), 0)
}

/**
 * `PdfViewer` of `@starci/grammar/core/ext/pdf`: shows ONE PDF document, a page at a time, drawn to a `<canvas>` by pdfjs (no iframe, so it
 * works on phones and in headless shots). Previous and next page, the page counter, zoom out and in, fit to width, download; optional
 * highlights drawn as tone-soft overlays; a Skeleton of the box while loading and a Grammar Alert when the file cannot be opened. One
 * finger pans the page, two fingers pinch to zoom; the commands keep their 40 boxes on a phone. Use it ONLY to show a PDF document.
 */
export const PdfViewer = (props: PdfViewerProps) => {
    const { source, ariaLabel, workerSrc, highlights = [], onHighlightPress, onPageChange, onDownload, fileName = "document.pdf", height = DEFAULT_PDF_VIEWER_HEIGHT } = props
    const labels = useMemo<PdfViewerLabels>(() => ({ ...PDF_VIEWER_LABELS, ...props.labels }), [props.labels])
    const isLoading = useIsLoading(props.isLoading)
    const [attempt, setAttempt] = useState(0)
    const [document_, setDocument] = useState<PDFDocumentProxy | null>(null)
    const [failed, setFailed] = useState(false)
    const [page, setPage] = useState(() => Math.max(1, Math.round(props.initialPage ?? 1)))
    const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null)
    const [metrics, setMetrics] = useState<PageMetrics | null>(null)
    const [items, setItems] = useState<readonly PdfTextItem[]>([])
    const [zoomChoice, setZoomChoice] = useState<number | "fit">("fit")
    const [boxWidth, setBoxWidth] = useState(0)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const pointers = useRef(new Map<number, { x: number; y: number }>())
    const pinch = useRef<{ distance: number; zoom: number } | null>(null)
    const frame = useRef<number | null>(null)
    const observer = useRef<ResizeObserver | null>(null)

    // Open the document (again on retry, or on a new source).
    useEffect(() => {
        if (isLoading) return
        let live = true
        let destroy: (() => void) | undefined
        setFailed(false)
        setDocument(null)
        setPageProxy(null)
        setMetrics(null)
        loadPdfjs(workerSrc)
            .then((pdfjs) => {
                if (!live) return undefined
                const task = pdfjs.getDocument(typeof source === "string" ? { url: source } : { data: bytesOf(source) })
                destroy = () => { void task.destroy() }
                return task.promise
            })
            .then((opened) => {
                if (opened === undefined || !live) return
                setDocument(opened)
                setPage((current) => clampPage(current, opened.numPages))
            })
            .catch(() => { if (live) setFailed(true) })
        return () => {
            live = false
            destroy?.()
        }
    }, [source, workerSrc, attempt, isLoading])

    // Read the page: its size at zoom 1 and its box in PDF space.
    useEffect(() => {
        if (document_ === null) return
        let live = true
        document_.getPage(clampPage(page, document_.numPages))
            .then((proxy) => {
                if (!live) return
                const viewport = proxy.getViewport({ scale: 1 })
                const [left = 0, bottom = 0, right = viewport.width, top = viewport.height] = proxy.view
                setPageProxy(proxy)
                setMetrics({ width: viewport.width, height: viewport.height, view: [left, bottom, right, top] })
            })
            .catch(() => { if (live) setFailed(true) })
        return () => { live = false }
    }, [document_, page])

    // The page's text runs, only when a text highlight falls on it.
    const wantsText = highlights.some((highlight) => highlight.page === page && highlight.rect === undefined)
    useEffect(() => {
        setItems([])
        if (pageProxy === null || !wantsText) return
        let live = true
        pageProxy.getTextContent()
            .then((content) => { if (live) setItems(asTextItems(content.items)) })
            .catch(() => undefined)
        return () => { live = false }
    }, [pageProxy, wantsText])

    const zoom = zoomChoice === "fit" ? fitWidthZoom(boxWidth, metrics?.width ?? 0) : zoomChoice

    // Draw the page at the zoom, sharp on a dense screen; a newer draw cancels the older one.
    useEffect(() => {
        const canvas = canvasRef.current
        if (pageProxy === null || canvas === null) return
        const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
        const viewport = pageProxy.getViewport({ scale: zoom })
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        let task: RenderTask | null = pageProxy.render({ canvas, viewport, ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }) })
        task.promise.catch(() => undefined).finally(() => { task = null })
        return () => { task?.cancel() }
    }, [pageProxy, zoom])

    const scrollRef = useCallback((node: HTMLDivElement | null) => {
        observer.current?.disconnect()
        observer.current = null
        if (node === null || typeof ResizeObserver === "undefined") return
        const measure = () => {
            const style = getComputedStyle(node)
            setBoxWidth(node.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight))
        }
        measure()
        observer.current = new ResizeObserver(measure)
        observer.current.observe(node)
    }, [])

    const goTo = (next: number) => {
        const total = document_?.numPages ?? 1
        const clamped = clampPage(next, total)
        setPage(clamped)
        onPageChange?.(clamped)
    }

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "touch") return
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const [a, b] = [...pointers.current.values()]
        if (pointers.current.size === 2 && a !== undefined && b !== undefined) pinch.current = { distance: pointerDistance(a, b), zoom }
    }
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!pointers.current.has(event.pointerId)) return
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const start = pinch.current
        const [a, b] = [...pointers.current.values()]
        if (start === null || a === undefined || b === undefined) return
        const next = pinchZoom(start.zoom, start.distance, pointerDistance(a, b))
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => { frame.current = null; setZoomChoice(next) })
    }
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        pointers.current.delete(event.pointerId)
        if (pointers.current.size < 2) pinch.current = null
    }

    const status: PdfViewerStatus = failed ? "error" : isLoading || document_ === null ? "loading" : "ready"
    const pageView = metrics === null ? undefined : (
        <div
            data-grammar-pdf-page="ready"
            style={{
                position: "relative",
                inlineSize: metrics.width * zoom,
                blockSize: metrics.height * zoom,
                marginInline: "auto",
                background: "var(--surface)",
                outline: "var(--grammar-hairline) solid var(--separator)",
            }}
        >
            <canvas ref={canvasRef} role="img" aria-label={`${ariaLabel}, ${labels.pageOf(page, document_?.numPages ?? 1)}`} style={{ display: "block", inlineSize: "100%", blockSize: "100%" }} />
            {highlightBoxes(highlights, page, metrics.view, items, zoom).map(({ highlight, index, box }) => {
                const press = onHighlightPress
                return (
                    <span
                        key={`${highlight.id}-${index}`}
                        data-grammar-pdf-highlight={highlight.id}
                        data-tone={highlight.tone ?? "warning"}
                        title={highlight.note}
                        {...(press === undefined || index > 0
                            ? { "aria-hidden": true }
                            : { role: "button", tabIndex: 0, "aria-label": highlight.note ?? highlight.id, onClick: () => press(highlight.id), onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); press(highlight.id) } } })}
                        style={{
                            position: "absolute",
                            insetInlineStart: box.left,
                            insetBlockStart: box.top,
                            inlineSize: box.width,
                            blockSize: box.height,
                            background: highlightGround(highlight.tone ?? "warning"),
                            mixBlendMode: "multiply",
                            borderRadius: "var(--grammar-radius-xs)",
                            cursor: press === undefined ? undefined : "pointer",
                        }}
                    />
                )
            })}
        </div>
    )

    return (
        <PdfViewerFrame
            status={status}
            ariaLabel={ariaLabel}
            labels={labels}
            page={page}
            total={document_?.numPages ?? 1}
            zoom={zoom}
            isFit={zoomChoice === "fit"}
            height={height}
            onPrevious={() => goTo(page - 1)}
            onNext={() => goTo(page + 1)}
            onZoomIn={() => setZoomChoice(zoomIn(zoom))}
            onZoomOut={() => setZoomChoice(zoomOut(zoom))}
            onFit={() => setZoomChoice("fit")}
            onDownload={() => { if (onDownload !== undefined) onDownload(); else saveDocument(source, fileName) }}
            onRetry={() => setAttempt((count) => count + 1)}
            {...(pageView === undefined ? {} : { pageView })}
            scrollRef={scrollRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        />
    )
}
