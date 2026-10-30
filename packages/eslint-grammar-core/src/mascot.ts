import type { Rule, Scope } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Node } from "./lib/types.ts"
/**
 * The mascot law (HFS R337 `FE_GENERATED_ART_OUTSIDE_FRAME`, R338 `FE_MASCOT_ASSET_SLOT_MISSING`): generated art renders
 * at the Grammar's size scale and stays tied to the asset workflow's request.
 *
 * Generated art is a raster the asset workflow delivers under the public `/images/` tree, as `.webp` or `.png`. Drawn
 * through a bare `Image` or `<img>` it takes whatever box its page gives it, so one mascot comes out at a different size on
 * every screen and nothing ties the bytes to the slot that requested them. Grammar's `Mascot` owns the character scale
 * (sm, md, lg, hero), and `MediaFrame` frames a scene or illustration; those two are its renderers.
 *
 * WHAT IT READS. A JSX `src` attribute whose value is statically a string (a literal, an expression container holding one,
 * a template literal without expressions, or a `const` of the file initialised with one). A source computed at run time is
 * not judged: the rule never guesses. `assetSlot` is read on every `Mascot` element (`Mascot` or `<ns>.Mascot`); a spread
 * attribute may carry it, so an element with a spread is not judged.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`: the route, feature, component, hook, foundation, module and transport
 * tiers and the workspace packages). A script or a file no slot owns is not judged.
 */

/** A generated raster under the public `/images/` tree: `.webp` or `.png`, any case, an optional query or fragment. */
export const GENERATED_ART = /^\/images\/.+\.(?:webp|png)(?:[?#].*)?$/i

/** The components that render generated art: the element itself, or an ancestor that frames it. */
const RENDERER = "Mascot"
const FRAME = "MediaFrame"

/** The element name of a JSX name: `Mascot`, or `G.Mascot` as `Mascot`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The variable a name resolves to, walking the scope chain outwards. */
const variableOf = (scope: Scope.Scope | null, name: string): Scope.Variable | null => {
  for (let current = scope; current !== null; current = current.upper) {
    const found = current.set.get(name)
    if (found !== undefined) return found
  }
  return null
}

/** The string an expression statically is, or null. */
const staticString = (expression: Node, scopeOf: (node: Node) => Scope.Scope): string | null => {
  if (expression.type === "Literal") return typeof expression.value === "string" ? expression.value : null
  if (expression.type === "TemplateLiteral") return expression.expressions.length === 0 ? expression.quasis.map((quasi) => quasi.value.cooked ?? "").join("") : null
  if (expression.type === "Identifier") {
    const variable = variableOf(scopeOf(expression), expression.name)
    const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined
    if (definition?.type !== "Variable") return null
    const declarator = definition.node as unknown as TSESTree.VariableDeclarator
    const declaration = definition.parent as unknown as TSESTree.VariableDeclaration | null
    if (declaration?.kind !== "const" || declarator.init === null || declarator.init.type === "Identifier") return null
    return staticString(declarator.init, scopeOf)
  }
  return null
}

/** The string a JSX attribute value statically is, or null. */
const attributeString = (value: TSESTree.JSXAttribute["value"], scopeOf: (node: Node) => Scope.Scope): string | null => {
  if (value === null) return null
  if (value.type === "Literal") return typeof value.value === "string" ? value.value : null
  if (value.type === "JSXExpressionContainer" && value.expression.type !== "JSXEmptyExpression") return staticString(value.expression, scopeOf)
  return null
}

/** True when a `MediaFrame` element encloses the node. */
const insideFrame = (node: Node): boolean => {
  // The Program's parent is null at run time though the tree's types say a node always has one.
  for (let current: Node | null | undefined = node.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type === "JSXElement" && nameOf(current.openingElement.name) === FRAME) return true
  }
  return false
}

/** Generated art under `/images/` renders only through `Mascot` or inside a `MediaFrame`. */
export const generatedArtInMascotOrMediaFrame: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R337: generated art (a .webp or .png under /images/) renders only through Grammar's Mascot or inside a MediaFrame." },
    schema: [],
    messages: {
      outside:
        "`{{src}}` is generated art drawn by `<{{element}}>`, outside Grammar's `Mascot` and `MediaFrame`: it takes whatever box this page gives it, so the same art comes out at a different size on every screen. Render a character with `<Mascot src size assetSlot />` (sm, md, lg or hero) or frame a scene or illustration in `<MediaFrame assetSlot>`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const scopeOf = (node: Node): Scope.Scope => context.sourceCode.getScope(node)
    return {
      JSXAttribute(attribute) {
        if (attribute.name.type !== "JSXIdentifier" || attribute.name.name !== "src") return
        const src = attributeString(attribute.value, scopeOf)
        if (src === null || !GENERATED_ART.test(src)) return
        const opening = attribute.parent
        if (opening.type !== "JSXOpeningElement") return
        const element = nameOf(opening.name)
        if (element === RENDERER || insideFrame(opening)) return
        context.report({ node: attribute, messageId: "outside", data: { src, element: element ?? "element" } })
      },
    }
  },
})

/** True when an attribute names nothing: no value, an empty string, or `undefined`. */
const namesNothing = (attribute: TSESTree.JSXAttribute): boolean => {
  const value = attribute.value
  if (value === null) return true
  if (value.type === "Literal") return value.value === ""
  if (value.type !== "JSXExpressionContainer") return false
  const expression = value.expression
  if (expression.type === "JSXEmptyExpression") return true
  if (expression.type === "Identifier") return expression.name === "undefined"
  if (expression.type === "Literal") return expression.value === "" || expression.value === null
  if (expression.type === "TemplateLiteral") return expression.expressions.length === 0 && expression.quasis.every((quasi) => quasi.value.cooked === "")
  return false
}

/** Every `Mascot` names the asset slot its art was requested under. */
export const mascotAssetSlotRequired: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R338: every Grammar Mascot names its asset slot (assetSlot), tying the rendered art to the asset workflow's request." },
    schema: [],
    messages: {
      missing:
        "This `Mascot` names no `assetSlot`: nothing ties the art it draws to the asset workflow's request, so a drawing, a test or an audit cannot tell which slot it fills. Pass `assetSlot` (and `assetSha256` once the file is delivered).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening) {
        if (nameOf(opening.name) !== RENDERER) return
        if (opening.attributes.some((attribute) => attribute.type === "JSXSpreadAttribute")) return
        const slot = opening.attributes.find((attribute): attribute is TSESTree.JSXAttribute => attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "assetSlot")
        if (slot === undefined || namesNothing(slot)) context.report({ node: opening, messageId: "missing" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "generated-art-in-mascot-or-media-frame": generatedArtInMascotOrMediaFrame,
  "mascot-asset-slot-required": mascotAssetSlotRequired,
}

defineFamilyRules({ "generated-art-in-mascot-or-media-frame": generatedArtInMascotOrMediaFrame }, "knowledge/hfs/rules.yaml#R337")
defineFamilyRules({ "mascot-asset-slot-required": mascotAssetSlotRequired }, "knowledge/hfs/rules.yaml#R338")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
