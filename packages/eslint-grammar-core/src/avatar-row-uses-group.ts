import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { elementNameOf, grammarName, renderedChildren } from "./lib/grammar-jsx.ts"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import type { Context, Node } from "./lib/types.ts"

/**
 * AVATARS IN A ROW ARE ONE AVATARGROUP (DNA-COMMON-AVATAR-ROW-GROUP; owner, 2026-11-22: "với providers phải render AvatarGroup với nhiều hơn 5 thì +2 đồ chứ?? .claude sao k ép
 * tụi này render sáng tạo nhỉ"). Avatars that stand side by side, or that come out of a list, are `<AvatarGroup items max>`: it overlaps them, shows `max - 1` and the "+N" tile,
 * names every member on hover, and takes people and provider or channel marks alike. A hand-made row of `Avatar` has none of that and every app draws its own overflow.
 *
 * WHAT IT READS. In product source, a Grammar `Avatar` that (a) shares its parent with another Grammar `Avatar` (siblings, looked through fragments, conditions and `&&`), or
 * (b) is returned from a `.map()` callback, and that has no Grammar `AvatarGroup` among its JSX ancestors in the same file. An element passed as a JSX attribute value is judged
 * where the receiver draws it.
 *
 * WHAT IT LEAVES ALONE. A single `Avatar`, an `AvatarButton`, an `Avatar` inside an `AvatarGroup`, and non-product source; Grammar's own `AvatarGroup` is not product source.
 */

const AVATAR = "Avatar"
const GROUP = "AvatarGroup"

const isAvatar = (context: Context, node: Node): boolean =>
  node.type === "JSXElement" && elementNameOf(node) === AVATAR && grammarName(context, node.openingElement) === AVATAR

/** True when a Grammar `AvatarGroup` encloses the element in this file. */
const hasGroupAncestor = (context: Context, opening: TSESTree.JSXOpeningElement): boolean => {
  let previous: Node = opening
  for (let current: Node | null | undefined = opening.parent?.parent; current !== undefined && current !== null; previous = current, current = current.parent) {
    if (current.type !== "JSXElement" || previous === current.openingElement) continue
    if (grammarName(context, current.openingElement) === GROUP) return true
  }
  return false
}

/** True when the element is returned from a `.map()` callback: through the JSX, conditions and the callback's `return`, up to the callback itself. */
const isMapped = (opening: TSESTree.JSXOpeningElement): boolean => {
  for (let current: Node | null | undefined = opening.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type === "JSXAttribute") return false
    if (current.type !== "ArrowFunctionExpression" && current.type !== "FunctionExpression") continue
    const call = current.parent
    if (call?.type !== "CallExpression" || call.arguments[0] !== current) return false
    const callee = call.callee
    return callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "map"
  }
  return false
}

/** The JSX element or fragment whose children hold this element (expression wrappers looked through), or null when it is not a child. */
const hostOf = (element: TSESTree.JSXElement): TSESTree.JSXElement | TSESTree.JSXFragment | null => {
  for (let current: Node | null | undefined = element.parent; current !== undefined && current !== null; current = current.parent) {
    if (current.type === "JSXElement" || current.type === "JSXFragment") return current
    if (current.type === "JSXAttribute") return null
    if (current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression" || current.type === "ReturnStatement" || current.type === "BlockStatement") return null
  }
  return null
}

/** Avatars as siblings, or an Avatar from a map, stand in an `AvatarGroup`. */
export const avatarRowUsesGroup: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "DNA-COMMON-AVATAR-ROW-GROUP: two or more `Avatar` siblings, or an `Avatar` returned from `.map()`, outside an `AvatarGroup` are refused; use `<AvatarGroup items max>`." },
    schema: [],
    messages: {
      siblings: "This `Avatar` stands beside another `Avatar`. Avatars in a row are ONE group: `<AvatarGroup label items={[{ id, name, seed } or { id, name, mark }]} max overflowLabel />` overlaps them, shows `max - 1` and a \"+N\" tile, and names every member on hover.",
      mapped: "This `Avatar` is returned from `.map()`. A list of avatars is ONE group: `<AvatarGroup label items={…} max overflowLabel />` (people by `name` and `seed`, providers and channels by `mark`) draws the overlap and the \"+N\" tile; do not map `Avatar`.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    return {
      JSXOpeningElement(opening: TSESTree.JSXOpeningElement) {
        if (grammarName(context, opening) !== AVATAR) return
        const element = opening.parent
        if (element?.type !== "JSXElement" || hasGroupAncestor(context, opening)) return
        if (isMapped(opening)) {
          context.report({ node: opening as never, messageId: "mapped" })
          return
        }
        const host = hostOf(element)
        if (host === null) return
        const avatars = renderedChildren(host.children).filter((child) => isAvatar(context, child))
        // The first stands alone as far as this rule goes; each one after it is the second that makes a row.
        if (avatars.length >= 2 && avatars[0] !== element) context.report({ node: opening as never, messageId: "siblings" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "avatar-row-uses-group": avatarRowUsesGroup,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#AVATAR-ROW-GROUP")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
