/**
 * The rule that holds the front-end stack (`knowledge/hfs/fe-stack.yaml`, failure code `FE_STACK_FORBIDDEN`).
 *
 * ONE LIBRARY PER CONCERN. Every common front-end concern - GraphQL, REST, data hooks, toast, forms, state, realtime, i18n, UI,
 * icons, motion, dates, numbers, storage, charts, markdown, code - has one canonical library, the same for the lite and the full
 * edition (owner ruling 2026-10-13). A second library for a concern is a second set of conventions a reader has to know and a
 * second dependency a release has to keep current, and it always arrives one import at a time. The catalog names, per concern,
 * the alternatives a front end never imports; this rule refuses exactly those, read from the catalog, so the list lives once.
 *
 * SESSION ISSUER. The front end holds no identity SDK: `modules/auth` talks only to the app's own back-end auth doors, and the fe-stack
 * catalog forbids every Supabase client package (concern `auth`).
 *
 * WHAT IS LEFT TO SIBLINGS. A canonical library imported in the wrong place (Apollo outside `modules/api`, axios outside its REST
 * calls, socket.io-client outside `hooks/socketio`) and `fetch` outside the API layer are `fetch-only-in-api-client`'s findings;
 * a glyph library outside the icon leaf is the icon law's. Each import is judged by one rule.
 */
import type { TSESTree } from "@typescript-eslint/utils"
import { defineRule, type Node, type Rules, type Recommended } from "./lib/rule.ts"
import { forbiddingConcern, packageNameOf } from "./lib/fe-stack.ts"
import { globalReferences, isProductSource } from "./lib/scope.ts"

/** The package scope only the identity-provider client may import. */

/**
 * No import (static, re-export, dynamic or `require`) of a package the fe-stack catalog forbids.
 */
export const feStackImport = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A front end imports no library the fe-stack catalog forbids." },
    schema: [],
    messages: {
      forbidden:
        "`{{name}}` is a forbidden alternative for the {{concern}} concern of the front-end stack. The stack has one library per concern, the same in every app and both editions: use {{canonical}} ({{pattern}}). {{why}}",
    },
  },
  create(context) {
    if (!isProductSource(context)) return {}
    const judge = (node: Node, source: TSESTree.Literal["value"]): void => {
      const name = packageNameOf(source)
      if (name === null || name === undefined) return
      const concern = forbiddingConcern(source)
      if (concern) {
        const named = (concern.packages?.length ?? 0) > 0 ? concern.packages ?? [] : concern.home ?? []
        const canonical = named.map((entry: string) => `\`${entry}\``).join(", ")
        context.report({ node, messageId: "forbidden", data: { name, concern: concern.id, canonical, pattern: concern.pattern ?? "", why: concern.why ?? "" } })
        return
      }
    }
    return {
      ImportDeclaration(node) {
        judge(node, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source) judge(node, node.source.value)
      },
      ExportAllDeclaration(node) {
        judge(node, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") judge(node, node.source.value)
      },
      TSImportEqualsDeclaration(node) {
        // `import x = require("moment")`
        if (node.moduleReference?.type === "TSExternalModuleReference" && node.moduleReference.expression?.type === "Literal") judge(node, node.moduleReference.expression.value)
      },
      CallExpression(node) {
        // `require("moment")` where `require` is the CommonJS global.
        if (node.callee.type !== "Identifier" || node.callee.name !== "require" || node.arguments[0]?.type !== "Literal") return
        if (globalReferences(context, new Set(["require"])).includes(node.callee)) judge(node, node.arguments[0].value)
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules: Rules = {
  "fe-stack-import": feStackImport,
}

/** Every rule is an error: a second library for a concern is the defect, not a style. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error" as const]))
