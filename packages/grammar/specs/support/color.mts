/**
 * Just enough colour maths for a contrast spec: OKLab and OKLCH to sRGB, mixes in OKLab, and the WCAG 2 contrast ratio. Pure; no dependency.
 */

export type Lab = readonly [number, number, number]
export type Rgb = readonly [number, number, number]

export const oklchToLab = (l: number, c: number, hueDegrees: number): Lab => {
    const h = (hueDegrees * Math.PI) / 180
    return [l, c * Math.cos(h), c * Math.sin(h)]
}

/** Linear-light sRGB (unclamped) from OKLab. */
export const labToLinear = ([l, a, b]: Lab): Rgb => {
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    return [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ]
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value))

export const linearToLab = ([r, g, b]: Rgb): Lab => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

const srgbToLinear = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

export const hexToLab = (hex: string): Lab => {
    const digits = hex.replace("#", "")
    const full = digits.length === 3 ? digits.split("").map((d) => d + d).join("") : digits
    const channel = (index: number): number => srgbToLinear(Number.parseInt(full.slice(index * 2, index * 2 + 2), 16) / 255)
    return linearToLab([channel(0), channel(1), channel(2)])
}

/** `color-mix(in oklab, a pa%, b pb%)` with the percentages normalised when they do not add to 100. */
export const mixLab = (a: Lab, pa: number, b: Lab, pb: number): Lab => {
    const total = pa + pb
    return [0, 1, 2].map((index) => ((a[index] ?? 0) * pa + (b[index] ?? 0) * pb) / total) as unknown as Lab
}

export const luminance = (lab: Lab): number => {
    const [r, g, b] = labToLinear(lab).map(clamp) as unknown as Rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG 2 contrast ratio of two opaque colours. */
export const contrast = (a: Lab, b: Lab): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
}

/** The sRGB hex of a colour, gamut-clamped the way a browser paints an out-of-gamut OKLCH. */
export const labToHex = (lab: Lab): string => {
    const encode = (value: number): string => {
        const c = clamp(value)
        return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255).toString(16).padStart(2, "0")
    }
    return `#${labToLinear(lab).map(encode).join("")}`
}
