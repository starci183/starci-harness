import type { Rule } from "eslint"
import type { TSESTree } from "@typescript-eslint/types"
import { isProductSource } from "@starci/eslint-canon-fe/lib/scope.mjs"
import { defineFamilyRules, defineRule } from "./lib/rule-contract.ts"
import { attributeOf, descendants, elementOf, grammarBindings, isListRow, keyName, literalAttribute, propertyOf } from "./lib/row-context.ts"

/**
 * The table and row type law (`FE_TABLE_CELL_TYPE`): the cells of a DataTable and the copy of a ListRow take the row type sizes,
 * the final type scale: 14px text (`Text`, `Text size="md"`, `Text size="sm"`; the primary is 14 / 500 `Text isStrong`, the
 * secondary 14 muted) and 12px for small names (`Text size="xs"`). A Text of another size (`lg`, `xl`, `figure`), a `Heading`, a `Label` or an `h1`-`h6` in a cell or a row is a heading drawn in a list.
 *
 * WHAT IT READS.
 *   - the function a `DataTable` takes as `renderCell` (inline, or a function or arrow declared by name in the file), and the
 *     `editor` function of a column object in its `columns` literal;
 *   - the `title` and `description` of a ListRow data object: a row of the `items` of a list collection (`{ kind: "list", items }`,
 *     or `Section` / `SurfaceCard` written `kind="list"`), through `.map` callbacks, or the `row` of a `<ListRow>`.
 * In those, a `Text` whose literal `size` is not `xs`, `sm` or `md`, any `Heading`, any `Label` and the tags `h1`-`h6` are findings. A row list declared elsewhere
 * and passed by name is not followed.
 */

/** The Text sizes a cell or row takes: 14 (md, sm) and 12 (xs). */
const CELL_SIZES: ReadonlySet<string> = new Set(["xs", "sm", "md"])

const HEADING_TAGS: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])

const isFunction = (node: TSESTree.Node): node is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration =>
  node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration"

export const tableCellType: Rule.RuleModule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_TABLE_CELL_TYPE: no Text above 14, Heading, Label or h1-h6 in a DataTable cell or a ListRow." },
    schema: [],
    messages: {
      heading:
        "{{what}} in {{where}} is a heading drawn in a list. The primary of a row or a cell is 14 / 500 (`<Text isStrong>`), the secondary 14 muted (`<Text tone=\"muted\">`), a small name (meta, count, timestamp) 12 (`<Text size=\"xs\" tone=\"muted\">`).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    let bound: ReadonlyMap<string, string> = new Map()
    const source = context.sourceCode
    const reported = new Set<TSESTree.Node>()

    /** Report every heading-size element under a node. */
    const scan = (root: TSESTree.Node, where: string): void => {
      for (const node of descendants(root, source)) {
        if (node.type !== "JSXElement" || reported.has(node)) continue
        const { grammar, tag } = elementOf(node.openingElement, bound)
        let what: string | null = null
        const size = grammar === "Text" ? literalAttribute(node.openingElement, "size") : null
        if (size !== null && !CELL_SIZES.has(size)) what = `\`Text size="${size}"\``
        else if (grammar === "Heading" || grammar === "Label") what = `\`${grammar}\``
        else if (tag !== null && HEADING_TAGS.has(tag)) what = `\`<${tag}>\``
        if (what === null) continue
        reported.add(node)
        context.report({ node, messageId: "heading", data: { what, where } })
      }
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

    return {
      Program(program: TSESTree.Program) {
        bound = grammarBindings(program)
      },
      JSXElement(element: TSESTree.JSXElement) {
        if (elementOf(element.openingElement, bound).grammar !== "DataTable") return
        const render = attributeOf(element.openingElement, "renderCell")?.value
        if (render?.type === "JSXExpressionContainer") {
          const fn = functionOf(render.expression)
          if (fn) scan(fn, "a DataTable cell")
        }
        const columns = attributeOf(element.openingElement, "columns")?.value
        if (columns?.type !== "JSXExpressionContainer" || columns.expression.type !== "ArrayExpression") return
        for (const column of columns.expression.elements) {
          if (column?.type !== "ObjectExpression") continue
          const editor = propertyOf(column, "editor")?.value
          if (editor && isFunction(editor)) scan(editor, "a DataTable cell")
        }
      },
      ObjectExpression(object: TSESTree.ObjectExpression) {
        if (!isListRow(object, bound)) return
        for (const property of object.properties) {
          if (property.type !== "Property") continue
          const name = keyName(property)
          if (name === "title" || name === "description") scan(property.value, "a ListRow")
        }
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Record<string, Rule.RuleModule> = {
  "table-cell-type": tableCellType,
}

defineFamilyRules(rules, "knowledge/ui/presentation/grammar-laws.yaml#TABLE-CELL-TYPE")

/** Every rule of this law is an error. */
export const recommended: Record<string, "error"> = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-grammar/${name}`, "error"]))
