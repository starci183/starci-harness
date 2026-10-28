/**
 * Mermaid's `base` theme variables, resolved from the grammar root's semantic tokens. Mermaid derives shades from the
 * colours it is given, so it needs concrete colours: each token is resolved in the page (through a probe inside the
 * diagram, so family, theme and the caller's token overrides apply) and converted to hex through a 1px canvas, which
 * turns any CSS colour syntax (oklch, color-mix) into sRGB.
 */
export type MermaidThemeVariables = {
    readonly darkMode: boolean
    readonly fontFamily: string
    readonly fontSize: string
    readonly background: string
    readonly primaryColor: string
    readonly primaryTextColor: string
    readonly primaryBorderColor: string
    readonly secondaryColor: string
    readonly secondaryTextColor: string
    readonly secondaryBorderColor: string
    readonly tertiaryColor: string
    readonly tertiaryTextColor: string
    readonly tertiaryBorderColor: string
    readonly mainBkg: string
    readonly nodeBorder: string
    readonly textColor: string
    readonly titleColor: string
    readonly lineColor: string
    readonly edgeLabelBackground: string
    readonly clusterBkg: string
    readonly clusterBorder: string
    readonly noteBkgColor: string
    readonly noteTextColor: string
    readonly noteBorderColor: string
    readonly actorBkg: string
    readonly actorBorder: string
    readonly actorTextColor: string
    readonly signalColor: string
    readonly signalTextColor: string
}

/** Token, then the system colour used when the token resolves to nothing. */
const TOKENS = {
    surface: ["--surface", "Canvas"],
    surfaceSecondary: ["--surface-secondary", "Canvas"],
    foreground: ["--foreground", "CanvasText"],
    muted: ["--muted", "GrayText"],
    border: ["--border", "CanvasText"],
    separator: ["--separator", "GrayText"],
    accentSoft: ["--accent-soft", "Canvas"],
    accentSoftForeground: ["--accent-soft-foreground", "CanvasText"],
    accent: ["--accent", "Highlight"],
    warningSoft: ["--warning-soft", "Canvas"],
} as const

type TokenName = keyof typeof TOKENS

const hex = (channel: number) => channel.toString(16).padStart(2, "0")

/** Resolves every token to `#rrggbb` inside `anchor`, so the values are the ones the diagram's own root shows. */
const resolveTokens = (anchor: HTMLElement): Record<TokenName, string> => {
    const probe = document.createElement("span")
    probe.setAttribute("aria-hidden", "true")
    probe.style.cssText = "position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden"
    anchor.append(probe)
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
    const resolved = {} as Record<TokenName, string>
    for (const [name, [token, fallback]] of Object.entries(TOKENS) as Array<[TokenName, readonly [string, string]]>) {
        probe.style.color = `var(${token}, ${fallback})`
        const color = getComputedStyle(probe).color
        if (context === null) {
            resolved[name] = color
            continue
        }
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = "#000000"
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
        resolved[name] = `#${hex(red)}${hex(green)}${hex(blue)}`
    }
    probe.remove()
    return resolved
}

/** Relative luminance of a `#rrggbb` colour, for Mermaid's dark-mode switch. */
const luminance = (color: string) => {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
    if (match === null) return 1
    const [red, green, blue] = match.slice(1).map((part) => {
        const value = Number.parseInt(part, 16) / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** The theme variables of the diagram rendered inside `anchor`. */
export const resolveMermaidTheme = (anchor: HTMLElement): MermaidThemeVariables => {
    const token = resolveTokens(anchor)
    return {
        darkMode: luminance(token.surface) < 0.5,
        fontFamily: getComputedStyle(anchor).fontFamily,
        fontSize: "14px",
        background: token.surface,
        primaryColor: token.surfaceSecondary,
        primaryTextColor: token.foreground,
        primaryBorderColor: token.border,
        secondaryColor: token.accentSoft,
        secondaryTextColor: token.accentSoftForeground,
        secondaryBorderColor: token.accent,
        tertiaryColor: token.surface,
        tertiaryTextColor: token.foreground,
        tertiaryBorderColor: token.separator,
        mainBkg: token.surfaceSecondary,
        nodeBorder: token.border,
        textColor: token.foreground,
        titleColor: token.foreground,
        lineColor: token.muted,
        edgeLabelBackground: token.surface,
        clusterBkg: token.surface,
        clusterBorder: token.separator,
        noteBkgColor: token.warningSoft,
        noteTextColor: token.foreground,
        noteBorderColor: token.separator,
        actorBkg: token.surfaceSecondary,
        actorBorder: token.border,
        actorTextColor: token.foreground,
        signalColor: token.foreground,
        signalTextColor: token.foreground,
    }
}
