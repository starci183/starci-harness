import { renderMermaidSVGAsync } from "beautiful-mermaid"
import { parse } from "../parse.js"
import { childBlocks } from "../tree.js"
import type { Block, Diagram, Diagrams, Issue, MarkdownTree, MermaidBlock } from "../types.js"
import { renderWithMermaid } from "./mermaid.js"
import { recolorBeautiful } from "./recolor.js"

export { recolorBeautiful, recolorMermaid, sanitizeSvg, prefixIds } from "./recolor.js"
export { renderWithMermaid } from "./mermaid.js"

export interface PrerenderOptions {
    /**
     * The renderer used when beautiful-mermaid cannot draw a diagram (a type it does not ship). Default: the Grammar's Mermaid (neo look) where a
     * DOM exists, else none (the figure is left to the browser fallback of `<Markdown>` and reported `MD_MERMAID_FALLBACK`).
     */
    readonly fallback?: ((code: string, key: string) => Promise<string>) | null
}

export interface PrerenderResult {
    readonly diagrams: Diagrams
    readonly issues: readonly Issue[]
}

const at = (node: MermaidBlock): Pick<Issue, "line" | "column"> => (node.at === undefined ? {} : { line: node.at.line, column: node.at.column })

/** Every mermaid figure of a tree, depth first. */
export const mermaidBlocks = (blocks: readonly Block[]): MermaidBlock[] => blocks.flatMap((node) => (node.type === "mermaid" ? [node] : mermaidBlocks(childBlocks(node))))

/** beautiful-mermaid, recoloured; it runs in Node with no DOM. */
export const renderBeautiful = async (code: string, key: string): Promise<string> => {
    const svg = await renderMermaidSVGAsync(code, { bg: "#ffffff", fg: "#27272a", font: "system-ui", transparent: true, padding: 16 })
    return recolorBeautiful(svg, key)
}

const defaultFallback = (code: string, key: string): Promise<string> => renderWithMermaid(code, key)

/**
 * Draws every mermaid figure of a text as SVG at import time: beautiful-mermaid first, the fallback (the Grammar's Mermaid (neo look)) when it
 * cannot. The SVG is recoloured onto the Grammar tokens (the page's sans, a hairline, the surface) and stored by `MermaidBlock.key`;
 * an importer keeps `diagrams` beside the text and passes them to `<Markdown diagrams>`.
 */
export const prerender = async (input: string | MarkdownTree, options: PrerenderOptions = {}): Promise<PrerenderResult> => {
    const tree = typeof input === "string" ? parse(input) : input
    const fallback = options.fallback === undefined ? (typeof document === "undefined" ? null : defaultFallback) : options.fallback
    const diagrams: Record<string, Diagram> = {}
    const issues: Issue[] = []
    for (const node of mermaidBlocks(tree.children)) {
        if (diagrams[node.key] !== undefined) continue
        try {
            diagrams[node.key] = { svg: await renderBeautiful(node.code, node.key), renderer: "beautiful-mermaid" }
            continue
        } catch (error) {
            if (fallback === null) {
                issues.push({ code: "MD_MERMAID_FALLBACK", severity: "warning", message: `beautiful-mermaid cannot draw this figure (${String(error)}); it is drawn in the browser by Mermaid`, ...at(node) })
                continue
            }
        }
        try {
            diagrams[node.key] = { svg: await fallback(node.code, node.key), renderer: "mermaid" }
            issues.push({ code: "MD_MERMAID_FALLBACK", severity: "warning", message: "beautiful-mermaid cannot draw this figure; Mermaid drew it", ...at(node) })
        } catch (error) {
            issues.push({ code: "MD_MERMAID_INVALID", severity: "error", message: `neither renderer can draw this figure: ${String(error)}`, ...at(node) })
        }
    }
    return { diagrams, issues }
}
