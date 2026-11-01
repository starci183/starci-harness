import type { Rule } from "eslint"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Node } from "./lib/types.ts"
/**
 * The rule that holds `status-colors.md` (HFS R61 `FE_STYLE_TOKEN_ONLY`, the status-pair rule for class names; no gate
 * judges the colours an app's theme gives the pair).
 *
 * A STATUS TONE x PAINTS IN TWO WAYS (owner ruling `status-soft-pair-on-background`). Content that sits ON A BACKGROUND OF THE
 * TONE uses the pair `x-soft` and `x-soft-foreground`, the way a HeroUI flat Chip does. A mark that STANDS ALONE, with no
 * background of the tone behind it, uses `x` itself. A solid fill takes `x-foreground`.
 *
 * WHAT IT READS. Every static class string a component writes: the `className` / `class` attribute of an element (through
 * `cn()`, `clsx()`, conditionals, arrays, template text), and a string in a constant or in a `classes` entry. The tones are the
 * grammar's `STATUS_TONES` (`lib/status-tones.generated.ts`, generated from the grammar with the stylelint vocabulary), never a
 * list typed here. Two findings:
 *
 * - ON A TINT: a class string that sets `bg-x-soft` and also paints text, an icon or a text decoration with the solid tone
 *   (`text-x`, `fill-x`, `stroke-x`, `decoration-x`, with any variant and opacity). The content on the tint takes
 *   `text-x-soft-foreground`.
 * - ALONE: the soft foreground (`text-x-soft-foreground`) in the `className` of an element when neither that element nor an
 *   enclosing element of the same file sets `bg-x-soft`. A mark with no tint behind it takes `text-x`. A constant, an array in
 *   a constant or a `classes` entry is not judged for this finding, since the element that wears it is not in view.
 *
 * OFFSET POP. The family's light-theme tones are pastel fills (1.3 to 1.5:1 as bare text), and the owner chose to keep them
 * ("1. Pastel"): a bare mark wears the soft foreground there. When the selected Grammar is `offset-pop` the ALONE finding is
 * not reported; the ON A TINT finding still is.
 *
 * WHAT IT LEAVES ALONE: a bare solid tone (`text-success` with no `bg-success-soft` on the element), the soft pair on its tint, a
 * solid fill with its own ink (`bg-success text-success-foreground`), a solid border, ring or outline (`border-danger`,
 * `ring-warning`: a boundary is not text), and a class that only shares a prefix (`text-successful`).
 */

import { attributeValue } from "@starci/eslint-canon-fe/lib/ast.mjs"
import { STATUS_TONES } from "./lib/status-tones.generated.ts"

/** The utility families that paint text, an icon or a text decoration. */
const TEXT_PAINT = ["text", "fill", "stroke", "decoration"]

/** An optional opacity suffix: `/60` or `/[.4]`. */
const OPACITY = "(?:/(?:\\d+|\\[[^\\]]*\\]))?"

/** `text-success`, `text-success/60`, `text-success-hover`, with an optional `!` and any variants before it. */
const SOLID_TEXT = new RegExp(`^!?(${TEXT_PAINT.join("|")})-(${STATUS_TONES.join("|")})(?:-hover)?${OPACITY}$`)

/** `text-success-soft-foreground`, with an optional `!`, opacity and any variants before it. */
const SOFT_TEXT = new RegExp(`^!?(${TEXT_PAINT.join("|")})-(${STATUS_TONES.join("|")})-soft-foreground${OPACITY}$`)

/** `bg-success-soft`, `bg-success-soft-hover`, with an optional `!`, opacity and any variants before it. */
const SOFT_BACKGROUND = new RegExp(`^!?bg-(${STATUS_TONES.join("|")})-soft(?:-hover)?${OPACITY}$`)

/** The class after its variants: `md:hover:text-success` and `[&>svg]:text-success` both end at `text-success`. */
const utilityOf = (token: string): string => {
  let depth = 0
  let cut = -1
  for (let i = 0; i < token.length; i += 1) {
    if (token[i] === "[") depth += 1
    else if (token[i] === "]") depth -= 1
    else if (token[i] === ":" && depth === 0) cut = i
  }
  return token.slice(cut + 1)
}

type PaintedClass = { token: string; family: string; tone: string }

/** Every class of one class string that the pattern reads, as `{ token, family, tone }`. */
const paintedClasses = (text: string, pattern: RegExp): PaintedClass[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => {
      const match = pattern.exec(utilityOf(token))
      const family = match?.[1]
      const tone = match?.[2]
      return family !== undefined && tone !== undefined ? [{ token, family, tone }] : []
    })

/** Every solid-tone text class in one class string. */
export const solidTextClasses = (text: string): PaintedClass[] => paintedClasses(text, SOLID_TEXT)

/** Every soft-foreground text class in one class string. */
export const softTextClasses = (text: string): PaintedClass[] => paintedClasses(text, SOFT_TEXT)

/** The tones whose soft tint a class string sets as a background. */
export const softBackgroundTones = (text: string): string[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => {
      const tone = SOFT_BACKGROUND.exec(utilityOf(token))?.[1]
      return tone === undefined ? [] : [tone]
    })

type StringNode = { node: Node; text: string }

/** The string nodes inside an expression that builds a class string: literals, template text, keys, and everything a call, array or condition carries. */
function* stringNodes(node: Node | null | undefined): Generator<StringNode> {
  if (!node || typeof node.type !== "string") return
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") yield { node, text: node.value }
      return
    case "TemplateLiteral":
      yield { node, text: node.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ") }
      return
    case "JSXExpressionContainer":
      yield* stringNodes(node.expression)
      return
    case "ConditionalExpression":
      yield* stringNodes(node.consequent)
      yield* stringNodes(node.alternate)
      return
    case "LogicalExpression":
      yield* stringNodes(node.left)
      yield* stringNodes(node.right)
      return
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      yield* stringNodes(node.expression)
      return
    case "ArrayExpression":
      for (const element of node.elements) yield* stringNodes(element)
      return
    case "CallExpression":
      for (const argument of node.arguments) yield* stringNodes(argument)
      return
    case "ObjectExpression":
      for (const property of node.properties) {
        if (property.type !== "Property") continue
        if (!property.computed && property.key.type === "Literal") yield* stringNodes(property.key)
        yield* stringNodes(property.value)
      }
      return
    default:
  }
}

/** The tones whose soft tint some string of the list sets as a background. */
const tintsOf = (strings: StringNode[]): Set<string> => new Set(strings.flatMap(({ text }) => softBackgroundTones(text)))

/** True for the `className` and `class` attributes of an element. */
const isClassAttribute = (node: Node): boolean => node.type === "JSXAttribute" && node.name.type === "JSXIdentifier" && (node.name.name === "className" || node.name.name === "class")

/** The tones whose tint an element enclosing the attribute's own element sets in its `className`, in the same file. */
const enclosingTints = (attribute: Node): Set<string> => {
  const tones = new Set<string>()
  for (let current: Node | null | undefined = attribute.parent?.parent?.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type !== "JSXElement") continue
    for (const candidate of current.openingElement.attributes) {
      if (candidate.type !== "JSXAttribute" || !isClassAttribute(candidate)) continue
      for (const tone of tintsOf([...stringNodes(attributeValue(candidate))])) tones.add(tone)
    }
  }
  return tones
}

/** The Grammar the app selected (`settings.starci.hfs.grammar`), or null when the settings carry none. */
const grammarOf = (settings: Rule.RuleContext["settings"]): string | null => {
  const starci: unknown = settings?.["starci"]
  if (typeof starci !== "object" || starci === null) return null
  const hfs: unknown = Reflect.get(starci, "hfs")
  if (typeof hfs !== "object" || hfs === null) return null
  const grammar: unknown = Reflect.get(hfs, "grammar")
  return typeof grammar === "string" ? grammar : null
}

/** Content on a tone's tint wears the soft foreground; a mark with no tint behind it wears the tone. */
export const statusTextUsesSoftForeground: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Status content on a tone background takes the soft pair; a status mark with no background of the tone takes the tone itself." },
    schema: [],
    messages: {
      onTint:
        "`{{token}}` paints text or an icon with the solid `{{tone}}` tone on a `bg-{{tone}}-soft` tint. Content that sits on a background of the tone takes the pair: `{{family}}-{{tone}}-soft-foreground` on `bg-{{tone}}-soft`.",
      alone:
        "`{{token}}` paints a status mark with the soft foreground, but no `bg-{{tone}}-soft` is behind it on this element or on an element that encloses it in this file. A mark that stands alone, with no background of the tone, takes the tone itself: `{{family}}-{{tone}}`. Put it on a `bg-{{tone}}-soft` tint to keep the soft pair.",
    },
  },
  create(context) {
    // A `classes` entry inside a constant is reached twice (as part of the constant, and as the entry): one finding per string.
    // Offset Pop's light theme draws a bare mark with the soft foreground (owner choice "1. Pastel"), so the lone soft foreground is not judged there.
    const aloneJudged = grammarOf(context.settings) !== "offset-pop"
    const seen = new Set<Node>()
    const fresh = (strings: Iterable<StringNode>): StringNode[] => [...strings].filter(({ node }) => !seen.has(node) && seen.add(node))
    const reportOnTint = (strings: StringNode[], tints: Set<string>): void => {
      for (const { node, text } of strings) {
        for (const { token, family, tone } of solidTextClasses(text)) if (tints.has(tone)) context.report({ node, messageId: "onTint", data: { token, family, tone } })
      }
    }
    const check = (root: Node | null | undefined): void => {
      const strings = fresh(stringNodes(root))
      reportOnTint(strings, tintsOf(strings))
    }
    return {
      JSXAttribute(node) {
        if (!isClassAttribute(node)) return
        const strings = fresh(stringNodes(attributeValue(node)))
        const own = tintsOf(strings)
        reportOnTint(strings, own)
        if (!aloneJudged) return
        const enclosing = enclosingTints(node)
        for (const { node: stringNode, text } of strings) {
          for (const { token, family, tone } of softTextClasses(text)) {
            if (!own.has(tone) && !enclosing.has(tone)) context.report({ node: stringNode, messageId: "alone", data: { token, family, tone } })
          }
        }
      },
      VariableDeclarator(node) {
        check(node.init)
      },
      Property(node) {
        if (!node.computed && node.key.type === "Identifier" && node.key.name === "classes") check(node.value)
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "status-text-uses-soft-foreground": statusTextUsesSoftForeground,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R61")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
