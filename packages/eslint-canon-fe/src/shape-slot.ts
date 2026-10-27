/**
 * The rules that hold the shape and the slot of a front-end unit (contexts/code/fe README "Data status of a region",
 * function.md): the three axes of a unit are named shape, slot and error, and the code uses those words.
 *
 * SHAPE. The pure half switches on `props.shape` (or a destructured `shape`) over its `XShape` union, and the switch is
 * exhaustive: a member nobody draws is a drawing the owner approved and the screen never shows.
 *
 * SLOT. A read is a `DataSlot<T>` built in the connected half and rendered through `SlotView` in the pure half; no unit
 * below the view takes a hand-written status prop, and a branch or leaf never reads data itself.
 *
 * Every rule reads one file. The shape union is read from the program's types when typed linting is on, else from the
 * union this file declares.
 */
import type { TSESTree } from "@typescript-eslint/utils"
import ts from "typescript"
import { inSplitTier, pureHalf } from "./lib/drawing-scope.ts"
import { hfsOf } from "./lib/hfs.ts"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules } from "./lib/rule.ts"
import { fileOf, inSlot, kindOfFile, roleOfFile } from "./lib/scope.ts"

/** The folder name of the unit the linted file belongs to (`HandoffBlock` for `.../HandoffBlock/index.tsx`). */
const unitName = (context: AnyContext): string => hfsOf(context).relative(fileOf(context)).split("/").slice(-2)[0] ?? ""

/** The name of an identifier or a string-literal key; undefined for anything else. */
const nameOfKey = (key: Node): string | undefined =>
  key.type === "Identifier" ? key.name : key.type === "Literal" && typeof key.value === "string" ? key.value : undefined

/** The callee name of a call: `useX` for `useX()` and for `React.useX()`. */
const calleeNameOf = (call: TSESTree.CallExpression): string | undefined => {
  const callee = call.callee
  if (callee.type === "Identifier") return callee.name
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") return callee.property.name
  return undefined
}

// -- SHAPE-1 ----------------------------------------------------------------------------------------

/** The name of a pure half's shape union. */
const SHAPE_NAME = /^[A-Z][A-Za-z0-9]*Shape$/

/** The string members of a union of string literals, or null when the type is not one. */
const literalMembers = (node: TSESTree.TypeNode): string[] | null => {
  const parts = node.type === "TSUnionType" ? node.types : [node]
  const members: string[] = []
  for (const part of parts) {
    if (part.type !== "TSLiteralType" || !("value" in part.literal) || typeof part.literal.value !== "string") return null
    members.push(part.literal.value)
  }
  return members
}

/** The string literal members of a checker type, or null when it is not a union of string literals only. */
const typedMembers = (type: ts.Type): string[] | null => {
  const parts = type.isUnion() ? type.types : [type]
  const members: string[] = []
  for (const part of parts) {
    if ((part.flags & ts.TypeFlags.Undefined) !== 0) continue
    if (!part.isStringLiteral()) return null
    members.push(part.value)
  }
  return members.length > 0 ? members : null
}

/** True for `props.shape` (any receiver named `props`) or a bare `shape`. */
const isShapeRead = (node: Node): boolean =>
  (node.type === "Identifier" && node.name === "shape") ||
  (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier" && node.property.name === "shape" &&
    node.object.type === "Identifier" && node.object.name === "props")

/** The literal a `shape === "x"` test compares against, or undefined. */
const testedMember = (test: Node): string | undefined => {
  if (test.type !== "BinaryExpression" || (test.operator !== "===" && test.operator !== "==")) return undefined
  const [read, literal] = isShapeRead(test.left) ? [test.left, test.right] : [test.right, test.left]
  if (!isShapeRead(read) || literal.type !== "Literal" || typeof literal.value !== "string") return undefined
  return literal.value
}

/** A pure half that branches on its shape covers every member of its `XShape` union, with no default that hides one. */
export const exhaustiveShapeSwitch = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A pure half that branches on `props.shape` / `shape` covers every member of its `XShape` union; a default branch never stands in for a missing member." },
    schema: [],
    messages: {
      missing:
        "The branch on `{{read}}` never draws {{members}}. Every member of the shape union is a drawing the owner approved: give each its own case.",
      hidden:
        "The branch on `{{read}}` lets a default stand in for {{members}}. A default hides the member the next shape adds: name every member as its own case and drop the default.",
    },
  },
  create(context) {
    if (!pureHalf(context)) return {}
    const local = new Map<string, string[]>()
    const services = context.sourceCode.parserServices
    const program = services?.program ?? null
    const map = services?.esTreeNodeToTSNodeMap

    /** The members of the shape a read names: its checker type, else the one local `XShape` union. */
    const membersOf = (read: Node): string[] | null => {
      if (program && map) {
        const tsNode = map.get(read)
        const members = tsNode ? typedMembers(program.getTypeChecker().getTypeAtLocation(tsNode)) : null
        if (members) return members
      }
      return local.size === 1 ? [...local.values()][0] ?? null : null
    }

    /**
     * Report the members a branch leaves undrawn. `fallback` is how many members a trailing default may stand for: none
     * for a switch with no default, one for the last alternate of a conditional chain, any for a switch default.
     */
    const judge = (node: Node, read: Node, covered: ReadonlySet<string>, fallback: "none" | "one" | "default"): void => {
      const members = membersOf(read)
      if (!members) return
      const missing = members.filter((member) => !covered.has(member))
      const hidden = fallback === "default" ? missing.length > 0 : fallback === "one" && missing.length > 1
      if (!hidden && (fallback !== "none" || missing.length === 0)) return
      const data = { read: context.sourceCode.getText(read), members: missing.map((member) => `"${member}"`).join(", ") }
      context.report({ node, messageId: hidden ? "hidden" : "missing", data })
    }

    return {
      Program(node) {
        for (const statement of node.body) {
          const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement
          if (declaration?.type !== "TSTypeAliasDeclaration" || !SHAPE_NAME.test(declaration.id.name)) continue
          const members = literalMembers(declaration.typeAnnotation)
          if (members) local.set(declaration.id.name, members)
        }
      },
      SwitchStatement(node) {
        if (!isShapeRead(node.discriminant)) return
        const covered = new Set<string>()
        let hasDefault = false
        for (const branch of node.cases) {
          if (branch.test === null) hasDefault = true
          else if (branch.test.type === "Literal" && typeof branch.test.value === "string") covered.add(branch.test.value)
        }
        judge(node, node.discriminant, covered, hasDefault ? "default" : "none")
      },
      ConditionalExpression(node) {
        // Judge a chain once, from its head: `a ? X : b ? Y : Z`, whose last alternate stands for one member.
        if (node.parent.type === "ConditionalExpression" && node.parent.alternate === node) return
        const covered = new Set<string>()
        let read: Node | undefined
        let current: Node = node
        while (current.type === "ConditionalExpression") {
          const member = testedMember(current.test)
          if (member === undefined) return
          if (current.test.type === "BinaryExpression") read ??= isShapeRead(current.test.left) ? current.test.left : current.test.right
          covered.add(member)
          current = current.alternate
        }
        if (read !== undefined) judge(node, read, covered, "one")
      },
    }
  },
})

// -- SLOT-1 -----------------------------------------------------------------------------------------

/** The data-status props only SlotView takes; a lower unit gets `isSkeleton` and nothing else. */
const STATUS_PROPS = new Set(["isLoading", "isError", "isForbidden", "isFailed", "failure"])

/** The units that own the status recipe: the status view itself and a route's loading page. */
const isStatusOwner = (name: string): boolean => name === "SlotView" || /LoadingPage$/.test(name)

/** A unit below the status view takes no data-status prop. */
export const noDataStatusProp = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A unit other than SlotView (and a route LoadingPage) takes no `isLoading`, `isError`, `isForbidden`, `isFailed` or `failure` prop; a leaf takes only `isSkeleton`." },
    schema: [],
    messages: {
      status:
        "`{{key}}` is a data status handed to `{{unit}}`. A read's status is a DataSlot rendered through SlotView in the region's place; the parts below it take `isSkeleton` and rest as themselves.",
      leaf:
        "`{{key}}` is a data status handed to the leaf `{{unit}}`. A leaf takes only `isSkeleton`: SlotView passes it while the region waits.",
    },
  },
  create(context) {
    const unit = inSlot(context, "fe.components", "fe.package.ui", "fe.feature") && kindOfFile(context) !== null ? unitName(context) : null
    if (unit === null || isStatusOwner(unit)) return {}
    const leaf = kindOfFile(context) === "leaves"
    return {
      TSPropertySignature(node) {
        const key = nameOfKey(node.key)
        if (key === undefined || !STATUS_PROPS.has(key)) return
        context.report({ node, messageId: leaf ? "leaf" : "status", data: { key, unit } })
      },
    }
  },
})

// -- SLOT-2 -----------------------------------------------------------------------------------------

/** A data hook of `hooks/swr`: `useQueryOrdersSwr`, `useGetHandoffSwr`. */
const SWR_HOOK = /^use[A-Za-z0-9]*Swr$/

/** The builders that fold a read into a DataSlot (`hooks/slot/slot.shared.ts`). */
const SLOT_BUILDER = /^(?:slotOfSwr|mapSlot|loadingSlot|toSlot)$/

/** A region that reads data hands its Base a DataSlot, and the Base renders it through SlotView. */
export const regionReadsThroughSlot = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A connected half that calls an `*Swr` hook folds the read into a DataSlot for its Base; a pure half that takes a DataSlot renders it through SlotView." },
    schema: [],
    messages: {
      slot:
        "`{{hook}}(...)` is read here but never folded into a DataSlot. Build the slot with `slotOfSwr` (or `mapSlot`) and hand it to the Base, which renders it through SlotView.",
      view:
        "This pure half takes a DataSlot but never renders `<SlotView>`. Render the slot through `components/composites/SlotView` in the region's place, with a same-shape placeholder.",
    },
  },
  create(context) {
    if (!inSplitTier(context)) return {}
    const role = roleOfFile(context)
    if (role === "entry") {
      const reads: TSESTree.CallExpression[] = []
      let folds = false
      return {
        CallExpression(node) {
          const name = calleeNameOf(node)
          if (name === undefined) return
          if (SWR_HOOK.test(name)) reads.push(node)
          else if (SLOT_BUILDER.test(name)) folds = true
        },
        "Program:exit"() {
          const [first] = reads
          if (folds || first === undefined) return
          context.report({ node: first, messageId: "slot", data: { hook: calleeNameOf(first) ?? "" } })
        },
      }
    }
    if (role !== "drawing") return {}
    let slotType: TSESTree.TSTypeReference | undefined
    let rendersView = false
    return {
      TSTypeReference(node) {
        if (slotType === undefined && node.typeName.type === "Identifier" && node.typeName.name === "DataSlot") slotType = node
      },
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "SlotView") rendersView = true
      },
      "Program:exit"() {
        if (slotType !== undefined && !rendersView) context.report({ node: slotType, messageId: "view" })
      },
    }
  },
})

// -- SLOT-3 -----------------------------------------------------------------------------------------

/** The effect hooks whose body must not fetch in a branch. */
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"])

/** True when a function body fetches: a `fetch(...)` call, an `await`, or a `.then(...)`. */
const fetchesIn = (root: Node, sourceCode: AnyContext["sourceCode"]): boolean => {
  let found = false
  const visit = (node: Node): void => {
    if (found) return
    if (node.type === "AwaitExpression") found = true
    if (node.type === "CallExpression") {
      const name = calleeNameOf(node)
      if (name === "fetch" || (name === "then" && node.callee.type === "MemberExpression")) found = true
    }
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      const child: unknown = Reflect.get(node, key)
      for (const item of Array.isArray(child) ? child : [child]) {
        if (typeof item === "object" && item !== null && "type" in item && typeof item.type === "string") visit(item)
      }
    }
  }
  visit(root)
  return found
}

/** A branch keeps only interaction state; a leaf holds no hook. */
export const branchIntrinsicState = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A branch keeps only interaction state (no data hook, no `@/hooks` import, no fetching effect); a leaf calls no hook." },
    schema: [],
    messages: {
      hooks:
        "A branch imports `{{source}}`. A branch keeps only its own interaction state; product state and reads live in the connected block above it, which passes them down as atoms.",
      data:
        "A branch reads data through `{{name}}(...)`. Reads live in the connected block: fold them into a DataSlot there and pass the branch atoms.",
      fetch:
        "A branch effect fetches. A branch keeps only interaction state; the read belongs to the connected block, through a hook of `hooks/swr`.",
      leaf:
        "A leaf calls `{{name}}(...)`. A leaf is drawn from its props alone: move the state to the branch or block that owns the interaction.",
    },
  },
  create(context) {
    if (!inSlot(context, "fe.components", "fe.package.ui")) return {}
    const kind = kindOfFile(context)
    if (kind === "leaves") {
      return {
        CallExpression(node) {
          const name = calleeNameOf(node)
          if (name !== undefined && /^use[A-Z]/.test(name)) context.report({ node, messageId: "leaf", data: { name } })
        },
      }
    }
    if (kind !== "branches") return {}
    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (source === "@/hooks" || source.startsWith("@/hooks/")) context.report({ node, messageId: "hooks", data: { source } })
      },
      CallExpression(node) {
        const name = calleeNameOf(node)
        if (name === undefined) return
        if (SWR_HOOK.test(name)) {
          context.report({ node, messageId: "data", data: { name } })
          return
        }
        const [effect] = node.arguments
        if (EFFECT_HOOKS.has(name) && effect !== undefined && fetchesIn(effect, context.sourceCode)) context.report({ node, messageId: "fetch" })
      },
    }
  },
})

/** The rules this law contributes to the plugin. */
export const rules = {
  "exhaustive-shape-switch": exhaustiveShapeSwitch,
  "no-data-status-prop": noDataStatusProp,
  "region-reads-through-slot": regionReadsThroughSlot,
  "branch-intrinsic-state": branchIntrinsicState,
} satisfies Rules

/** Every FE canon rule is an error; existing debt is fixed before adoption. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error" as const]))
