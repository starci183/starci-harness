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
    /** A pie's slices: the accent's soft ground, then the quiet grounds, parted by the surface; the words stay the foreground. */
    readonly pie1: string
    readonly pie2: string
    readonly pie3: string
    readonly pie4: string
    readonly pieStrokeColor: string
    readonly pieOuterStrokeColor: string
    readonly pieTitleTextColor: string
    readonly pieSectionTextColor: string
    readonly pieLegendTextColor: string
}

/** The HeroUI token each diagram colour reads. */
const TOKENS = {
    surface: "--surface",
    surfaceSecondary: "--surface-secondary",
    foreground: "--foreground",
    muted: "--muted",
    border: "--border",
    separator: "--separator",
    accentSoft: "--accent-soft",
    accentSoftForeground: "--accent-soft-foreground",
    accent: "--accent",
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
    for (const [name, token] of Object.entries(TOKENS) as Array<[TokenName, string]>) {
        probe.style.color = `var(${token})`
        const color = getComputedStyle(probe).color
        if (context === null) {
            resolved[name] = color
            continue
        }
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
        resolved[name] = `#${hex(red)}${hex(green)}${hex(blue)}`
    }
    probe.remove()
    return resolved
}

/** The label size of a drawing in px, the unit Mermaid takes: the caption role (12 / 16), so Mermaid lays its boxes out for the words the Grammar paints. */
const resolveTextSize = (anchor: HTMLElement): string => {
    const probe = document.createElement("span")
    probe.setAttribute("aria-hidden", "true")
    probe.style.cssText = "position:absolute;visibility:hidden;font-size:var(--grammar-type-caption-size)"
    anchor.append(probe)
    const size = getComputedStyle(probe).fontSize
    probe.remove()
    return size
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
        fontSize: resolveTextSize(anchor),
        background: token.surface,
        primaryColor: token.surface,
        primaryTextColor: token.foreground,
        primaryBorderColor: token.border,
        secondaryColor: token.accentSoft,
        secondaryTextColor: token.accentSoftForeground,
        secondaryBorderColor: token.accent,
        tertiaryColor: token.surface,
        tertiaryTextColor: token.foreground,
        tertiaryBorderColor: token.separator,
        mainBkg: token.surface,
        nodeBorder: token.border,
        textColor: token.foreground,
        titleColor: token.foreground,
        lineColor: token.foreground,
        edgeLabelBackground: token.surface,
        clusterBkg: token.surfaceSecondary,
        clusterBorder: token.separator,
        noteBkgColor: token.accentSoft,
        noteTextColor: token.accentSoftForeground,
        noteBorderColor: token.accentSoft,
        actorBkg: token.surface,
        actorBorder: token.border,
        actorTextColor: token.foreground,
        signalColor: token.foreground,
        signalTextColor: token.foreground,
        pie1: token.accentSoft,
        pie2: token.border,
        pie3: token.surfaceSecondary,
        pie4: token.separator,
        pieStrokeColor: token.surface,
        pieOuterStrokeColor: token.border,
        pieTitleTextColor: token.foreground,
        pieSectionTextColor: token.foreground,
        pieLegendTextColor: token.foreground,
    }
}
