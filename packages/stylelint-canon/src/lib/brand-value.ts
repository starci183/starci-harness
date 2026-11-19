/**
 * The one notion of a "raw brand value" in the StarCi lint canon.
 *
 * `@starci/eslint-canon-fe` `no-raw-brand-value` (brand-values.mjs) judges TypeScript with these exact three
 * patterns; this package judges CSS with them. They are copied, not imported, because the two packages are
 * published apart; `brand-value.spec.ts` reads eslint-canon-fe's source and fails when a pattern differs, so the
 * two cannot drift. A change to a pattern is made in both files in one commit.
 *
 * A raw brand value is a colour written as a value (hex, or a colour function) or a length written in pixels.
 * Both belong only in `modules/brand/brand.css`, on the tokens the grammar declares.
 */

/** A hex colour: 3, 4, 6 or 8 digits, not a longer word and not part of an identifier. */
export const HEX_COLOR = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/

/** A functional colour notation. */
export const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i

/** The CSS named colours (not `transparent`, `currentcolor` or a system colour, which carry no brand value). */
export const NAMED_COLORS = "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen"

/** A pixel length, not inside an arbitrary-value bracket and not part of a longer number or word. */
export const PIXEL_LENGTH = /(?<![\w.#[-])-?(?:\d+\.?\d*|\.\d+)px\b/

/** A `url(...)` reference: a fragment such as `url(#add)` is an address, not a colour. */
const URL_REFERENCE = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi

/** The properties whose value may hold a colour. */
const COLOR_PROPERTY = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|box-shadow|text-shadow|column-rule(?:-color)?)$/i
const NAMED_COLOR = new RegExp(String.raw`(?<![\w-])(?:${NAMED_COLORS})(?![\w-])`, "i")
const NAMED_COLOR_ALONE = new RegExp(String.raw`^(?:${NAMED_COLORS})$`, "i")

/**
 * The named colour (`red`, `navy`) a declaration writes, or null. A colour property reads any word of its value; a custom property
 * only a value that is a named colour by itself, so a font name or an animation name is never taken for one. Quoted strings are skipped.
 */
function namedColorIn(value: string, prop: string): string | null {
  const bare = value.replace(/(["'])(?:\\.|(?!\1).)*\1/g, "").trim()
  if (prop.startsWith("--")) return NAMED_COLOR_ALONE.test(bare) ? bare : null
  return COLOR_PROPERTY.test(prop) ? (NAMED_COLOR.exec(bare)?.[0] ?? null) : null
}

/**
 * The first raw brand value in a CSS value, or null: `{ kind: "color" | "length", value }`.
 * A colour wins over a length, as in the TypeScript rule.
 */
export function findRawBrandValue(text: unknown, prop?: string): { kind: "color" | "length"; value: string } | null {
  if (typeof text !== "string") return null
  const cleaned = text.replace(URL_REFERENCE, "url()")
  const color = HEX_COLOR.exec(cleaned) || COLOR_FUNCTION.exec(cleaned)
  if (color) return { kind: "color", value: color[0].replace(/\($/, "(...)") }
  const named = prop === undefined ? null : namedColorIn(cleaned, prop)
  if (named !== null) return { kind: "color", value: named }
  const length = PIXEL_LENGTH.exec(cleaned)
  if (length) return { kind: "length", value: length[0] }
  return null
}
