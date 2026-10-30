import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Node } from "./lib/types.ts"
/**
 * The surface depth law (HFS R340 `FE_RAISED_SURFACE_IN_SURFACE`; Grammar BOUNDARY-5 and BOUNDARY-6, DNA
 * `DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`): a surface inside another surface is subordinate (outlined, BOUNDARY-5), never
 * raised (BOUNDARY-6) again.
 *
 * Grammar's bounded surfaces read their depth from the surface context (`useSurfaceNesting`): `SurfaceCard`,
 * `SurfaceAccordionCard` and `SurfaceListCard` draw outlined inside another surface and raised only at the top.
 * `SurfaceListCard` alone also takes a `depth` prop that overrides the context, so `depth="top"` on a list that sits inside
 * another surface raises a surface inside a surface.
 *
 * WHAT IT READS. A `depth` attribute whose value is the string `"top"` (a literal, or an expression container holding one)
 * on a depth-accepting surface element (`SurfaceListCard` or `<ns>.SurfaceListCard`), when a `SurfaceCard`,
 * `SurfaceListCard` or `SurfaceAccordionCard` element of the same file encloses it. A depth computed at run time is not
 * judged, and neither is a surface nobody encloses in this file (its parent may nest it; Grammar resolves that).
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The bounded surfaces that open a surface context for what they enclose. */
const SURFACES = new Set(["SurfaceCard", "SurfaceListCard", "SurfaceAccordionCard"])
/** The surfaces that accept a `depth` prop overriding the one read from context. */
const DEPTH_PROP = new Set(["SurfaceListCard"])

/** The element name of a JSX name: `SurfaceCard`, or `G.SurfaceCard` as `SurfaceCard`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** True when a bounded surface element encloses the element the opening tag belongs to. */
const insideSurface = (opening: Node): boolean => {
  // The opening tag's parent is the element itself, so the walk starts above that; the Program's parent is null at run time
  // though the tree's types say a node always has one.
  for (let current: Node | null | undefined = opening.parent?.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type !== "JSXElement") continue
    const name = nameOf(current.openingElement.name)
    if (name !== null && SURFACES.has(name)) return true
  }
  return false
}

/** True when an attribute value is statically the string `"top"`. */
const isTop = (value: TSESTree.JSXAttribute["value"]): boolean => {
  if (value === null) return false
  if (value.type === "Literal") return value.value === "top"
  if (value.type !== "JSXExpressionContainer") return false
  const expression = value.expression
  if (expression.type === "Literal") return expression.value === "top"
  return expression.type === "TemplateLiteral" && expression.expressions.length === 0 && expression.quasis.length === 1 && expression.quasis[0]?.value.cooked === "top"
}

/** A surface inside another surface never forces `depth="top"`: it is subordinate, and the Grammar resolves it. */
export const noRaisedSurfaceInSurface: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R340: a Grammar surface nested in another surface does not force depth=\"top\" (BOUNDARY-6); a nested surface is subordinate (BOUNDARY-5)." },
    schema: [],
    messages: {
      raised:
        "`<{{element}} depth=\"top\">` is nested inside another Grammar surface, so it raises a surface inside a surface (BOUNDARY-6, DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE): a nested surface is subordinate (outlined, BOUNDARY-5). Drop `depth` and let the Grammar resolve it from the surface context.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXAttribute(attribute) {
        if (attribute.name.type !== "JSXIdentifier" || attribute.name.name !== "depth" || !isTop(attribute.value)) return
        const opening = attribute.parent
        if (opening.type !== "JSXOpeningElement") return
        const element = nameOf(opening.name)
        if (element === null || !DEPTH_PROP.has(element) || !insideSurface(opening)) return
        context.report({ node: attribute, messageId: "raised", data: { element } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "no-raised-surface-in-surface": noRaisedSurfaceInSurface,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R340")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
