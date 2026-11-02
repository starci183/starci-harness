/**
 * The rules that keep a loading state honest (R367). A skeleton is drawn from what the page knows about its own reads, so the
 * defects are all one kind: the page believes it has data when it has only a default, or believes it is loading from the wrong
 * read.
 *
 *   no-swr-default-array       a hook folds a read to `[]` and never says whether that read is still loading;
 *   no-foreign-slot-status     a slot takes its loading or error from another slot's read;
 *   no-validating-as-loading   a background refresh (`isValidating`) drives a loading flag or a status;
 *   no-placeholder-object      a `*Placeholder` object is the ready tree with its data stripped to `[]`;
 *   no-hand-skeleton           an app draws a skeleton by hand (the Grammar derives it from `isLoading`).
 */
import type { TSESTree } from "@typescript-eslint/utils"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules } from "./lib/rule.ts"
import { importOf } from "./lib/bindings.ts"
import { projectedReads, slotProtectsFold } from "./lib/slot-read-origin.ts"

const pathOf = (context: AnyContext): string => context.filename.replaceAll("\\", "/")

/** A hook that reads data for a view: under `hooks/`, and not the SWR layer that makes the reads (`hooks/swr`). */
const isViewHook = (context: AnyContext): boolean => {
  const path = pathOf(context)
  return /\/hooks\//.test(path) && !/\/hooks\/swr\//.test(path) && !/\.(?:spec|test)\.[cm]?tsx?$/.test(path)
}

const isApp = (context: AnyContext): boolean => /\/(?:components|features|hooks)\//.test(pathOf(context)) && !/\.(?:spec|test|stories)\.[cm]?tsx?$/.test(pathOf(context))

const unwrap = (node: Node | null | undefined): Node | null | undefined => {
  let current = node
  while (current && (current.type === "ChainExpression" || current.type === "TSNonNullExpression" || current.type === "TSAsExpression")) current = current.expression
  return current
}

/** The identifier at the root of `a.b?.c()` style access, or null. */
const rootOf = (input: Node | null | undefined): TSESTree.Identifier | null => {
  let node = unwrap(input)
  while (node) {
    if (node.type === "Identifier") return node
    if (node.type === "MemberExpression") node = unwrap(node.object)
    else if (node.type === "CallExpression") node = unwrap(node.callee)
    else return null
  }
  return null
}

const enclosingFunction = (node: Node): Node | null => {
  for (let current: Node | undefined = node.parent; current; current = current.parent) {
    if (current.type === "ArrowFunctionExpression" || current.type === "FunctionDeclaration" || current.type === "FunctionExpression") return current
  }
  return null
}

const nameOfKey = (key: Node): string | null => (key.type === "Identifier" ? key.name : key.type === "Literal" && typeof key.value === "string" ? key.value : null)

// -- no-swr-default-array -----------------------------------------------------------------------------------

/** Whether an identifier is bound to the result of a hook call (`const read = useX()`, `const { data } = useX()`): a read, not a plain value. */
const isHookResult = (context: AnyContext, node: Node, identifier: TSESTree.Identifier): boolean => {
  for (let scope: ReturnType<AnyContext["sourceCode"]["getScope"]> | null = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name)
    if (!variable) continue
    return variable.defs.some((definition) => {
      const declarator = definition.node
      if (declarator.type !== "VariableDeclarator" || !declarator.init) return false
      const init = unwrap(declarator.init)
      const callee = init?.type === "CallExpression" ? unwrap(init.callee) : null
      const imported = callee?.type === "Identifier" ? importOf(context, callee) : callee?.type === "MemberExpression" && callee.object.type === "Identifier" ? importOf(context, callee.object) : null
      if (imported?.source === "react" && imported.imported !== "useMemo") return false
      const name = imported?.source === "react" ? imported.imported : callee?.type === "Identifier" ? callee.name : callee?.type === "MemberExpression" && callee.property.type === "Identifier" ? callee.property.name : null
      return name !== null && /^use[A-Z]/.test(name)
    })
  }
  return false
}

const noSwrDefaultArray = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R367: a hook that folds a read to [] says whether that read is still loading." },
    schema: [],
    messages: {
      fold: "FE_SWR_DEFAULT_ARRAY: `{{read}}` is folded to `[]` and this hook never returns `{{read}}.isLoading`, so the view cannot tell \"still loading\" from \"none\" and draws its empty state while the read is in flight (and a failed read as empty). Return the read's isLoading and error with the list, or return the read itself.",
    },
  },
  create(context) {
    if (!isViewHook(context)) return {}
    const source = context.sourceCode
    return {
      LogicalExpression(node) {
        if (node.operator !== "??" || node.right.type !== "ArrayExpression" || node.right.elements.length > 0) return
        const root = rootOf(node.left)
        if (!root || !isHookResult(context, node, root)) return
        const fn = enclosingFunction(node)
        if (!fn) return
        const text = source.getText(fn)
        const projections = projectedReads(context, root)
        if (projections?.length === 0) return
        // The read's own status is read in the same hook: `read.isLoading`, or destructured next to `data`.
        const readsStatus = (projections ?? [root]).every(read => {
          const escaped = read.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          return new RegExp(`\\b${escaped}\\??\\.(?:isLoading|error|isError)\\b`).test(text)
            || new RegExp(`\\{[^}]*\\b(?:isLoading|error)\\b[^}]*\\}\\s*=\\s*${escaped}\\b`).test(text)
            || (read.name === "data" && /\bisLoading\b/.test(text))
        })
        if (readsStatus || slotProtectsFold(context, node, fn)) return
        context.report({ node, messageId: "fold", data: { read: source.getText(node.left).slice(0, 40) } })
      },
    }
  },
})

// -- no-foreign-slot-status ---------------------------------------------------------------------------------

const SLOT_NAME = /slot$/i

const noForeignSlotStatus = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R367: a slot takes its loading and error from its own reads, never from another slot's." },
    schema: [],
    messages: {
      foreign: "FE_FOREIGN_SLOT_STATUS: this slot copies `{{from}}` from another slot, so a region shows another read's loading or error (a list skeleton on a thread read, an error notice in the wrong pane). Build the slot from every read it draws with the one `slotOfReads(...)` helper of hooks/slot.",
    },
  },
  create(context) {
    if (!isApp(context)) return {}
    const source = context.sourceCode
    return {
      Property(node) {
        const key = nameOfKey(node.key)
        if (key !== "isLoading" && key !== "isError" && key !== "error") return
        const value = unwrap(node.value as Node)
        if (!value || value.type !== "MemberExpression") return
        const property = value.property.type === "Identifier" ? value.property.name : null
        const ownerNode = unwrap(value.object)
        const owner = ownerNode?.type === "Identifier" ? ownerNode.name : ownerNode?.type === "MemberExpression" && ownerNode.property.type === "Identifier" ? ownerNode.property.name : null
        if (!property || !owner || !SLOT_NAME.test(owner) || (property !== "isLoading" && property !== "isError" && property !== "error")) return
        if (node.parent.type === "ObjectPattern") return
        context.report({ node, messageId: "foreign", data: { from: source.getText(value).slice(0, 40) } })
      },
    }
  },
})

// -- no-validating-as-loading -------------------------------------------------------------------------------

const LOADING_NAME = /^(?:isLoading|loading|isPending|status)$/

const mentionsValidating = (context: AnyContext, node: Node): boolean => /\bisValidating\b/.test(context.sourceCode.getText(node))

const noValidatingAsLoading = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R367: a background refresh never drives a loading flag or a status." },
    schema: [],
    messages: {
      validating: "FE_VALIDATING_AS_LOADING: `isValidating` is a background refresh, and it drives `{{name}}`, so the screen returns to its skeleton while the content it already has is being revalidated. A skeleton is `isLoading` (no data yet) alone; a refresh keeps the content.",
    },
  },
  create(context) {
    if (!isApp(context)) return {}
    return {
      Property(node) {
        const key = nameOfKey(node.key)
        if (key === null || !LOADING_NAME.test(key) || node.parent.type === "ObjectPattern") return
        if (mentionsValidating(context, node.value)) context.report({ node, messageId: "validating", data: { name: key } })
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !LOADING_NAME.test(node.id.name) || !node.init) return
        if (mentionsValidating(context, node.init)) context.report({ node, messageId: "validating", data: { name: node.id.name } })
      },
    }
  },
})

// -- no-placeholder-object ----------------------------------------------------------------------------------

const PLACEHOLDER = /Placeholder$/

const hasEmptyArray = (node: TSESTree.ObjectExpression): boolean =>
  node.properties.some((property) => property.type === "Property" && ((property.value.type === "ArrayExpression" && property.value.elements.length === 0)))

const noPlaceholderObject = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R367: a loading placeholder is not the ready data with its lists emptied." },
    schema: [],
    messages: {
      placeholder: "FE_PLACEHOLDER_OBJECT: `{{name}}` is the ready tree with its data stripped to `[]`: a second description of the real shape that drifts from it (a missing chip, a different row count). Let the component rest as itself with a loading flag.",
    },
  },
  create(context) {
    if (!isApp(context)) return {}
    return {
      Property(node) {
        const key = nameOfKey(node.key)
        if (key === null || !PLACEHOLDER.test(key) || node.parent.type === "ObjectPattern") return
        const value = unwrap(node.value as Node)
        if (value?.type === "ObjectExpression" && hasEmptyArray(value)) context.report({ node, messageId: "placeholder", data: { name: key } })
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !PLACEHOLDER.test(node.id.name)) return
        const init = unwrap(node.init)
        if (init?.type === "ObjectExpression" && hasEmptyArray(init)) context.report({ node, messageId: "placeholder", data: { name: node.id.name } })
      },
    }
  },
})

// -- no-hand-skeleton ---------------------------------------------------------------------------------------

const HAND_SKELETONS = new Set(["Skeleton", "ChatBubbleSkeletons", "MessageBubbleSkeletons"])

/** Published with the Grammar `isLoading` flag: the Grammar components draw their own loading structure. */
export const noHandSkeleton = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R367: an app draws no skeleton by hand; the Grammar derives it from the ready structure." },
    schema: [],
    messages: {
      hand: "FE_HAND_SKELETON: `<{{name}}>` is a skeleton drawn by hand, so its shape is a guess the ready screen will not keep. Pass the loading flag to the Grammar component and let it derive the skeleton from the structure it draws.",
    },
  },
  create(context) {
    if (!isApp(context)) return {}
    return {
      JSXOpeningElement(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null
        if (name !== null && HAND_SKELETONS.has(name)) context.report({ node, messageId: "hand", data: { name } })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules = {
  "no-swr-default-array": noSwrDefaultArray,
  "no-foreign-slot-status": noForeignSlotStatus,
  "no-validating-as-loading": noValidatingAsLoading,
  "no-placeholder-object": noPlaceholderObject,
  "no-hand-skeleton": noHandSkeleton,
} satisfies Rules

/**
 * The level this law asks for: every rule at error. `no-hand-skeleton` joined when the Grammar took the loading shape (`isLoading` on
 * Section, the cards, ListBox, Timeline, DataTable, MessageBubble and PaneSection, with the `error` slot).
 */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error" as const]))
