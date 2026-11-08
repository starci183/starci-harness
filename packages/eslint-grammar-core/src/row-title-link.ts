import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import { attributeOf, descendants, elementOf, grammarBindings, isListRow, keyName, propertyOf } from "./lib/row-context.ts"

/**
 * The row title link law (`FE_ROW_TITLE_LINK`): when a row opens, its title is plain text and the row is the one pressable. A
 * `Link` inside a pressable row is a second target on the same row (nested interactive elements, two tab stops, one destination).
 *
 * WHAT IT READS.
 *   - a ListRow data object (a row of the `items` of a list collection, or the `row` of a `<ListRow>`) whose `title` holds a
 *     `Link` while the same object carries `onPress`, `onAction`, `href`, `onFollow` or `chevron`;
 *   - a `DataTable` that opens its rows (`onRowAction`, or an inline `rows` literal or `.map` whose objects carry an `href`)
 *     whose `renderCell` returns a `Link` for the row-header column (the column marked `isRowHeader`, else the first one of an
 *     inline `columns` literal). A `Link` in a branch of another column is not judged; a `Link` outside any column branch is.
 */

/** The keys of a ListRow data object that make the whole row pressable. */
const PRESSABLE_KEYS: readonly string[] = ["onPress", "onAction", "href", "onFollow", "chevron"]

const isFunction = (node: TSESTree.Node): node is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration =>
  node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration"

/** The string literals a test expression compares against. */
const literalsOf = (test: TSESTree.Node, source: Parameters<typeof descendants>[1]): string[] => {
  const found: string[] = []
  for (const node of descendants(test, source)) {
    if (node.type === "Literal" && typeof node.value === "string") found.push(node.value)
  }
  return found
}

export const rowTitleLink: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_ROW_TITLE_LINK: a pressable row's title is plain text, never a Link." },
    schema: [],
    messages: {
      row: "This Link is the title of a row that already opens (`{{key}}`). The row is the one pressable: write the title as plain text (`<Text isStrong>`) and keep the destination on the row.",
      cell: "This Link is the row-header cell of a DataTable whose rows open (`{{why}}`). The row is the one pressable: write the cell as plain text (`<Text isStrong>`) and keep the destination on the row.",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()
    const source = context.sourceCode

    const linksIn = (root: TSESTree.Node): TSESTree.JSXElement[] => {
      const found: TSESTree.JSXElement[] = []
      for (const node of descendants(root, source)) {
        if (node.type === "JSXElement" && elementOf(node.openingElement, bound).grammar === "Link") found.push(node)
      }
      return found
    }

    /** The function a renderCell expression names: itself, or a function declared by that name in this file. */
    const functionOf = (expression: TSESTree.Node): TSESTree.Node | null => {
      if (isFunction(expression)) return expression
      if (expression.type !== "Identifier") return null
      let scope: ReturnType<typeof source.getScope> | null = source.getScope(expression)
      while (scope) {
        const variable = scope.set.get(expression.name)
        if (variable) {
          for (const def of variable.defs) {
            if (def.type === "FunctionName") return def.node as unknown as TSESTree.Node
            { const init = def.node.init as unknown as TSESTree.Node | null; if (init && isFunction(init)) return init }
          }
          return null
        }
        scope = scope.upper
      }
      return null
    }

    /** The id of the row-header column of an inline `columns` literal, or null when it cannot be read. */
    const headerOf = (opening: TSESTree.JSXOpeningElement): string | null => {
      const columns = attributeOf(opening, "columns")?.value
      if (columns?.type !== "JSXExpressionContainer" || columns.expression.type !== "ArrayExpression") return null
      const objects = columns.expression.elements.filter((entry): entry is TSESTree.ObjectExpression => entry?.type === "ObjectExpression")
      const marked = objects.find((column) => {
        const value = propertyOf(column, "isRowHeader")?.value
        return value?.type === "Literal" && value.value === true
      }) ?? objects[0]
      const id = marked ? propertyOf(marked, "id")?.value : undefined
      return id?.type === "Literal" && typeof id.value === "string" ? id.value : null
    }

    /** What makes the rows of a DataTable open, or null when nothing does. */
    const opensRows = (opening: TSESTree.JSXOpeningElement): string | null => {
      if (attributeOf(opening, "onRowAction") !== null) return "onRowAction"
      const rows = attributeOf(opening, "rows")?.value
      if (rows?.type !== "JSXExpressionContainer") return null
      for (const node of descendants(rows.expression, source)) {
        if (node.type === "ObjectExpression" && propertyOf(node, "href") !== null) return "row href"
      }
      return null
    }

    /** Whether a Link in a renderCell function stands in the branch of the header column (or in no column branch at all). */
    const inHeaderBranch = (link: TSESTree.Node, fn: TSESTree.Node, header: string | null): boolean => {
      let constrained = false
      for (let node: TSESTree.Node = link, parent = node.parent; parent != null && node !== fn; node = parent, parent = parent.parent) {
        let tests: string[] | null = null
        let inConsequent = true
        if (parent.type === "SwitchCase") {
          tests = parent.test === null ? [] : literalsOf(parent.test, source)
        } else if ((parent.type === "ConditionalExpression" || parent.type === "IfStatement") && parent.test !== node) {
          tests = literalsOf(parent.test, source)
          inConsequent = parent.consequent === node
        } else if (parent.type === "LogicalExpression" && parent.right === node) {
          tests = literalsOf(parent.left, source)
        }
        if (tests === null || tests.length === 0) {
          if (parent.type === "SwitchCase" && parent.test === null) return false
          continue
        }
        constrained = true
        if (!inConsequent || header === null || !tests.includes(header)) return false
      }
      return !constrained || header !== null
    }

    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
      },
      ObjectExpression(object: TSESTree.ObjectExpression) {
        if (!isListRow(object, bound)) return
        const title = propertyOf(object, "title")
        if (title === null) return
        const key = PRESSABLE_KEYS.find((name) => object.properties.some((property) => property.type === "Property" && keyName(property) === name))
        if (key === undefined) return
        for (const link of linksIn(title.value)) context.report({ node: link, messageId: "row", data: { key } })
      },
      JSXElement(element: TSESTree.JSXElement) {
        const opening = element.openingElement
        if (elementOf(opening, bound).grammar !== "DataTable") return
        const why = opensRows(opening)
        if (why === null) return
        const render = attributeOf(opening, "renderCell")?.value
        if (render?.type !== "JSXExpressionContainer") return
        const fn = functionOf(render.expression)
        if (fn === null) return
        const header = headerOf(opening)
        for (const link of linksIn(fn)) {
          if (inHeaderBranch(link, fn, header)) context.report({ node: link, messageId: "cell", data: { why } })
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "row-title-link": rowTitleLink,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#ROW-TITLE-LINK")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
