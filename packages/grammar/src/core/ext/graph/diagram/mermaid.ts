/**
 * The Grammar's Mermaid (its dependency), loaded on the first diagram and never on the server: it parses every diagram (the canvas draws a flowchart,
 * a state diagram and a sequence itself) and draws only the kinds the canvas does not, as one SVG in the Grammar's diagram theme.
 */
import { diagramOf, type MermaidTone, type ParsedDiagram } from "./model.js"
import type { MermaidThemeVariables } from "./theme.js"

interface MermaidApi {
    readonly initialize: (config: Record<string, unknown>) => void
    readonly parse: (text: string) => Promise<unknown>
    readonly render: (id: string, text: string) => Promise<{ readonly svg: string }>
    readonly mermaidAPI: { readonly getDiagramFromText: (text: string) => Promise<{ readonly type: string; readonly db: unknown }> }
}

let mermaidModule: Promise<MermaidApi> | null = null
const loadMermaid = (): Promise<MermaidApi> => {
    mermaidModule ??= import("mermaid").then((module) => module.default as unknown as MermaidApi)
    return mermaidModule
}

let queue: Promise<unknown> = Promise.resolve()
/**
 * Mermaid's configuration and each kind's database are globals: a parse fills the database the next parse of the same kind clears, so every Mermaid
 * call of a page runs one after another, and the drawing is read out of the database before the next one starts.
 */
const serially = <T>(work: (mermaid: MermaidApi) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => work(await loadMermaid()))
    queue = run.catch(() => undefined)
    return run
}

const BASE = { startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, htmlLabels: false } as const

/** Parses the source with Mermaid's own parser (a source it refuses throws) and maps its database to what the canvas draws. */
export const parseDiagram = (source: string, tones?: Readonly<Record<string, MermaidTone>>, messageTones?: Readonly<Record<number, MermaidTone>>, edgeTones?: Readonly<Record<number, MermaidTone>>): Promise<ParsedDiagram> =>
    serially(async (mermaid) => {
        mermaid.initialize({ ...BASE })
        await mermaid.parse(source)
        const parsed = await mermaid.mermaidAPI.getDiagramFromText(source)
        return diagramOf(parsed, tones, messageTones, edgeTones)
    })

/** Mermaid's own SVG of a kind the canvas does not lay out (gantt, pie, journey, ...), themed from the Grammar's tokens. */
export const renderSvg = (id: string, source: string, theme: MermaidThemeVariables): Promise<string> =>
    serially(async (mermaid) => {
        mermaid.initialize({
            ...BASE,
            theme: "base",
            darkMode: theme.darkMode,
            fontFamily: theme.fontFamily,
            fontSize: Number.parseFloat(theme.fontSize),
            themeVariables: theme,
        })
        try {
            const { svg } = await mermaid.render(id, source)
            return svg
        } finally {
            // Mermaid draws in a temporary node of the body; a failed render can leave it behind.
            document.getElementById(`d${id}`)?.remove()
        }
    })

/** The SVG Mermaid returns, as a node of this document, with its natural size; null when the text is not one `<svg>` element. */
export const svgNode = (svg: string): { readonly node: SVGSVGElement; readonly width: number; readonly height: number } | null => {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
    const root = parsed.documentElement
    if (root.nodeName.toLowerCase() !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) return null
    const node = document.importNode(root, true) as unknown as SVGSVGElement
    node.setAttribute("aria-hidden", "true")
    node.setAttribute("data-grammar-mermaid-svg", node.getAttribute("aria-roledescription") ?? "diagram")
    // Mermaid's own sheet sinks to the lowest Grammar layer, so every rule of the Grammar's diagram theme wins over it without `!important`.
    for (const style of node.querySelectorAll("style")) style.textContent = `@layer starci-grammar-theme { ${style.textContent ?? ""} }`
    // A `default`, `light` or `dark` class is a vendor theme scope that would reset the tokens inside the drawing to the light theme.
    for (const scoped of node.querySelectorAll(".default, .light, .dark")) scoped.classList.remove("default", "light", "dark")
    const box = (node.getAttribute("viewBox") ?? "").split(/[\s,]+/u).map(Number)
    const width = box[2] !== undefined && Number.isFinite(box[2]) && box[2] > 0 ? box[2] : 480
    const height = box[3] !== undefined && Number.isFinite(box[3]) && box[3] > 0 ? box[3] : 240
    node.removeAttribute("style")
    node.setAttribute("width", String(width))
    node.setAttribute("height", String(height))
    return { node, width, height }
}
