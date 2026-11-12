import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { importOf } from "@starci/eslint-canon-fe/lib/bindings.mjs"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"
/**
 * The surface nesting law (HFS R340 `FE_RAISED_SURFACE_IN_SURFACE`): a surface never stands inside another surface. A
 * `SurfaceCard` inside another `SurfaceCard` is refused (0.37.5, owner: a card inside a card is the only nesting refused; a white `Pane surface`, `Drawer`,
 * `Dialog` or `Popover` hosts cards, drawn bordered with no shadow). The Grammar throws the same refusal in development; this is its
 * same-file half, and R356 closes it across files.
 *
 * WHAT IT READS. A `SurfaceCard` element (or `<ns>.SurfaceCard`) imported from `@starci/grammar` that a `SurfaceCard`,
 * `SurfaceCard` of the same file encloses. A surface nobody encloses in this file
 * (its parent may nest it) is judged where the parent is written.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

const GRAMMAR_SOURCE = /^@starci\/grammar(?:\/(?:common|core|offset-pop))?$/
/** Surfaces and overlays whose content is a surface. */
const HOSTS = new Set(["SurfaceCard"])

/** The element name of a JSX name: `SurfaceCard`, or `G.SurfaceCard` as `SurfaceCard`. */
const nameOf = (name: TSESTree.JSXTagNameExpression): string | null => {
  if (name.type === "JSXIdentifier") return name.name
  if (name.type === "JSXMemberExpression") return name.property.name
  return null
}

/** The leftmost identifier of a JSX name. */
const rootOf = (name: TSESTree.JSXTagNameExpression): TSESTree.JSXIdentifier | null => {
  if (name.type === "JSXIdentifier") return name
  if (name.type === "JSXMemberExpression") return rootOf(name.object)
  return null
}

/** True when an opening element names the Grammar component `wanted`, or one of a set. */
const isGrammar = (context: Context, opening: TSESTree.JSXOpeningElement, wanted: ReadonlySet<string>): string | null => {
  const root = rootOf(opening.name)
  const name = nameOf(opening.name)
  if (root === null || name === null || !wanted.has(name)) return null
  const imported = importOf(context, root)
  return imported !== null && imported !== undefined && GRAMMAR_SOURCE.test(imported.source) ? name : null
}

/** The host that encloses this card's content in the same file, or null. A host's attributes (a `trigger`) do not enclose. */
const enclosingHost = (context: Context, opening: TSESTree.JSXOpeningElement): string | null => {
  let previous: Node = opening
  for (let current: Node | null | undefined = opening.parent?.parent; current !== undefined && current !== null; previous = current, current = current.parent) {
    if (current.type !== "JSXElement") continue
    // `previous` is a child of the element, or its opening tag when the walk came up through an attribute.
    if (previous === current.openingElement) continue
    const name = isGrammar(context, current.openingElement, HOSTS)
    if (name === null) continue
    if (name === "Pane" && !current.openingElement.attributes.some((entry) => entry.type === "JSXAttribute" && entry.name.type === "JSXIdentifier" && entry.name.name === "surface")) continue
    return name
  }
  return null
}

/** A surface inside another surface is refused. */
export const noRaisedSurfaceInSurface: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R340: a SurfaceCard never stands inside another SurfaceCard." },
    schema: [],
    messages: {
      nested:
        "This `SurfaceCard` stands inside {{host}}: a surface never stands inside a surface (the Grammar has one depth and draws no nested edge). Give the content to the host's own body, or use a kind of the outer card (`bands`, `list`, `figures`) for what needs its own faces.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        if (isGrammar(context, opening, new Set(["SurfaceCard"])) === null) return
        const host = enclosingHost(context, opening)
        if (host === null) return
        const label = host === "SurfaceCard" ? "another `SurfaceCard`" : host === "Pane" ? "a `Pane surface`" : `a \`${host}\``
        context.report({ node: opening, messageId: "nested", data: { host: label } })
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
