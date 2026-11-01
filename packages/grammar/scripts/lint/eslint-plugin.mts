/**
 * The ESLint rule of the grammar's own components (`eslint.config.mjs`), the TypeScript half of
 * `scripts/lint/stylelint-plugin.mts`. A component names a role and the stylesheet gives it a value, so a component
 * holds no hex colour, colour function, length, utility class or numeric style value (`starci-grammar/no-literal-look`).
 */
import type { Rule } from "eslint"

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/
const COLOR_FUNCTION = /(?:^|[^\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/
const LENGTH = /(?:^|[^\w.#[-])-?(?!0+(?:\.0+)?(?:px|rem|em))(?:\d+\.?\d*|\.\d+)(?:px|rem|em)(?![\w-])/
const UTILITY =
    /(?:^|\s)(?:text-(?:xs|sm|base|lg|[2-9]?xl)|font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)|leading-[\w.]+|tracking-[\w.]+|rounded-\w+|shadow-\w+|opacity-\d+|duration-\d+|[pm][trblxy]?-\d+|gap-\d+|space-[xy]-\d+|(?:bg|text|border)-(?:white|black|[a-z]+-\d+)|[wh]-\[)(?=\s|$)/
const STYLE_KEY =
    /^(?:width|height|minWidth|maxWidth|minHeight|maxHeight|top|left|right|bottom|gap|padding\w*|margin\w*|fontSize|fontWeight|lineHeight|letterSpacing|borderRadius|opacity|transitionDuration|animationDuration)$/

const FALLBACK = /var\(--[\w-]+\s*,\s*(?!var\()/

const CHECKS: readonly { readonly test: RegExp; readonly say: string }[] = [
    { test: HEX, say: "A hex colour is a literal. Read a HeroUI token." },
    { test: COLOR_FUNCTION, say: "A colour function is a literal. Read a HeroUI token, or mix tokens in CSS." },
    { test: LENGTH, say: "A length is a literal. Name a role in CSS (a ramp of src/common/ramps.css, or the spacing scale)." },
    { test: FALLBACK, say: "A var() fallback is a literal. Define the token once on the root (src/common/ramps.css) and read it bare." },
    { test: UTILITY, say: "A utility class decides the look in a component. Set a data attribute; the stylesheet reads the ramps." },
]

export const noLiteralLook: Rule.RuleModule = {
    meta: { type: "problem", schema: [], docs: { description: "A component holds no hardcoded colour, length, utility class or numeric style value." } },
    create(context) {
        const judge = (node: Rule.Node, text: string): void => {
            for (const check of CHECKS) if (check.test.test(text)) context.report({ node, message: check.say })
        }
        return {
            Literal(node) {
                if (typeof node.value === "string") judge(node, node.value)
            },
            TemplateElement(node) {
                judge(node, node.value.cooked ?? node.value.raw)
            },
            "JSXAttribute[name.name=\"style\"] Property"(node: Rule.Node) {
                if (node.type !== "Property") return
                const key = node.key.type === "Identifier" ? node.key.name : node.key.type === "Literal" ? String(node.key.value) : ""
                if (!STYLE_KEY.test(key) || node.value.type !== "Literal" || typeof node.value.value !== "number" || node.value.value === 0 || node.value.value === 1) return
                context.report({ node, message: "A style value is a literal. Set a data attribute or a custom property; the stylesheet reads the ramps." })
            },
        }
    },
}

export default { rules: { "no-literal-look": noLiteralLook } }
