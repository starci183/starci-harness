/** StarCi per-slot status composition, governed by FE-RULE-OWNERSHIP. */
import { pureHalf } from "@starci/eslint-canon-fe/lib/drawing-scope.mjs"
import { defineFamilyRules } from "./lib/rule-contract.mjs"

// -- DRAWING-4 ----------------------------------------------------------------------------------

/** Flags that are a slot's data status. */
const STATUS_FLAG = /^(?:isLoading|isError|isForbidden|isPending|isValidating|isEmpty)$/

/** The name a test expression reads, if it is a status flag. */
const statusFlagOf = (node) => {
  if (!node) return null
  if (node.type === "UnaryExpression") return statusFlagOf(node.argument)
  if (node.type === "ChainExpression") return statusFlagOf(node.expression)
  if (node.type === "Identifier" && STATUS_FLAG.test(node.name)) return node.name
  if (node.type === "MemberExpression" && node.property?.type === "Identifier" && STATUS_FLAG.test(node.property.name)) {
    return node.property.name
  }
  if (node.type === "LogicalExpression" || node.type === "BinaryExpression") return statusFlagOf(node.left) ?? statusFlagOf(node.right)
  return null
}

/** A block's pure half never branches on a data status itself. */
export const slotStatusThroughSlotView = {
  meta: {
    type: "problem",
    docs: { description: "A block's pure half renders data status through `SlotView`, never its own branch." },
    schema: [],
    messages: {
      branch:
        "This branches on `{{flag}}` by hand. Every slot renders its status through `SlotView`, the one recipe: a second branch drifts from it and becomes one more variant somebody draws.",
    },
  },
  create(context) {
    if (pureHalf(context) !== "blocks") return {}
    const check = (node, test) => {
      const flag = statusFlagOf(test)
      if (flag) context.report({ node, messageId: "branch", data: { flag } })
    }
    return {
      ConditionalExpression(node) {
        check(node, node.test)
      },
      IfStatement(node) {
        check(node, node.test)
      },
      LogicalExpression(node) {
        if (node.operator === "&&" && node.parent?.type === "JSXExpressionContainer") check(node, node.left)
      },
    }
  },
}

/** The family status recipe retains its published rule ID. */
export const rules = { "slot-status-through-slotview": slotStatusThroughSlotView }

defineFamilyRules(rules, "knowledge/grammars/core/playbook.yaml#state-recipes")

/** Every family composition rule is mandatory. */
export const recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-grammar/${name}`, "error"]))
