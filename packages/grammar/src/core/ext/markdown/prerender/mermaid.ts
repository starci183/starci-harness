import { MERMAID_SENTINELS, recolorMermaid } from "./recolor.js"

const sentinel = (token: string): string => Object.entries(MERMAID_SENTINELS).find(([, value]) => value === token)?.[0] ?? "#7a7a7a"

/** Mermaid's theme for the fallback: the neo look on sentinel colours that `recolorMermaid` turns into the Grammar tokens. */
const THEME_VARIABLES = {
    background: sentinel("var(--surface)"),
    mainBkg: sentinel("var(--surface)"),
    primaryColor: sentinel("var(--surface)"),
    secondaryColor: sentinel("var(--default-soft, var(--surface))"),
    tertiaryColor: sentinel("var(--default-soft, var(--surface))"),
    clusterBkg: sentinel("var(--default-soft, var(--surface))"),
    primaryTextColor: sentinel("var(--foreground)"),
    textColor: sentinel("var(--foreground)"),
    titleColor: sentinel("var(--foreground)"),
    nodeTextColor: sentinel("var(--foreground)"),
    lineColor: sentinel("var(--muted)"),
    primaryBorderColor: sentinel("var(--border)"),
    nodeBorder: sentinel("var(--border)"),
    clusterBorder: sentinel("var(--border)"),
    fontFamily: "system-ui, sans-serif",
    fontSize: "14px",
}

interface MermaidApi {
    readonly initialize: (config: Record<string, unknown>) => void
    readonly render: (id: string, text: string) => Promise<{ readonly svg: string }>
}

let ready: Promise<MermaidApi> | undefined

const load = (): Promise<MermaidApi> => {
    ready ??= (async () => {
        // The Grammar's own Mermaid (its dependency, the one MermaidDiagram draws with): no second Mermaid and no ELK loader in the package.
        const { default: mermaid } = await import("mermaid")
        const api = mermaid as unknown as MermaidApi
        api.initialize({ startOnLoad: false, securityLevel: "strict", look: "neo", theme: "base", themeVariables: THEME_VARIABLES, htmlLabels: false, flowchart: { htmlLabels: false } })
        return api
    })()
    return ready
}

let counter = 0

/**
 * The fallback renderer: the Grammar's Mermaid in its neo look, recoloured onto the Grammar tokens. It needs a DOM (a browser,
 * or an importer that runs in one); `prerender` calls it only where `document` exists, and `<Markdown>` calls it in the browser for
 * a figure that was not prerendered.
 */
export const renderWithMermaid = async (code: string, key: string): Promise<string> => {
    if (typeof document === "undefined") throw new Error("the Mermaid fallback needs a DOM")
    const api = await load()
    counter += 1
    const { svg } = await api.render(`${key}-render-${String(counter)}`, code)
    return recolorMermaid(svg, key)
}
