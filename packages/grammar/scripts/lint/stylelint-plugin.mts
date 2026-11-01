/**
 * The Stylelint rules of the grammar's own stylesheets (`stylelint.config.mjs`). The package publishes CSS an app
 * cannot restyle, so a literal in it reaches every app: 2px and 6px once shipped to npm. Two rules close the door.
 *
 *   starci-grammar/no-literal    a component rule holds no hardcoded colour, radius, type size, shadow geometry, motion
 *                                 or opacity, and no `var()` fallback that is a literal. It reads a token or a ramp.
 *   starci-grammar/spacing-scale a padding, margin, gap or inset is on the scale 0 4 8 12 24 32 (src/common/spacing.ts),
 *                                 never fluid.
 *
 * A custom property declaration is a token definition: it may hold a literal (the ramps in `src/common/ramps.css`, a
 * family's `theme.css`), and only its `var()` fallbacks are judged. Colour keywords belong to `forced-colors` alone.
 */
import stylelint from "stylelint"
import type { Plugin, PostcssResult } from "stylelint"
import type { AtRule, ChildNode, Container, Declaration, Document, Root } from "postcss"
import valueParser from "postcss-value-parser"
import type { Node as ValueNode } from "postcss-value-parser"
import { COMMON_SPACING_SCALE } from "../../src/common/spacing.ts"

const { createPlugin, utils } = stylelint

const NAMED_COLORS = new Set(
    (
        "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue " +
        "chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " +
        "darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray " +
        "darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen " +
        "fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
        "lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
        "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
        "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen " +
        "mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange " +
        "orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
        "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
        "slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
        "yellowgreen canvas canvastext highlight highlighttext graytext linktext visitedtext activetext buttonface buttontext " +
        "buttonborder field fieldtext mark marktext selecteditem selecteditemtext accentcolor accentcolortext"
    ).split(" "),
)
const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"])
const EASING_WORDS = new Set(["ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end"])
const EASING_FUNCTIONS = new Set(["cubic-bezier", "steps", "linear"])
/** Words a fallback may be: a layout keyword, never a measure or a colour. */
const MATH_FUNCTIONS = new Set(["min", "max", "clamp"])
const FALLBACK_KEYWORDS = new Set([
    "none", "inherit", "initial", "unset", "revert", "transparent", "currentcolor", "auto", "normal", "contents", "block", "inline", "inline-block",
    "flex", "inline-flex", "grid", "inline-grid",
])

const COLOR_PROPERTY = /^(?:color|background(?:-color|-image)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|box-shadow|text-shadow|mask(?:-image)?|-webkit-mask(?:-image)?)$/
const RADIUS_PROPERTY = /^border(?:-(?:start|end)-(?:start|end))?-radius$|^border-(?:top|bottom)-(?:left|right)-radius$/
const SHADOW_PROPERTY = /^(?:box-shadow|text-shadow)$/
const TRANSFORM_PROPERTY = /^(?:transform|translate|scale|rotate|offset-distance)$/
const MOTION_PROPERTY = /^(?:transition|animation)(?:-[a-z]+)*$/
const TYPE_PROPERTY = /^(?:font-size|font-weight|line-height|letter-spacing|font|font-family|word-spacing)$/

const LENGTH_UNITS = new Set(["px", "rem", "em", "ch", "ex", "vw", "vh", "vmin", "vmax", "dvh", "svh", "lvh", "dvw", "pt", "pc", "cm", "mm", "in", "%", "cqw", "cqh", "cqi", "cqb"])
const TIME_UNIT = /^[+-]?(?:\d+\.?\d*|\.\d+)m?s$/i

const isNumber = (word: string): boolean => valueParser.unit(word) !== false
const isZero = (word: string): boolean => /^[+-]?0*\.?0+(?:[a-z%]+)?$/i.test(word)
const unitOf = (word: string): string => {
    const parsed = valueParser.unit(word)
    return parsed === false ? "" : parsed.unit.toLowerCase()
}

const isAtRule = (node: Container | Document): node is AtRule => node.type === "atrule"

const inForcedColors = (node: ChildNode): boolean => {
    let parent: Container | Document | undefined = node.parent
    while (parent !== undefined) {
        if (isAtRule(parent) && /^media$/i.test(parent.name) && /forced-colors/i.test(parent.params)) return true
        parent = parent.parent
    }
    return false
}

const messages = (ruleName: string) => utils.ruleMessages(ruleName, {
    literal: (property: string, what: string, hint: string) => `\`${property}\` holds ${what}. ${hint}`,
    fallback: (token: string, fallback: string) => `\`var(${token}, ${fallback})\` falls back to a literal. Define \`${token}\` once on the root (a ramp in src/common/ramps.css) and read it bare.`,
    off: (property: string, length: string) => `\`${property}: ${length}\` is not a step of the spacing scale (0 4 8 12 24 32). Name the step by its role through a --grammar-* token.`,
    fluid: (property: string, what: string) => `\`${property}\` is fluid (\`${what}\`). A spacing value steps by breakpoint; it never follows the viewport.`,
})

const literalRuleName = "starci-grammar/no-literal"
const literalMessages = messages(literalRuleName)

/** The first literal of a `var()` fallback, or null when the fallback is tokens and layout keywords only. */
const fallbackLiteral = (nodes: readonly ValueNode[]): string | null => {
    for (const node of nodes) {
        if (node.type === "string") return valueParser.stringify(node)
        if (node.type === "word") {
            const word = node.value.toLowerCase()
            if (word === "0" || FALLBACK_KEYWORDS.has(word)) continue
            if (word.startsWith("--")) continue
            return node.value
        }
        if (node.type === "function") {
            const name = node.value.toLowerCase()
            if (name === "var") continue
            if (MATH_FUNCTIONS.has(name)) {
                const inner = fallbackLiteral(node.nodes.filter((child) => child.type !== "word" || !/^[-+*/]$/.test(child.value)))
                if (inner !== null) return inner
                continue
            }
            if (COLOR_FUNCTIONS.has(name) && node.nodes[0]?.type === "word" && node.nodes[0].value.toLowerCase() === "from") continue
            if (name === "color-mix") {
                const inner = fallbackLiteral(node.nodes.filter((child) => child.type !== "word" || !/^(?:in|srgb|oklab|oklch|lab|lch|hsl|hwb|display-p3|shorter|longer|hue|increasing|decreasing|\d+%?|\.\d+%?)$/i.test(child.value)))
                if (inner !== null) return inner
                continue
            }
            return valueParser.stringify(node)
        }
    }
    return null
}

const checkFallbacks = (decl: Declaration, report: (word: string, token: string, fallback: string) => void): void => {
    valueParser(decl.value).walk((node) => {
        if (node.type !== "function" || node.value.toLowerCase() !== "var") return
        const comma = node.nodes.findIndex((child) => child.type === "div" && child.value === ",")
        if (comma < 0) return
        const token = valueParser.stringify(node.nodes.slice(0, comma))
        const fallback = node.nodes.slice(comma + 1)
        const literal = fallbackLiteral(fallback)
        if (literal !== null) report(literal, token, valueParser.stringify(fallback).trim())
    })
}

const noLiteralBase = (primary: unknown) => (root: Root, result: PostcssResult): void => {
    if (!utils.validateOptions(result, literalRuleName, { actual: primary, possible: [true] })) return
    const say = (decl: Declaration, word: string, what: string, hint: string): void => {
        utils.report({ result, ruleName: literalRuleName, message: literalMessages.literal(decl.prop, what, hint), node: decl, word })
    }
    root.walkDecls((decl) => {
        checkFallbacks(decl, (word, token, fallback) => {
            utils.report({ result, ruleName: literalRuleName, message: literalMessages.fallback(token, fallback), node: decl, word })
        })
        const prop = decl.prop.toLowerCase()
        if (prop.startsWith("--")) return
        const forced = inForcedColors(decl)
        const colored = COLOR_PROPERTY.test(prop)
        const parsed = valueParser(decl.value)
        parsed.walk((node) => {
            if (node.type === "function") {
                const name = node.value.toLowerCase()
                if (name === "var") return false
                if (colored && COLOR_FUNCTIONS.has(name) && !(node.nodes[0]?.type === "word" && node.nodes[0].value.toLowerCase() === "from")) {
                    say(decl, node.value, `a colour literal (\`${name}()\`)`, "A colour is a HeroUI token (`--accent`, `--surface`, `--muted`) or a mix of tokens.")
                }
                if (MOTION_PROPERTY.test(prop) && EASING_FUNCTIONS.has(name)) say(decl, node.value, `an easing literal (\`${name}()\`)`, "Motion reads --starci-core-motion-easing.")
                return undefined
            }
            if (node.type !== "word") return undefined
            const word = node.value
            const lower = word.toLowerCase()
            if (colored) {
                if (/^#[0-9a-f]{3,8}$/i.test(word)) say(decl, word, `a colour literal (\`${word}\`)`, "A colour is a HeroUI token (`--accent`, `--surface`, `--muted`) or a mix of tokens.")
                else if (!forced && NAMED_COLORS.has(lower)) say(decl, word, `the colour keyword \`${word}\` outside forced-colors`, "Name a token, or `currentColor`; system colours belong inside `@media (forced-colors: active)`.")
            }
            if (RADIUS_PROPERTY.test(prop) && isNumber(word) && !isZero(word) && unitOf(word) !== "") say(decl, word, `a radius literal (\`${word}\`)`, "A corner is a role of src/common/ramps.css (--grammar-radius-*), derived from --radius.")
            if (SHADOW_PROPERTY.test(prop) && isNumber(word) && !isZero(word) && LENGTH_UNITS.has(unitOf(word)) && unitOf(word) !== "%") say(decl, word, `a shadow geometry literal (\`${word}\`)`, "Shadow geometry is a token: --grammar-ring-width, --grammar-stroke-*, --offset-pop-shadow-*.")
            if (TRANSFORM_PROPERTY.test(prop) && isNumber(word) && !isZero(word) && LENGTH_UNITS.has(unitOf(word)) && unitOf(word) !== "%") say(decl, word, `a distance literal (\`${word}\`)`, "A travel distance is a token of the family (--offset-pop-shadow-x).")
            if (prop === "opacity" && isNumber(word) && word !== "0" && word !== "1") say(decl, word, `an opacity literal (\`${word}\`)`, "Opacity is --disabled-opacity or a --grammar-opacity-* step.")
            if (MOTION_PROPERTY.test(prop)) {
                if (TIME_UNIT.test(word) && !isZero(word)) say(decl, word, `a duration literal (\`${word}\`)`, "Motion reads --starci-core-motion-duration or a --grammar-loop-* step.")
                else if (EASING_WORDS.has(lower)) say(decl, word, `an easing keyword (\`${word}\`)`, "Motion reads --starci-core-motion-easing, or --grammar-loop-easing for a loop.")
            }
            if (TYPE_PROPERTY.test(prop)) {
                if (prop === "font-family") {
                    if (lower !== "inherit") say(decl, word, `a font stack (\`${word}\`)`, "Type reads --font-sans or --font-mono.")
                } else if (isNumber(word) && !isZero(word)) say(decl, word, `a type literal (\`${word}\`)`, "Type reads --grammar-text-*, --grammar-leading-*, --grammar-weight-* or --grammar-tracking-* of src/common/ramps.css.")
                else if (prop === "font-weight" && /^(?:bold|bolder|lighter)$/.test(lower)) say(decl, word, `the weight keyword \`${word}\``, "Type reads --grammar-weight-*.")
            }
            return undefined
        })
    })
}
const noLiteral = createPlugin(literalRuleName, Object.assign(noLiteralBase, { ruleName: literalRuleName, messages: literalMessages }))

const spacingRuleName = "starci-grammar/spacing-scale"
const spacingMessages = messages(spacingRuleName)
const SCALE_REM: readonly number[] = Object.values(COMMON_SPACING_SCALE).map((value) => (value === "0" ? 0 : Number.parseFloat(value)))
const STROKES_PX: readonly number[] = [1, 2]
const SPACING_PROPERTY = /^(?:padding|margin|scroll-padding|scroll-margin)(?:-[a-z-]+)?$|^(?:gap|row-gap|column-gap)$/
const SPACING_TOKEN = /^--[\w-]*(?:gap|inset|padding|gutter)[\w-]*$/
const VIEWPORT = new Set(["vw", "vh", "vi", "vb", "vmin", "vmax", "svw", "svh", "lvw", "lvh", "dvw", "dvh"])

const onScale = (amount: number, unit: string): boolean => {
    const size = Math.abs(amount)
    if (unit === "px") return STROKES_PX.includes(size) || SCALE_REM.some((step) => Math.abs(step * 16 - size) < 0.001)
    return SCALE_REM.some((step) => Math.abs(step - size) < 0.0005)
}

const spacingScaleBase = (primary: unknown) => (root: Root, result: PostcssResult): void => {
    if (!utils.validateOptions(result, spacingRuleName, { actual: primary, possible: [true] })) return
    root.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase()
        if (!SPACING_PROPERTY.test(prop) && !SPACING_TOKEN.test(prop)) return
        valueParser(decl.value).walk((node) => {
            if (node.type === "function" && node.value.toLowerCase() === "clamp") {
                utils.report({ result, ruleName: spacingRuleName, message: spacingMessages.fluid(decl.prop, "clamp()"), node: decl, word: "clamp" })
                return
            }
            if (node.type !== "word") return
            const parsed = valueParser.unit(node.value)
            if (parsed === false) return
            const unit = parsed.unit.toLowerCase()
            const amount = Number.parseFloat(parsed.number)
            if (VIEWPORT.has(unit)) utils.report({ result, ruleName: spacingRuleName, message: spacingMessages.fluid(decl.prop, node.value), node: decl, word: node.value })
            else if ((unit === "px" || unit === "rem") && !onScale(amount, unit)) utils.report({ result, ruleName: spacingRuleName, message: spacingMessages.off(decl.prop, node.value), node: decl, word: node.value })
        })
    })
}
const spacingScale = createPlugin(spacingRuleName, Object.assign(spacingScaleBase, { ruleName: spacingRuleName, messages: spacingMessages }))

export const plugins: readonly Plugin[] = [noLiteral, spacingScale]
export default plugins
