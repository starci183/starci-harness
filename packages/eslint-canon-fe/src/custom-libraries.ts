/**
 * The Custom-only libraries law: a motion library, a graph or flow toolkit and the other animation libraries are not part of the
 * front-end stack of an app that draws with the Grammar. The Grammar's own transitions are CSS driven by its tokens and its
 * graph-shaped drawings are not Grammar components, so an app that needs either writes it inside a `<Custom reason="...">`
 * region (`@starci/grammar`), where any library may be used, and nowhere else.
 *
 * WHAT IT READS. An import (static, type-free, re-export, dynamic `import()` or `require`) of `motion`, `motion/*`
 * (`motion/react`, `motion/mini`, ...), `framer-motion`, `@xyflow/react`, `reactflow`, `@reactflow/*` and `react-flow-renderer`.
 * An import whose every use sits inside a Custom region of the same file is not a finding (the Custom context drops it), nor is a
 * type-only import (`import type`), which carries no behaviour.
 *
 * WHERE IT APPLIES. Product source (`isProductSource`).
 */
import type { TSESTree } from "@typescript-eslint/utils"
import { exemptCustom } from "./lib/custom.ts"
import { defineRule, type Node, type Rules, type Recommended } from "./lib/rule.ts"
import { globalReferences, isProductSource } from "./lib/scope.ts"

/** The packages and package scopes only a Custom region may use, with the concern each belongs to. */
const CUSTOM_ONLY: readonly { readonly test: RegExp; readonly concern: string }[] = [
  { test: /^(?:motion|framer-motion)(?:\/|$)/u, concern: "motion" },
  { test: /^(?:@xyflow\/react|reactflow|react-flow-renderer|@reactflow\/[^/]+)(?:\/|$)/u, concern: "graph" },
]

/** The concern of a Custom-only module specifier, or null. */
export const customOnlyConcern = (specifier: unknown): string | null => {
  if (typeof specifier !== "string") return null
  return CUSTOM_ONLY.find(({ test }) => test.test(specifier))?.concern ?? null
}

/** No import of a motion or graph library outside a Custom region. */
export const customOnlyLibrary = exemptCustom(defineRule({
  meta: {
    type: "problem",
    docs: { description: "A motion library or a graph toolkit is imported only for use inside a Custom region." },
    schema: [],
    messages: {
      library:
        "`{{name}}` is a {{concern}} library. The Grammar draws motion with CSS transitions its tokens drive and draws no graphs, so an app that needs {{concern}} code writes it inside `<Custom reason=\"...\">` (`@starci/grammar`), where any library may be used, and uses the import there only: every use of `{{name}}` must sit inside the Custom region (or a same-file component that only that region renders).",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const judge = (node: Node, specifier: TSESTree.Literal["value"]): void => {
      const concern = customOnlyConcern(specifier)
      if (concern !== null) context.report({ node, messageId: "library", data: { name: String(specifier), concern } })
    }
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return
        judge(node, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source && node.exportKind !== "type") judge(node, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type") judge(node, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") judge(node, node.source.value)
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require" || node.arguments[0]?.type !== "Literal") return
        if (globalReferences(context, new Set(["require"])).includes(node.callee)) judge(node, node.arguments[0].value)
      },
    }
  },
}))

/** The rules this law contributes to the plugin. */
export const rules: Rules = {
  "custom-only-library": customOnlyLibrary,
}

/** Every rule is an error: a motion or graph library outside Custom is the defect, not a style. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error" as const]))
