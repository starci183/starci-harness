import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { inSlot, isProductSource, kindOfFile } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { attributeOf, grammarName } from "./lib/grammar-jsx.ts"
import { mountedOnlyUnderAuthGroup } from "./lib/page-frame.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"
/**
 * The breadcrumbs law (owner, 2026-11-09, PAGE-BREADCRUMBS): every console page states its trail. A `Page` whose
 * `header` has no `breadcrumbs` leaves the reader without a way up; the root page of a console says so with
 * `breadcrumbs: "root"` (the Grammar's `PageHeaderBreadcrumbs | "root"`; "root" draws no trail).
 *
 * WHAT IT READS. A Grammar `Page` whose `header` is an object literal written in place, or an identifier of a `const`
 * of the same file that holds one; the finding is a `header` object with no `breadcrumbs` property. A `header` that is
 * absent (a sign-in card, a landing), not an object literal (another expression, an imported value, a parameter), or
 * holds a spread (`{ ...base }`, the property may arrive through it) is not judged.
 *
 * WHICH PAGES ARE CONSOLE PAGES. The app console is every page of the app that sits inside its shell, so the rule
 * judges a `Page` drawn in:
 * - a page owner or a layout owner (`fe.feature`, kind `pages` or `layouts`), unless it is a segment boundary owner
 *   (`*ErrorPage`, `*LoadingPage`, `*NotFoundPage`) or every route that mounts the owner lies under the app's `(auth)`
 *   route group (sign-in, sign-up, password: the same reading `route-page-is-one-page` uses);
 * - an app block (`fe.components`, kind `blocks`), because a page owner may hand its `Page` to the one connected block
 *   that draws it from client data.
 * A `Page` drawn elsewhere (a script, a story, a library) is not a console page.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The segment boundary owners of FE-BOUNDARY-1: they stand in for whichever page failed or waits. */
const BOUNDARY_OWNER = /\/features\/pages\/[^/]*(?:ErrorPage|LoadingPage|NotFoundPage)\//

/** True when the file draws console pages (see the header comment). */
const isConsoleFile = (context: Context): boolean => {
  if (inSlot(context, "fe.components")) return kindOfFile(context) === "blocks"
  if (!inSlot(context, "fe.feature")) return false
  const kind = kindOfFile(context)
  if (kind !== "pages" && kind !== "layouts") return false
  if (BOUNDARY_OWNER.test(context.filename.replaceAll("\\", "/"))) return false
  return !mountedOnlyUnderAuthGroup(context)
}

/** The object literal a `header` attribute passes: in place, or a `const` of the same file; null for anything else. */
const headerObject = (context: Context, attribute: TSESTree.JSXAttribute): TSESTree.ObjectExpression | null => {
  const value = attribute.value?.type === "JSXExpressionContainer" ? attribute.value.expression : null
  if (value === null) return null
  if (value.type === "ObjectExpression") return value
  if (value.type !== "Identifier") return null
  for (let scope: ReturnType<Context["sourceCode"]["getScope"]> | null = context.sourceCode.getScope(attribute); scope; scope = scope.upper) {
    const definition = scope.set.get(value.name)?.defs[0]
    if (definition === undefined) continue
    const declarator = definition.node as TSESTree.Node
    return declarator.type === "VariableDeclarator" && declarator.init?.type === "ObjectExpression" ? declarator.init : null
  }
  return null
}

/** True when an object states `breadcrumbs`, or holds a spread that may carry it. */
const statesBreadcrumbs = (object: TSESTree.ObjectExpression): boolean =>
  object.properties.some((property) => {
    if (property.type === "SpreadElement") return true
    const key = property.key
    return (key.type === "Identifier" && !property.computed && key.name === "breadcrumbs") || (key.type === "Literal" && key.value === "breadcrumbs")
  })

/** A console page's header states its breadcrumbs. */
export const pageBreadcrumbs: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "PAGE-BREADCRUMBS: the header of a console Page states breadcrumbs, or breadcrumbs: \"root\" for the root page." },
    schema: [],
    messages: {
      missing:
        "This `Page` header states no `breadcrumbs`: every console page gives its trail so the reader can go up. Add `breadcrumbs: { label, items }` (the ancestors, nearest last), or `breadcrumbs: \"root\"` when this is the root page of the console (it draws no trail).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let console: boolean | null = null
    return {
      JSXOpeningElement(opening) {
        if (grammarName(context, opening) !== "Page") return
        const header = attributeOf(opening, "header")
        if (header === undefined) return
        const object = headerObject(context, header)
        if (object === null || statesBreadcrumbs(object)) return
        console ??= isConsoleFile(context)
        if (console) context.report({ node: object.range[0] >= opening.range[0] && object.range[1] <= opening.range[1] ? object : header, messageId: "missing" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "page-breadcrumbs": pageBreadcrumbs,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#PAGE-BREADCRUMBS")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
