"use client"

import { useEffect, useId, useRef, useState, type RefObject } from "react"
import { Alert } from "../../composite/Alert/index.js"
import { Skeleton } from "../../primitive/Skeleton/index.js"
import { FencedCodeBlock } from "../MarkdownArticle/index.js"
import { resolveMermaidTheme, type MermaidThemeVariables } from "./theme.js"

/** The canvas box every state reserves: `sm` 16rem, `md` 24rem, `lg` 32rem (the FlowGraph heights). */
export type MermaidDiagramHeight = "sm" | "md" | "lg"

export type MermaidDiagramProps = {
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
    readonly isSkeleton?: boolean
    /** Layout only. */
    readonly className?: string
}

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
            themeVariables: theme,
            htmlLabels: false,
            flowchart: { htmlLabels: false },
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
    node.removeAttribute("height")
    return node
}

/** Re-renders when the root's theme changes: its attributes (theme, family, token overrides) or the system scheme. */
const useThemeRevision = (anchor: RefObject<HTMLElement | null>) => {
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        const root = anchor.current?.closest(".grammar-common-root") ?? null
        const bump = () => setRevision((value) => value + 1)
        const scheme = window.matchMedia("(prefers-color-scheme: dark)")
        scheme.addEventListener("change", bump)
        const observer = root === null ? null : new MutationObserver(bump)
        observer?.observe(root as Element, { attributes: true, attributeFilter: ["data-grammar-theme", "data-grammar-family", "style", "class"] })
        return () => {
            scheme.removeEventListener("change", bump)
            observer?.disconnect()
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
    isSkeleton = false,
    className,
}: MermaidDiagramProps) => {
    const frame = useRef<HTMLElement | null>(null)
    const canvas = useRef<HTMLDivElement | null>(null)
    const [drawing, setDrawing] = useState<Drawing>({ status: "loading" })
    const revision = useThemeRevision(frame)
    const id = `grammar-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`

    useEffect(() => {
        if (isSkeleton || frame.current === null) return
        let isCurrent = true
        setDrawing({ status: "loading" })
        const theme = resolveMermaidTheme(frame.current)
        renderSerially(`${id}-${revision}`, source, theme).then(
            (svg) => { if (isCurrent) setDrawing(svgNode(svg) === null ? { status: "error", message: "not an svg" } : { status: "ready", svg }) },
            (error: unknown) => { if (isCurrent) setDrawing({ status: "error", message: error instanceof Error ? error.message : String(error) }) },
        )
        return () => { isCurrent = false }
    }, [id, isSkeleton, revision, source])

    useEffect(() => {
        if (drawing.status !== "ready" || canvas.current === null) return
        const node = svgNode(drawing.svg)
        if (node !== null) canvas.current.replaceChildren(node)
    }, [drawing])

    const state = isSkeleton ? "loading" : drawing.status
    return (
        <figure
            ref={frame}
            className={["starci-core-mermaid-diagram", className].filter(Boolean).join(" ")}
            data-component="MermaidDiagram"
            data-contract={state === "ready" ? "OVERFLOW-4" : "OVERFLOW-4 STATE-8"}
            data-grammar-mermaid-height={height}
            data-grammar-mermaid-state={state}
            data-tier="branch"
            aria-label={label}
            {...(state === "loading" ? { "aria-busy": true, "data-loading": "true" } : {})}
        >
            {state === "error" ? (
                <div className="starci-core-mermaid-diagram-error" data-grammar-mermaid-error="true">
                    <Alert tone="negative" appearance="soft" title={errorTitle} />
                    <FencedCodeBlock language="mermaid" label={sourceLabel ?? `${label} source`} code={source} />
                </div>
            ) : (
                // A wide drawing scrolls inline in this frame: a named Tab stop, since the drawing holds nothing focusable.
                <div
                    className="starci-core-mermaid-diagram-canvas"
                    data-grammar-mermaid-canvas="true"
                    {...(state === "ready" ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
                >
                    {state === "loading" ? <Skeleton shape="rect" /> : <div ref={canvas} className="starci-core-mermaid-diagram-drawing" role="img" aria-label={label} />}
                </div>
            )}
        </figure>
    )
}
