import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"

/**
 * The laws of text and emphasis (HFS R357, R358, R359).
 *
 *   text-inline-only (R357)          `Text` is a run of words: a block component inside it is a layout drawn in a paragraph.
 *   no-text-heading (R358)           a strong `Text` that only heads a group of blocks is a hand heading: use `Section`, a card
 *                                    `label` or `Heading`, which own the level, the spacing and the outline.
 *   one-highlight-per-render (R359)  a render states one highlighted thing (G-9): a second `isHighlight` dilutes the first.
 *
 * WHAT THEY READ. Grammar names are resolved through the file's own imports from `@starci/grammar`, so an alias or a local
 * component of the same name is not judged. A spread attribute or a computed value is not judged.
 */

/** Components that lay content out as blocks: none of them belongs inside a run of text. */
export const BLOCK_COMPONENTS: ReadonlySet<string> = new Set([
  "Stack", "Cluster", "Grid", "Section", "SurfaceCard", "DataTable", "Heading", "DescriptionList",
  "Divider", "Page", "Pane", "PaneGrid", "PaneSection", "Form", "Fieldset", "Quote", "Alert", "Stepper", "Timeline", "MarkdownArticle", "EmptyNotice",
  "ListRow", "StaticStateRow", "SegmentedControl", "FilterButtonGroup", "Tabs",
])

/** Plain elements that are blocks. */
const BLOCK_TAGS: ReadonlySet<string> = new Set(["div", "p", "ul", "ol", "li", "section", "article", "table", "form", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote"])

/** The Grammar export a file's import binds to a local name. */
const grammarImports = (program: TSESTree.Program): Map<string, string> => {
  const bound = new Map<string, string>()
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || typeof statement.source.value !== "string" || !/^@starci\/grammar(?:\/|$)/.test(statement.source.value)) continue
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier") bound.set(specifier.local.name, specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value))
    }
  }
  return bound
}

const nameOf = (opening: TSESTree.JSXOpeningElement, bound: ReadonlyMap<string, string>): { readonly grammar: string | null; readonly tag: string | null } => {
  const name = opening.name
  if (name.type !== "JSXIdentifier") return { grammar: null, tag: null }
  const grammar = bound.get(name.name)
  if (grammar !== undefined) return { grammar, tag: null }
  return { grammar: null, tag: name.name === name.name.toLowerCase() ? name.name : null }
}

const isBlock = (element: TSESTree.JSXElement, bound: ReadonlyMap<string, string>): boolean => {
  const { grammar, tag } = nameOf(element.openingElement, bound)
  return (grammar !== null && BLOCK_COMPONENTS.has(grammar)) || (tag !== null && BLOCK_TAGS.has(tag))
}

/** Whether an attribute is present and not statically false; a spread or a computed value counts as unknown (false). */
const isOn = (opening: TSESTree.JSXOpeningElement, attribute: string): boolean =>
  opening.attributes.some((entry) => {
    if (entry.type !== "JSXAttribute" || entry.name.type !== "JSXIdentifier" || entry.name.name !== attribute) return false
    const value = entry.value
    if (value === null) return true
    if (value.type === "JSXExpressionContainer") return value.expression.type === "Literal" && value.expression.value === true
    return false
  })

const meaningful = (children: readonly TSESTree.JSXChild[]): TSESTree.JSXChild[] =>
  children.filter((child) => !(child.type === "JSXText" && child.value.trim() === "") && !(child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression"))

const textInlineOnly: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R357: Text holds a run of words; a block component inside it is refused.", url: "knowledge/hfs/rules.yaml#R357" },
    schema: [],
    messages: { block: "`{{name}}` is a block, and `Text` is a run of words: a block inside it is a layout drawn in a paragraph. Close the `Text` and place the block beside it, or use the component that owns that layout." },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound = new Map<string, string>()
    return {
      Program(node) { bound = grammarImports(node) },
      JSXElement(node) {
        if (nameOf(node.openingElement, bound).grammar !== "Text") return
        for (const child of node.children) {
          if (child.type !== "JSXElement" || !isBlock(child, bound)) continue
          const { grammar, tag } = nameOf(child.openingElement, bound)
          context.report({ node: child.openingElement, messageId: "block", data: { name: grammar ?? tag ?? "element" } })
        }
      },
    }
  },
})

const noTextHeading: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R358: a strong Text alone heading a group of blocks is a hand heading.", url: "knowledge/hfs/rules.yaml#R358" },
    schema: [],
    messages: { heading: "This strong `Text` only titles the blocks that follow it, which is a heading written by hand: it has no level in the outline and each page spaces it differently. Give the group a `Section` title, a card `label`, or `Heading`." },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound = new Map<string, string>()
    const check = (parent: TSESTree.JSXElement | TSESTree.JSXFragment): void => {
      const children = meaningful(parent.children)
      const [first, ...rest] = children
      if (first === undefined || first.type !== "JSXElement" || rest.length === 0) return
      if (nameOf(first.openingElement, bound).grammar !== "Text" || !isOn(first.openingElement, "isStrong")) return
      if (first.children.some((child) => child.type === "JSXElement" && isBlock(child, bound))) return
      if (rest.every((child) => child.type === "JSXElement" && isBlock(child, bound))) context.report({ node: first.openingElement, messageId: "heading" })
    }
    return { Program(node) { bound = grammarImports(node) }, JSXElement: check, JSXFragment: check }
  },
})

type FunctionLike = TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression

const oneHighlightPerRender: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R359: a render states one highlighted thing; a second isHighlight is refused.", url: "knowledge/hfs/rules.yaml#R359" },
    schema: [],
    messages: { second: "A second `isHighlight` in one render: when two things are highlighted neither is, and the eye has no first place to land. Keep the one that matters now and give the other its plain state." },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound = new Map<string, string>()
    const seen = new WeakMap<FunctionLike, number>()
    const enclosing = (node: TSESTree.Node): FunctionLike | null => {
      for (let current: TSESTree.Node | undefined = node.parent; current; current = current.parent) {
        if (current.type === "ArrowFunctionExpression" || current.type === "FunctionDeclaration" || current.type === "FunctionExpression") {
          // a callback of a map/filter is one render of many rows, not a second thing in the same render
          const parent = current.parent
          if (current.type !== "FunctionDeclaration" && parent?.type === "CallExpression" && parent.callee.type === "MemberExpression") continue
          return current
        }
      }
      return null
    }
    return {
      Program(node) { bound = grammarImports(node) },
      JSXOpeningElement(node) {
        if (nameOf(node, bound).grammar === null || !isOn(node, "isHighlight")) return
        const fn = enclosing(node)
        if (fn === null) return
        const count = (seen.get(fn) ?? 0) + 1
        seen.set(fn, count)
        if (count > 1) context.report({ node, messageId: "second" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "text-inline-only": textInlineOnly,
  "no-text-heading": noTextHeading,
  "one-highlight-per-render": oneHighlightPerRender,
}

defineFamilyRules(rules, "knowledge/hfs/rules.yaml#R357")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
