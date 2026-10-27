/**
 * Colour maths for `starci/status-contrast`: parse the notations a brand layer writes (hex, `rgb()`, `hsl()`,
 * `oklab()`, `oklch()`, `color-mix()` in oklab, oklch or srgb, `transparent`, `white`, `black`), and compute the
 * WCAG 2 contrast ratio with alpha composited on the background.
 *
 * A colour is `{ lab: [L, a, b], alpha, hue }`: OKLab is the one stored space (a mix in oklab, the grammar's own space,
 * is then exact); `hue` is the OKLCH hue in degrees when the value was written in OKLCH (so a polar mix keeps it) and
 * `null` otherwise. A value this module cannot read (relative colours, `currentcolor`, `light-dark()`, a space it does
 * not know) parses to `null`: the caller reports it, it never passes silently.
 */

/** Three channels of one colour space. */
export type Vec3 = [number, number, number]

/** A parsed colour: OKLab, its alpha, and the OKLCH hue when the value was written in OKLCH. */
export interface Color {
  lab: Vec3
  alpha: number
  hue: number | null
}

const NAMED = new Map<string, readonly [number, number, number, number]>([
  ["transparent", [0, 0, 0, 0]],
  ["white", [1, 1, 1, 1]],
  ["black", [0, 0, 0, 1]],
])
/** OKLCH chroma below which a colour that did not come from OKLCH has no hue of its own. */
const POWERLESS = 1e-4

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.abs(c) ** (1 / 2.4) - 0.055)
const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value))

/** Gamma-encoded sRGB (0..1, unclamped) to OKLab. */
function srgbToOklab([red, green, blue]: Vec3): Vec3 {
  const [r, g, b] = [toLinear(red), toLinear(green), toLinear(blue)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab to gamma-encoded sRGB (0..1, unclamped: an out-of-gamut colour keeps its overshoot). */
function oklabToSrgb([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** OKLab to OKLCH `[L, C, H]` with H in degrees. */
export const oklabToOklch = ([L, a, b]: Vec3): Vec3 => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]

/** OKLCH `[L, C, H]` to OKLab. */
export const oklchToOklab = ([L, C, H]: Vec3): Vec3 => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]

const fromSrgb = (rgb: Vec3, alpha = 1): Color => ({ lab: srgbToOklab(rgb), alpha, hue: null })

// -- reading -----------------------------------------------------------------------------------------------------

/** Splits `text` at `separator` outside parentheses. */
function topLevel(text: string, separator: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === "(") depth += 1
    else if (char === ")") depth -= 1
    else if (char === separator && depth === 0) {
      out.push(text.slice(from, i))
      from = i + 1
    }
  }
  out.push(text.slice(from))
  return out
}

/** The arguments of a function call as top-level words: `"58% .16 162.85 / 50%"` gives its parts and the alpha part. */
function splitArguments(inner: string): { parts: string[]; alpha: string | null; legacy: boolean } {
  const text = inner.trim()
  const commas = topLevel(text, ",")
  if (commas.length > 1) return { parts: commas.map((part) => part.trim()), alpha: null, legacy: true }
  const [main = "", alpha] = topLevel(text, "/")
  return { parts: main.trim().split(/\s+/).filter(Boolean), alpha: alpha === undefined ? null : alpha.trim(), legacy: false }
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`

/** A number, or a percentage mapped so 100% is `full`; `none` is 0. Anything else is null. */
function amount(word: string | undefined, full: number): number | null {
  if (word === undefined) return null
  if (word === "none") return 0
  const percent = new RegExp(`^(${NUMBER})%$`, "i").exec(word)
  if (percent) return (Number(percent[1]) / 100) * full
  return new RegExp(`^${NUMBER}$`, "i").test(word) ? Number(word) : null
}

/** A hue in degrees: `162.85`, `162.85deg`, `0.5turn`. */
function angle(word: string | undefined): number | null {
  if (word === undefined) return null
  if (word === "none") return 0
  const match = new RegExp(`^(${NUMBER})(deg|turn|rad|grad)?$`, "i").exec(word)
  if (!match) return null
  const value = Number(match[1])
  const unit = (match[2] ?? "deg").toLowerCase()
  if (unit === "turn") return value * 360
  if (unit === "rad") return (value * 180) / Math.PI
  return unit === "grad" ? value * 0.9 : value
}

function alphaOf(word: string | null): number | null {
  if (word === null) return 1
  const value = amount(word, 1)
  return value === null ? null : clamp(value)
}

/** Parses one colour value, or returns null when it is not a colour this module reads. */
export function parseColor(text: string): Color | null {
  const value = String(text).trim().toLowerCase()
  const named = NAMED.get(value)
  if (named !== undefined) return fromSrgb([named[0], named[1], named[2]], named[3])
  const hexDigits = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1]
  if (hexDigits !== undefined) {
    const digits = hexDigits.length <= 4 ? [...hexDigits].map((digit) => digit + digit).join("") : hexDigits
    const channel = (index: number): number => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255
    return fromSrgb([channel(0), channel(1), channel(2)], digits.length === 8 ? channel(3) : 1)
  }
  const call = /^([a-z-]+)\(([\s\S]*)\)$/.exec(value)
  if (!call) return null
  const name = call[1] ?? ""
  const inner = call[2] ?? ""
  if (name === "color-mix") return parseMix(inner)
  if (!["rgb", "rgba", "hsl", "hsla", "oklab", "oklch"].includes(name)) return null
  const { parts, alpha: alphaWord, legacy } = splitArguments(inner)
  if (legacy && parts.length === 4) return build(name, parts.slice(0, 3), parts[3] ?? null)
  return parts.length === 3 ? build(name, parts, alphaWord) : null
}

function build(name: string, [first, second, third]: readonly string[], alphaWord: string | null): Color | null {
  const alpha = alphaOf(alphaWord)
  if (alpha === null) return null
  if (name === "rgb" || name === "rgba") {
    const [red, green, blue] = [amount(first, 255), amount(second, 255), amount(third, 255)]
    if (red === null || green === null || blue === null) return null
    return fromSrgb([red / 255, green / 255, blue / 255], alpha)
  }
  if (name === "hsl" || name === "hsla") {
    const hue = angle(first)
    const saturation = amount(second, 100)
    const lightness = amount(third, 100)
    if (hue === null || saturation === null || lightness === null) return null
    return fromSrgb(hslToSrgb(hue, clamp(saturation / 100), clamp(lightness / 100)), alpha)
  }
  if (name === "oklab") {
    const [lightness, a, b] = [amount(first, 1), amount(second, 0.4), amount(third, 0.4)]
    if (lightness === null || a === null || b === null) return null
    return { lab: [lightness, a, b], alpha, hue: null }
  }
  const lightness = amount(first, 1)
  const chroma = amount(second, 0.4)
  const hue = angle(third)
  if (lightness === null || chroma === null || hue === null) return null
  return { lab: oklchToOklab([lightness, chroma, hue]), alpha, hue: ((hue % 360) + 360) % 360 }
}

function hslToSrgb(hueDegrees: number, saturation: number, lightness: number): Vec3 {
  const hue = ((hueDegrees % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const offset = lightness - chroma / 2
  const sectors: Vec3[] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]]
  const sector = sectors[Math.floor(hue / 60)]
  if (sector === undefined) throw new RangeError(`hue ${hueDegrees} is not a finite angle`)
  return [sector[0] + offset, sector[1] + offset, sector[2] + offset]
}

/** One operand of a `color-mix()`: the colour and its optional percentage. */
function mixOperand(operand: string): { color: Color; percent: number | null } | null {
  const percentage = new RegExp(String.raw`(?:^|\s)(${NUMBER})%$`).exec(operand)
  const color = parseColor(percentage ? operand.slice(0, percentage.index).trim() : operand)
  return color === null ? null : { color, percent: percentage ? Number(percentage[1]) : null }
}

/** `color-mix(in <space> [<hue-method> hue], <colour> [<p>%], <colour> [<p>%])`. */
function parseMix(inner: string): Color | null {
  const [head, ...operands] = topLevel(inner, ",").map((part) => part.trim())
  const space = /^in\s+(oklab|oklch|srgb)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?$/.exec(head ?? "")
  const [operandA, operandB] = operands
  if (!space || operandA === undefined || operandB === undefined || operands.length !== 2) return null
  const [, model, method = "shorter"] = space
  const first = mixOperand(operandA)
  const second = mixOperand(operandB)
  if (first === null || second === null) return null
  // An omitted percentage is the complement of the other, and both omitted split evenly.
  const p1 = first.percent ?? (second.percent === null ? 50 : 100 - second.percent)
  const p2 = second.percent ?? (first.percent === null ? 50 : 100 - first.percent)
  const sum = p1 + p2
  if (!(sum > 0) || p1 < 0 || p2 < 0) return null
  const [w1, w2] = [p1 / sum, p2 / sum]
  const multiplier = sum < 100 ? sum / 100 : 1
  const [a, b] = [first.color, second.color]
  const mixedAlpha = a.alpha * w1 + b.alpha * w2
  const alpha = mixedAlpha * multiplier
  // Premultiplied interpolation: a transparent operand contributes no colour, only its share of the alpha.
  const mix = (x: number, y: number): number => (mixedAlpha === 0 ? x * w1 + y * w2 : (a.alpha * x * w1 + b.alpha * y * w2) / mixedAlpha)
  if (model === "oklab") return { lab: [mix(a.lab[0], b.lab[0]), mix(a.lab[1], b.lab[1]), mix(a.lab[2], b.lab[2])], alpha, hue: null }
  if (model === "srgb") {
    const [ra, rb] = [oklabToSrgb(a.lab), oklabToSrgb(b.lab)]
    return { lab: srgbToOklab([mix(ra[0], rb[0]), mix(ra[1], rb[1]), mix(ra[2], rb[2])]), alpha, hue: null }
  }
  const [la, lb] = [oklabToOklch(a.lab), oklabToOklch(b.lab)]
  const hueOf = (color: Color, lch: Vec3): number | null => (color.hue !== null ? color.hue : lch[1] < POWERLESS ? null : lch[2])
  const [ha, hb] = [hueOf(a, la), hueOf(b, lb)]
  let hue = 0
  if (ha === null) hue = hb ?? 0
  else hue = hb === null ? ha : mixHue(ha, hb, w1, w2, method)
  return { lab: oklchToOklab([mix(la[0], lb[0]), mix(la[1], lb[1]), hue]), alpha, hue }
}

function mixHue(a: number, b: number, w1: number, w2: number, method: string): number {
  let [from, to] = [a, b]
  const delta = to - from
  if (method === "shorter" && delta > 180) from += 360
  else if (method === "shorter" && delta < -180) to += 360
  else if (method === "longer" && delta > 0 && delta < 180) from += 360
  else if (method === "longer" && delta > -180 && delta <= 0) to += 360
  else if (method === "increasing" && to < from) to += 360
  else if (method === "decreasing" && from < to) from += 360
  return (((from * w1 + to * w2) % 360) + 360) % 360
}

// -- contrast ----------------------------------------------------------------------------------------------------

/** Gamma sRGB clipped to the gamut. */
export const toSrgb = (color: Color): Vec3 => {
  const [r, g, b] = oklabToSrgb(color.lab)
  return [clamp(r), clamp(g), clamp(b)]
}

/** `color` over an opaque `background`, both from `parseColor`. */
export function composite(color: Color, background: Color): Color {
  if (color.alpha >= 1) return { ...color, alpha: 1 }
  const [top, under] = [toSrgb(color), toSrgb(background)]
  return fromSrgb([
    top[0] * color.alpha + under[0] * (1 - color.alpha),
    top[1] * color.alpha + under[1] * (1 - color.alpha),
    top[2] * color.alpha + under[2] * (1 - color.alpha),
  ])
}

/** WCAG 2 relative luminance. */
export function luminance(color: Color): number {
  const [r, g, b] = toSrgb(color)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG 2 contrast of `foreground` on an opaque `background`; the foreground's alpha is composited on it first. */
export function contrast(foreground: Color, background: Color): number {
  const [a, b] = [luminance(composite(foreground, background)), luminance(background)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** True when two colours draw the same pixel (within half of an 8-bit channel) at the same alpha. */
export function sameColor(a: Color, b: Color): boolean {
  if (Math.abs(a.alpha - b.alpha) > 1 / 512) return false
  const [x, y] = [toSrgb(a), toSrgb(b)]
  const near = (i: 0 | 1 | 2): boolean => Math.abs(x[i] - y[i]) < 0.5 / 255
  return near(0) && near(1) && near(2)
}
