import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { elementNameOf, grammarName, nameOf, renderedChildren, stringProp } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context } from "./lib/types.ts"
/**
 * The row list law (owner, 2026-11-09, SURFACE-IN-SURFACE): rows divided by lines that stand inside a surface are a
 * nested surface (a 1px separator border, the card radius, clipped). The Grammar draws that itself for a
 * `Section kind="list"` placed in a card body, a drawer, a dialog, a pane band or a rail. The bare form an app can still
 * reach is a hand-made row list, which has no edge, no radius and no clip.
 *
 * WHAT IT READS. A `Stack` (Grammar), `ul`, `ol` or `div` whose rendered children (looked through fragments,
 * `cond && <x/>` and `.map`) include a Grammar `Divider` between other children, inside a `SurfaceCard`, `Drawer`,
 * `Dialog`, `PaneSection`, or the `rail` of a `Grid kind="main-rail"`. Only the list element is reported.
 *
 * WHAT IT LEAVES ALONE. A card inside a card is `no-raised-surface-in-surface` (R340) and a `Divider` directly in a
 * `body` SurfaceCard is `surface-card-kind` (R355); neither is read again here. A list outside a surface, a
 * Divider that separates nothing (the only child), and a list in an overlay `trigger` are not judged.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */

/** The surfaces a hand-made row list does not stand in bare. */
const HOSTS = new Set(["SurfaceCard", "Drawer", "Dialog", "PaneSection"])
/** The plain elements a hand-made list is written with. */
const PLAIN_LISTS = new Set(["ul", "ol", "div"])

/** True when the element is a row list candidate: a Grammar `Stack`, or a plain `ul`, `ol` or `div`. */
const isListElement = (context: Context, element: TSESTree.JSXElement): boolean => {
  const opening = element.openingElement
  if (opening.name.type === "JSXIdentifier" && PLAIN_LISTS.has(opening.name.name)) return true
  return grammarName(context, opening) === "Stack"
}

/** True when the list's children are divided by a Grammar `Divider`. */
const dividedByDividers = (context: Context, element: TSESTree.JSXElement): boolean => {
  const children = renderedChildren(element.children)
  const dividers = children.filter((child) => child.type === "JSXElement" && elementNameOf(child) === "Divider" && grammarName(context, child.openingElement) === "Divider")
  return dividers.length > 0 && children.length > dividers.length
}

/** The surface that encloses a node in the same file, or null. Attributes are not content except a main-rail grid's `rail`. */
const enclosingSurface = (context: Context, node: TSESTree.Node): string | null => {
  for (let current: TSESTree.Node | undefined = node.parent; current; current = current.parent) {
    if (current.type === "JSXAttribute") {
      const opening = current.parent
      const isRail = current.name.type === "JSXIdentifier" && current.name.name === "rail" && grammarName(context, opening) === "Grid" && stringProp(opening, "kind") === "main-rail"
      return isRail ? "the rail of a `Grid kind=\"main-rail\"`" : null
    }
    if (current.type !== "JSXElement") continue
    const name = grammarName(context, current.openingElement)
    if (name !== null && HOSTS.has(name)) return `a \`${name}\``
  }
  return null
}

/** Rows divided by lines inside a surface are the Grammar's list, never a hand-made one. */
export const surfaceInSurface: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "SURFACE-IN-SURFACE: a row list divided by Dividers inside a card, drawer, dialog, pane band or rail is a Section kind=list or a SurfaceCard kind=list." },
    schema: [],
    messages: {
      handMade:
        "This `{{element}}` is a hand-made row list inside {{host}}: its rows are divided by `Divider` elements, so it has no edge, no card radius and no clip. Use `<Section kind=\"list\">` for rows inside a surface (the Grammar draws them as a nested surface), or `<SurfaceCard kind=\"list\">` when the list is the card.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXElement(element) {
        if (!isListElement(context, element) || !dividedByDividers(context, element)) return
        const host = enclosingSurface(context, element)
        if (host === null) return
        context.report({ node: element.openingElement, messageId: "handMade", data: { element: nameOf(element.openingElement.name) ?? "list", host } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "surface-in-surface": surfaceInSurface,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#SURFACE-IN-SURFACE")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
