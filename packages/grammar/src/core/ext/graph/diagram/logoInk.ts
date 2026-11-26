/**
 * The colour a built-in tech logo is drawn in (pure). A logo fills with its brand's own hex (simple-icons' `hex`, `TECH_ICON_HEX`) when that hex stands
 * out from the chip it sits on, in the theme in force: a WCAG 2 contrast of at least `LOGO_CONTRAST` (3:1, the non-text contrast of a graphic). Under it
 * (Express and Next.js black on a dark chip, React and JavaScript pale on a light one) the logo falls back to the node's ink, `currentColor`, so a mark is
 * never lost on its own background. The chip's colour is read from the page (`getComputedStyle` of a probe chip), so every theme and family is judged
 * on the colour it really paints.
 */

export type Rgb = readonly [number, number, number]

/** The least contrast a brand colour keeps against its chip before the logo falls back to the ink. */
export const LOGO_CONTRAST = 3

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const linearToSrgb = (value: number): number => {
    const v = clamp01(value)
    return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

const srgbToLinear = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

/** sRGB (0 to 255) from OKLab. */
const oklabToRgb = (l: number, a: number, b: number): Rgb => {
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    const linear = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
    return [linearToSrgb(linear[0] ?? 0) * 255, linearToSrgb(linear[1] ?? 0) * 255, linearToSrgb(linear[2] ?? 0) * 255]
}

/** A CSS number that may be a percentage of `whole`. */
const amount = (text: string | undefined, whole: number): number => {
    if (text === undefined || text === "none") return 0
    return text.endsWith("%") ? (Number.parseFloat(text) / 100) * whole : Number.parseFloat(text)
}

/** The channels of a CSS colour function, its alpha dropped (`rgb(1 2 3 / 50%)`, `rgba(1, 2, 3, 0.5)`, `oklab(0.5 0.1 0)`). */
const channels = (inside: string): readonly string[] =>
    inside
        .split("/")[0]
        ?.trim()
        .split(/[\s,]+/u)
        .filter((part) => part !== "") ?? []

/**
 * A CSS colour as sRGB (0 to 255), or null when it cannot be read: `#rgb`, `#rrggbb` (and their alpha forms), `rgb()` and `rgba()`, `color(srgb …)` and
 * `color(srgb-linear …)`, `oklab()` and `oklch()`: the forms a browser's computed style gives for the Grammar's tokens and their `color-mix`.
 */
export const parseCssColor = (text: string): Rgb | null => {
    const value = text.trim().toLowerCase()
    const hex = /^#([0-9a-f]{3,8})$/u.exec(value)?.[1]
    if (hex !== undefined) {
        const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex
        if (full.length !== 6 && full.length !== 8) return null
        return [Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16)]
    }
    const call = /^([a-z-]+)\((.*)\)$/u.exec(value)
    if (call === null) return null
    const [, name, inside = ""] = call
    const parts = channels(inside)
    if (name === "rgb" || name === "rgba") {
        if (parts.length < 3) return null
        return [amount(parts[0], 255), amount(parts[1], 255), amount(parts[2], 255)]
    }
    if (name === "color") {
        const [space, r, g, b] = parts
        if (r === undefined || g === undefined || b === undefined) return null
        if (space === "srgb") return [amount(r, 1) * 255, amount(g, 1) * 255, amount(b, 1) * 255]
        if (space === "srgb-linear") return [linearToSrgb(amount(r, 1)) * 255, linearToSrgb(amount(g, 1)) * 255, linearToSrgb(amount(b, 1)) * 255]
        return null
    }
    if (name === "oklab") {
        if (parts.length < 3) return null
        return oklabToRgb(amount(parts[0], 1), amount(parts[1], 0.4), amount(parts[2], 0.4))
    }
    if (name === "oklch") {
        if (parts.length < 3) return null
        const chroma = amount(parts[1], 0.4)
        const hue = (Number.parseFloat(parts[2] ?? "0") * Math.PI) / 180
        return oklabToRgb(amount(parts[0], 1), chroma * Math.cos(hue), chroma * Math.sin(hue))
    }
    return null
}

/** The relative luminance of an sRGB colour (WCAG 2). */
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * srgbToLinear(clamp01(r / 255)) + 0.7152 * srgbToLinear(clamp01(g / 255)) + 0.0722 * srgbToLinear(clamp01(b / 255))

/** The WCAG 2 contrast ratio of two colours, 1 to 21. */
export const contrastRatio = (one: Rgb, two: Rgb): number => {
    const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a) as [number, number]
    return (light + 0.05) / (dark + 0.05)
}

/**
 * The fill of a built-in logo on a chip of colour `chip`: its brand hex (`#4169E1`) when it keeps `LOGO_CONTRAST` against the chip, else undefined, the
 * node's ink (`currentColor`). Undefined too while the chip's colour is unknown (before the canvas is measured), so a logo never flashes a colour it
 * would not keep.
 */
export const logoFill = (hex: string | undefined, chip: Rgb | null): string | undefined => {
    if (hex === undefined || chip === null) return undefined
    const brand = parseCssColor(hex.startsWith("#") ? hex : `#${hex}`)
    if (brand === null) return undefined
    return contrastRatio(brand, chip) >= LOGO_CONTRAST ? `#${hex.replace("#", "").toUpperCase()}` : undefined
}
