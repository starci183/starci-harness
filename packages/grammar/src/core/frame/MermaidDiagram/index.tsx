"use client"

import { ArrowsPointingOutIcon } from "@heroicons/react/24/outline"
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react"
import { Alert } from "../../composite/Alert/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { Dialog } from "../Dialog/index.js"
import { NARROW_WIDTH, isSequence, sequenceSteps, stackedFlowchart } from "./narrow.js"
import { ZoomView, type MermaidZoomLabels } from "./ZoomView.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import { FencedCodeBlock } from "../MarkdownArticle/index.js"
import { resolveMermaidTheme, type MermaidThemeVariables } from "./theme.js"
import type { NoChildren } from "../../tier.js"

/** The canvas box every state reserves: `sm` 16rem, `md` 24rem, `lg` 32rem. */
export type MermaidDiagramHeight = "sm" | "md" | "lg"

/** A tone a step of the drawing takes, in the Grammar's tokens: `danger` the faulty step, `success` the fix, `accent` a part the change touches. */
export type MermaidTone = "danger" | "success" | "accent"

export type { MermaidZoomLabels } from "./ZoomView.js"

export type MermaidDiagramProps = NoChildren & {
    /** The Mermaid text, as written in the article's fence (without the fence itself). */
    readonly source: string
    /** Names the diagram for assistive technology, e.g. "Request flow". The drawing is one image with this name. */
    readonly label: string
    /**
     * The least height of the canvas, kept by the loading, ready and error states alike so the page does not jump when
     * the drawing arrives. A taller drawing grows the canvas; a wider one scrolls inline. Default `sm`.
     */
    readonly height?: MermaidDiagramHeight
    /** The error title shown in the region when the source cannot be drawn; the source follows it as code. */
    readonly errorTitle?: string
    /** Accessible name of the source code block in the error state. Default: `${label} source`. */
    readonly sourceLabel?: string
    /** Unresolved source (STATE-8): the frame at its height with a Skeleton block, Mermaid not loaded, `aria-busy`. */
    readonly isLoading?: boolean
    /**
     * The tone of a flowchart node, by its id (`{ B: "danger", C: "success" }`). The source may say the same with Mermaid's own
     * `class B danger` (a `classDef` is optional and its colours are ignored): either way the node is painted in the tone's soft
     * pair and edge from the Grammar's tokens, never a colour written in the source.
     */
    readonly tones?: Readonly<Record<string, MermaidTone>>
    /**
     * The tone of a sequence diagram's message, by its place in the source counted from 1 (`{ 5: "danger" }`: the fifth arrow is the
     * faulty step). Its line, head and words take the tone, in the drawing and in the phone's numbered list alike.
     */
    readonly messageTones?: Readonly<Record<number, MermaidTone>>
    /** One line under the drawing, in the caption role, saying what to look at. */
    readonly caption?: string
    /**
     * The names of the full-screen view (a press on the drawing or its expand control opens it: pan by dragging or the arrow keys,
     * zoom by the wheel, a pinch, + and -, 0 resets). English defaults.
     */
    readonly zoomLabels?: Partial<MermaidZoomLabels>
}

const ZOOM_LABELS: MermaidZoomLabels = { open: "Open full screen", close: "Close", zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Reset zoom" }
const TONES: readonly MermaidTone[] = ["danger", "success", "accent"]

/**
 * The source id of a drawn node. Mermaid names it `<svg id>-flowchart-<id>-<n>` in a flowchart and `<svg id>-state-<id>-<n>` in a state
 * diagram (older releases drop the svg id).
 */
const nodeId = (node: SVGGElement): string => /(?:^|-)(?:flowchart|state)-(.+)-\d+$/.exec(node.id)?.[1] ?? node.id

/** Paints a message of a sequence: its line, its words and a head of its own (the shared head would stay the foreground). */
const toneMessage = (svg: SVGSVGElement, line: SVGElement, text: SVGElement | undefined, tone: MermaidTone) => {
    line.setAttribute("data-grammar-mermaid-message-tone", tone)
    text?.setAttribute("data-grammar-mermaid-message-tone", tone)
    const head = /url\(["']?#([^"')]+)["']?\)/.exec(line.getAttribute("marker-end") ?? "")?.[1]
    const marker = head === undefined ? null : svg.querySelector<SVGMarkerElement>(`marker[id="${head}"]`)
    if (marker === null || head === undefined) return
    const id = `${head}-${tone}`
    if (svg.querySelector(`marker[id="${id}"]`) === null) {
        const copy = marker.cloneNode(true) as SVGMarkerElement
        copy.id = id
        copy.setAttribute("data-grammar-mermaid-message-tone", tone)
        marker.after(copy)
    }
    line.setAttribute("marker-end", `url(#${id})`)
}

/**
 * Marks every toned part of a drawing: a flowchart or state node by the `tones` map or by a `class` the source gave it, a sequence
 * message by `messageTones` (its place among the arrows, from 1).
 */
const markTones = (svg: SVGSVGElement, tones: Readonly<Record<string, MermaidTone>> | undefined, messageTones: Readonly<Record<number, MermaidTone>> | undefined) => {
    for (const node of svg.querySelectorAll<SVGGElement>("g.node")) {
        const tone = tones?.[nodeId(node)] ?? TONES.find((name) => node.classList.contains(name))
        if (tone !== undefined) node.setAttribute("data-grammar-mermaid-tone", tone)
    }
    if (messageTones === undefined) return
    const lines = [...svg.querySelectorAll<SVGElement>(":is(line, path):is(.messageLine0, .messageLine1)")]
    const texts = [...svg.querySelectorAll<SVGElement>("text.messageText")]
    lines.forEach((line, index) => {
        const tone = messageTones[index + 1]
        if (tone !== undefined) toneMessage(svg, line, texts[index], tone)
    })
}

/** Rounds every note of a sequence into a pill: its corners are half its height. */
const roundNotes = (svg: SVGSVGElement) => {
    for (const note of svg.querySelectorAll<SVGRectElement>("rect.note")) {
        const height = Number.parseFloat(note.getAttribute("height") ?? "")
        if (Number.isFinite(height)) {
            note.setAttribute("rx", String(height / 2))
            note.setAttribute("ry", String(height / 2))
        }
    }
}

/** The width of an element, followed as it changes. */
const useWidth = (target: RefObject<HTMLElement | null>): number | null => {
    const [width, setWidth] = useState<number | null>(null)
    useEffect(() => {
        const element = target.current
        if (element === null || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => { if (entry !== undefined) setWidth(entry.contentRect.width) })
        observer.observe(element)
        return () => { observer.disconnect() }
    }, [target])
    return width
}

/** A sequence diagram on a phone: its messages as a numbered list, who to whom, then what. */
const SequenceList = ({ source, label, tones }: { readonly source: string; readonly label: string; readonly tones: Readonly<Record<number, MermaidTone>> | undefined }) => (
    <ol className="starci-core-mermaid-steps" data-grammar-mermaid-steps="true" aria-label={label}>
        {sequenceSteps(source).map((step, index) => (
            <li
                key={`${String(index)}-${step.from}-${step.to}`}
                className="starci-core-mermaid-step"
                data-grammar-mermaid-reply={step.isReply ? "true" : "false"}
                {...(tones?.[index + 1] === undefined ? {} : { "data-grammar-mermaid-tone": tones[index + 1] })}
            >
                <span className="starci-core-mermaid-step-route">{step.from}<Icon source={glyphSource("arrow-end")} usage="text" />{step.to}</span>
                <span className="starci-core-mermaid-step-text">{step.text}</span>
            </li>
        ))}
    </ol>
)

type Drawing =
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly svg: string }
    | { readonly status: "error"; readonly message: string }

type MermaidApi = {
    readonly initialize: (config: Record<string, unknown>) => void
    readonly render: (id: string, text: string) => Promise<{ readonly svg: string }>
}

let mermaidModule: Promise<MermaidApi> | null = null
/** Mermaid is loaded on the first diagram that needs it, once per page, and never on the server. */
const loadMermaid = (): Promise<MermaidApi> => {
    mermaidModule ??= import("mermaid").then((module) => module.default as unknown as MermaidApi)
    return mermaidModule
}

let queue: Promise<unknown> = Promise.resolve()
/**
 * Mermaid's configuration is one global, so each diagram initialises it with its own theme and renders before the next
 * diagram may: the renders of one page run one after another.
 */
const renderSerially = (id: string, source: string, theme: MermaidThemeVariables): Promise<string> => {
    const run = queue.then(async () => {
        const mermaid = await loadMermaid()
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            // A refused source throws and leaves nothing in the document: the error state is the component's, in its region.
            suppressErrorRendering: true,
            theme: "base",
            darkMode: theme.darkMode,
            fontFamily: theme.fontFamily,
            // The top-level size is the one every kind lays its words out at (a sequence's per-part sizes yield to it).
            fontSize: Number.parseFloat(theme.fontSize),
            themeVariables: theme,
            htmlLabels: false,
            // The Grammar's layout of each kind (0.55.1, owner 2026-11-23: "giờ hơi xấu"): room around the words, no mirrored
            // participants at the foot, wrapped long messages, gentle curves; the paint is the Grammar's sheet (components-navigation.css).
            flowchart: { htmlLabels: false, curve: "basis", padding: 14, nodeSpacing: 40, rankSpacing: 48, diagramPadding: 8, useMaxWidth: true },
            sequence: {
                mirrorActors: false,
                actorFontWeight: 500,
                width: 140,
                height: 40,
                actorMargin: 56,
                boxMargin: 8,
                boxTextMargin: 6,
                noteMargin: 10,
                messageMargin: 36,
                diagramMarginX: 8,
                diagramMarginY: 8,
                useMaxWidth: true,
            },
            state: { nodeSpacing: 56, rankSpacing: 56, useMaxWidth: true },
        })
        try {
            const { svg } = await mermaid.render(id, source)
            return svg
        } finally {
            // Mermaid draws in a temporary node of the body; a failed render can leave it behind.
            document.getElementById(`d${id}`)?.remove()
        }
    })
    queue = run.catch(() => undefined)
    return run
}

/** The SVG Mermaid returns, as a node of this document; null when the text is not one `<svg>` element. */
const svgNode = (svg: string): SVGSVGElement | null => {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
    const root = parsed.documentElement
    if (root.nodeName.toLowerCase() !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) return null
    const node = document.importNode(root, true) as unknown as SVGSVGElement
    node.setAttribute("aria-hidden", "true")
    node.setAttribute("data-grammar-mermaid-svg", node.getAttribute("aria-roledescription") ?? "diagram")
    node.removeAttribute("height")
    // Mermaid's own sheet sinks to the lowest Grammar layer, so every rule of the Grammar's diagram theme wins over it without
    // `!important`; what the Grammar does not restyle still reads Mermaid's rules, themed from the tokens.
    for (const style of node.querySelectorAll("style")) style.textContent = `@layer starci-grammar-theme { ${style.textContent ?? ""} }`
    // Mermaid gives every flowchart node the class `default`, and a source may name a class `light` or `dark`: those are the vendor's
    // theme scopes, which would reset the tokens inside the node to the light theme (a white box in a dark page). They are dropped.
    for (const scoped of node.querySelectorAll(".default, .light, .dark")) scoped.classList.remove("default", "light", "dark")
    roundNotes(node)
    return node
}

/** Re-renders when the theme changes: the root's attributes (family, token overrides), the page's mode class or the system scheme. */
const useThemeRevision = (anchor: RefObject<HTMLElement | null>) => {
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        const root = anchor.current?.closest(".grammar-common-root") ?? null
        const bump = () => setRevision((value) => value + 1)
        const scheme = window.matchMedia("(prefers-color-scheme: dark)")
        scheme.addEventListener("change", bump)
        const observer = root === null ? null : new MutationObserver(bump)
        observer?.observe(root as Element, { attributes: true, attributeFilter: ["data-grammar-family", "style", "class"] })
        const page = new MutationObserver(bump)
        page.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] })
        return () => {
            scheme.removeEventListener("change", bump)
            observer?.disconnect()
            page.disconnect()
        }
    }, [anchor])
    return revision
}

/**
 * A Mermaid diagram drawn client-side in the grammar's theme: Mermaid (`mermaid`) is imported lazily on the first
 * diagram, initialised with colours resolved from the root's semantic tokens (surface, foreground, separator, accent),
 * and its SVG is placed as one named image. Loading keeps the canvas box with a Skeleton; a source Mermaid refuses is
 * an error inside the same region, the title then the source as code, so the reader still has the text.
 * Contract: overflow OVERFLOW-4; loading and failure keep the anatomy STATE-8.
 */
export const MermaidDiagram = ({
    source,
    label,
    height = "sm",
    errorTitle = "This diagram could not be drawn.",
    sourceLabel,
    isLoading = false,
    tones,
    messageTones,
    caption,
    zoomLabels,
}: MermaidDiagramProps) => {
    const frame = useRef<HTMLElement | null>(null)
    const canvas = useRef<HTMLDivElement | null>(null)
    const [drawing, setDrawing] = useState<Drawing>({ status: "loading" })
    const [isZoomOpen, setZoomOpen] = useState(false)
    const revision = useThemeRevision(frame)
    const width = useWidth(frame)
    const isNarrow = width !== null && width < NARROW_WIDTH
    const asList = isNarrow && isSequence(source)
    const drawn = isNarrow ? stackedFlowchart(source) : source
    const labels = { ...ZOOM_LABELS, ...zoomLabels }
    const id = `grammar-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`

    useEffect(() => {
        if (isLoading || asList || frame.current === null) return
        let isCurrent = true
        setDrawing({ status: "loading" })
        const theme = resolveMermaidTheme(frame.current)
        renderSerially(`${id}-${revision}`, drawn, theme).then(
            (svg) => { if (isCurrent) setDrawing(svgNode(svg) === null ? { status: "error", message: "not an svg" } : { status: "ready", svg }) },
            (error: unknown) => { if (isCurrent) setDrawing({ status: "error", message: error instanceof Error ? error.message : String(error) }) },
        )
        return () => { isCurrent = false }
    }, [asList, drawn, id, isLoading, revision])

    const place = useCallback((host: HTMLElement) => {
        if (drawing.status !== "ready") return
        const node = svgNode(drawing.svg)
        if (node === null) return
        markTones(node, tones, messageTones)
        host.replaceChildren(node)
    }, [drawing, messageTones, tones])

    useEffect(() => { if (canvas.current !== null) place(canvas.current) }, [place])

    const state = isLoading ? "loading" : asList ? "ready" : drawing.status
    return (
        <figure
            ref={frame}
            className="starci-core-mermaid-diagram"
            data-component="MermaidDiagram"
            data-contract={state === "ready" ? "OVERFLOW-4" : "OVERFLOW-4 STATE-8"}
            data-grammar-mermaid-height={height}
            data-grammar-mermaid-state={state}
            {...(asList ? { "data-grammar-mermaid-fallback": "steps" } : isNarrow && drawn !== source ? { "data-grammar-mermaid-fallback": "stacked" } : {})}
            data-tier="frame"
            aria-label={label}
            {...(state === "loading" ? { "aria-busy": true, "data-loading": "true" } : {})}
        >
            {state === "error" ? (
                <div className="starci-core-mermaid-diagram-error" data-grammar-mermaid-error="true">
                    <Alert tone="negative" title={errorTitle} />
                    <FencedCodeBlock language="mermaid" label={sourceLabel ?? `${label} source`} code={source} />
                </div>
            ) : (
                // A wide drawing scrolls inline in this frame: a named Tab stop, since the drawing holds nothing focusable.
                <div
                    className="starci-core-mermaid-diagram-canvas"
                    data-grammar-mermaid-canvas="true"
                    {...(state === "ready" ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
                >
                    {state === "loading" ? <Skeleton shape="rect" /> : asList ? <SequenceList source={source} label={label} tones={messageTones} /> : (
                        <div ref={canvas} className="starci-core-mermaid-diagram-drawing" role="img" aria-label={label} onClick={() => setZoomOpen(true)} />
                    )}
                </div>
            )}
            {state === "ready" && !asList ? (
                <span className="starci-core-mermaid-diagram-expand">
                    <IconButton size="sm" variant="border" label={labels.open} source={ArrowsPointingOutIcon} onPress={() => setZoomOpen(true)} />
                </span>
            ) : null}
            {caption === undefined ? null : <figcaption className="starci-core-mermaid-diagram-caption">{caption}</figcaption>}
            {isZoomOpen ? (
                <Dialog title={label} size="full" closeLabel={labels.close} isOpen onOpenChange={setZoomOpen}>
                    <ZoomView label={label} labels={labels} drawing={place} />
                </Dialog>
            ) : null}
        </figure>
    )
}
