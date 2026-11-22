/**
 * Puts a rendered SVG on the Grammar tokens and makes it safe to inline: the colours become CSS variables of the page (`--surface`,
 * `--foreground`, `--muted`, `--border`), the font the page's sans (`--font-sans`), the ids are prefixed so two
 * figures on one page never share a marker, and nothing in it can run or fetch (no script, no event attribute, no foreignObject, no
 * external reference, no `@import`).
 */

/** The page tokens beautiful-mermaid's colour inputs read, under names of our own so the page's `--accent` never paints an arrow. */
const BEAUTIFUL_INPUTS: Readonly<Record<string, string>> = {
    "--bg": "var(--surface)",
    "--fg": "var(--foreground)",
    "--bm-line": "var(--muted)",
    "--bm-accent": "var(--muted)",
    "--bm-muted": "var(--muted)",
    "--bm-surface": "var(--surface)",
    "--bm-border": "var(--border)",
}

const FONT = "var(--font-sans, system-ui, sans-serif)"

/** Drops what could run or fetch. */
export const sanitizeSvg = (svg: string): string =>
    svg
        .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
        .replace(/@import\s+url\([^)]*\)\s*;?/gi, "")
        .replace(/@import[^;\n]*;?/gi, "")
        .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, "none")

/** Every `id` gets the figure's key in front, and every `#id` reference with it. */
export const prefixIds = (svg: string, prefix: string): string => {
    const ids = new Set<string>()
    for (const match of svg.matchAll(/\sid\s*=\s*"([^"]+)"/g)) if (match[1] !== undefined) ids.add(match[1])
    let out = svg
    for (const id of [...ids].sort((a, b) => b.length - a.length)) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        out = out
            .replace(new RegExp(`(\\sid\\s*=\\s*")${escaped}"`, "g"), `$1${prefix}-${id}"`)
            .replace(new RegExp(`url\\(#${escaped}\\)`, "g"), `url(#${prefix}-${id})`)
            .replace(new RegExp(`(href\\s*=\\s*")#${escaped}"`, "g"), `$1#${prefix}-${id}"`)
            .replace(new RegExp(`#${escaped}(?=[\\s{.,:>\\[])`, "g"), `#${prefix}-${id}`)
    }
    return out
}

/** The root `<svg>` scales to its frame: its fixed width and height go, the viewBox stays. */
const fluid = (svg: string, style: string): string =>
    svg.replace(/<svg\b([^>]*)>/, (_, attributes: string) => {
        const kept = attributes.replace(/\s(?:width|height)\s*=\s*"[^"]*"/g, "").replace(/\sstyle\s*=\s*"[^"]*"/, "")
        return `<svg${kept} style="${style}" role="img" focusable="false">`
    })

/** beautiful-mermaid's SVG on the Grammar tokens. */
export const recolorBeautiful = (svg: string, prefix: string): string => {
    const renamed = svg
        .replace(/var\(--(line|accent|muted|surface|border)\b/g, "var(--bm-$1")
        .replace(/font-family:\s*'[^']*'[^;]*;/g, `font-family: ${FONT};`)
        .replace(/\sfont-family="[^"]*"/g, "")
    const inputs = Object.entries(BEAUTIFUL_INPUTS)
        .map(([name, value]) => `${name}:${value}`)
        .join(";")
    return fluid(prefixIds(sanitizeSvg(renamed), prefix), `${inputs};max-width:100%;height:auto;background:transparent`)
}

/**
 * The sentinel colours the Mermaid fallback is themed with (Mermaid computes its palette, so it needs real colours), and the token
 * each one becomes in the SVG. Derived shades Mermaid mixes from them stay near their sentinel and read as the same neutral.
 */
export const MERMAID_SENTINELS: Readonly<Record<string, string>> = {
    "#fdfdfd": "var(--surface)",
    "#fcfcfc": "var(--default-soft, var(--surface))",
    "#1b1b1b": "var(--foreground)",
    "#7a7a7a": "var(--muted)",
    "#dcdcdc": "var(--border)",
}

/** The Mermaid fallback's SVG on the Grammar tokens. */
export const recolorMermaid = (svg: string, prefix: string): string => {
    let out = svg
    for (const [hex, token] of Object.entries(MERMAID_SENTINELS)) {
        const short = hex.toLowerCase()
        out = out.replace(new RegExp(short, "gi"), token)
    }
    out = out.replace(/font-family:\s*[^;"}]+/g, `font-family: ${FONT}`)
    return fluid(prefixIds(sanitizeSvg(out), prefix), "max-width:100%;height:auto;background:transparent")
}
