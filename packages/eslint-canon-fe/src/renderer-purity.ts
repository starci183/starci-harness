/**
 * RENDERER-PURITY-1: a renderer of a root workspace package (every `.tsx` file of its source, `packages/<pkg>/src/**\/*.tsx`) holds presentation only: mapping rows to
 * components, choosing what to show, formatting. The business logic it would otherwise hold lives in a measured `.ts` module the renderer calls,
 * where the unit run holds it at 100 per file (BE-TEST-13); the renderer itself is outside coverage (SHARED-TEST-1).
 *
 * Refused in such a file, each as `FE_RENDERER_LOGIC`:
 *   - data computation: arithmetic (`- * / % **`) between two non-literal values, `+=`/`-=` accumulation of a data value;
 *   - aggregation: `.reduce`/`.reduceRight`, two or more of `.filter`/`.sort`/`.toSorted`/`.flatMap` in one chain, `Math.max/min(...spread)`;
 *   - date math: arithmetic on `Date.now()`, `new Date()` or `.getTime()`, the `Date` setters, the date-fns functions that add, subtract, compare or round;
 *   - a domain rule: a relational comparison (`< <= > >=`) between two data values (a size or an index against a collection length is display);
 *   - a mutation outside a declared action: a write to a prop or an outer value, an in-place array mutator on data, `fetch`, storage, a beacon.
 * Allowed: `.map`, one `.filter` (a display filter), ternaries and `&&` that pick a view, comparisons with a literal (`rows.length === 0`),
 * arithmetic with a literal (`index + 1`, `ratio * 100`), a template, and a call of a declared action (`handle.run(...)`).
 */
import { TSESLint, type TSESTree } from "@typescript-eslint/utils"
import { defineRule, type Node, type Recommended, type Rules } from "./lib/rule.ts"

const RENDERER = /(?:^|\/)packages\/[^/]+\/src\/.+\.tsx$/u
const FRONT_END_PACKAGE = /(?:^|\/)fe\/packages\//u

/** True for a renderer of a root workspace package, a `.tsx` file of its source whatever its folder; a front-end package (`fe/packages/*`) is judged by the front-end canon alone. */
export const isRootPackageRenderer = (filename: string): boolean => {
  const path = filename.replaceAll("\\", "/")
  return RENDERER.test(path) && !FRONT_END_PACKAGE.test(path)
}

const ARITHMETIC = new Set(["-", "*", "/", "%", "**"])
const RELATIONAL = new Set(["<", "<=", ">", ">="])
const COMPOUND = new Set(["+=", "-=", "*=", "/=", "%=", "**="])
const CHAINED = new Set(["filter", "sort", "toSorted", "flatMap"])
const IN_PLACE = new Set(["push", "pop", "shift", "unshift", "splice", "fill", "copyWithin", "reverse", "sort"])
const STORES = new Set(["localStorage", "sessionStorage", "indexedDB", "caches"])
const NETWORK = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"])
const DATE_SETTER = /^set(?:UTC)?(?:Date|FullYear|Month|Hours|Minutes|Seconds|Milliseconds|Time)$/u
const DATE_FNS = /^(?:add|sub|differenceIn|diff|isBefore|isAfter|isSame|startOf|endOf|eachDay|intervalToDuration|closestTo|set[A-Z])/u
const COUNT_NAMES = new Set(["index", "i", "idx", "position", "length", "count", "size"])

type Id = "arithmetic" | "accumulation" | "aggregation" | "chain" | "dateMath" | "dateFns" | "domainRule" | "mutation" | "network"

const MESSAGES: Record<Id, string> = {
  arithmetic: "arithmetic on two data values ({{what}}) is data computation",
  accumulation: "accumulating a data value with `{{what}}` is data computation",
  aggregation: "`{{what}}` aggregates data",
  chain: "a chain of {{what}} shapes data beyond a display filter",
  dateMath: "{{what}} is date math",
  dateFns: "`{{what}}` from date-fns is date math",
  domainRule: "comparing two data values ({{what}}) is a domain rule, not a choice of view",
  mutation: "{{what}} changes data outside a declared action",
  network: "`{{what}}` reaches data outside a declared action",
}

const unwrap = (node: Node): Node => {
  if (node.type === "ChainExpression") return unwrap(node.expression)
  if (node.type === "TSNonNullExpression" || node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return unwrap(node.expression)
  return node
}

const isLiteral = (node: Node): boolean => {
  const inner = unwrap(node)
  if (inner.type === "Literal") return true
  if (inner.type === "TemplateLiteral") return inner.expressions.length === 0
  return inner.type === "UnaryExpression" && isLiteral(inner.argument)
}

/** A value read from data: a member access or a call. A bare name may be a local the renderer derived, so it is not judged alone. */
const isDataRead = (node: Node): boolean => {
  const inner = unwrap(node)
  return inner.type === "MemberExpression" || inner.type === "CallExpression"
}

const callee = (node: TSESTree.CallExpression): { object: Node | null; name: string | null } => {
  const target = unwrap(node.callee)
  if (target.type === "Identifier") return { object: null, name: target.name }
  if (target.type !== "MemberExpression") return { object: null, name: null }
  const name = target.computed ? (target.property.type === "Literal" ? String(target.property.value) : null) : target.property.type === "Identifier" ? target.property.name : null
  return { object: unwrap(target.object), name }
}

const text = (context: Readonly<TSESLint.RuleContext<Id, []>>, node: Node): string => {
  const source = context.sourceCode.getText(node).replaceAll(/\s+/gu, " ")
  return source.length > 48 ? `${source.slice(0, 45)}...` : source
}

/** True when the expression reads a size or an index (display), so a comparison with it chooses a view. */
const readsCount = (node: Node): boolean => {
  const inner = unwrap(node)
  if (inner.type === "Identifier") return COUNT_NAMES.has(inner.name)
  if (inner.type === "MemberExpression" && !inner.computed && inner.property.type === "Identifier") return COUNT_NAMES.has(inner.property.name)
  if (inner.type === "BinaryExpression") return readsCount(inner.left) || readsCount(inner.right)
  return false
}

/** True for a value built in this renderer (a literal, a call's result, a `new`), which it may fill, as against a prop, an import or an alias of data. */
const isFresh = (context: Readonly<TSESLint.RuleContext<Id, []>>, node: Node): boolean => {
  const inner = unwrap(node)
  if (inner.type === "ArrayExpression" || inner.type === "ObjectExpression" || inner.type === "NewExpression" || inner.type === "CallExpression") return true
  if (inner.type === "MemberExpression") return false
  if (inner.type !== "Identifier") return false
  let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(inner)
  while (scope !== null) {
    const variable = scope.set.get(inner.name)
    if (variable !== undefined) {
      const definition = variable.defs[0]
      if (definition === undefined || definition.type !== TSESLint.Scope.DefinitionType.Variable) return false
      const init = definition.node.init
      return init !== null && init !== undefined && init.type !== "Identifier" && isFresh(context, init)
    }
    scope = scope.upper
  }
  return false
}

const rootOf = (node: Node): Node => {
  const inner = unwrap(node)
  return inner.type === "MemberExpression" ? rootOf(inner.object) : inner
}

const dateOperand = (node: Node): boolean => {
  const inner = unwrap(node)
  if (inner.type === "NewExpression") return inner.callee.type === "Identifier" && inner.callee.name === "Date"
  if (inner.type !== "CallExpression") return false
  const { object, name } = callee(inner)
  return name === "getTime" || (name === "now" && object?.type === "Identifier" && object.name === "Date")
}

/** True inside the comparator of `.sort`/`.toSorted`: ordering rows by a field is display, whatever the subtraction inside it. */
const inComparator = (context: Readonly<TSESLint.RuleContext<Id, []>>, node: Node): boolean =>
  context.sourceCode.getAncestors(node).some((ancestor) => {
    if (ancestor.type !== "CallExpression") return false
    const { name } = callee(ancestor)
    return (name === "sort" || name === "toSorted") && ancestor.arguments.some((argument) => argument.range[0] <= node.range[0] && node.range[1] <= argument.range[1])
  })

const chainLength = (node: TSESTree.CallExpression): TSESTree.CallExpression[] => {
  const links: TSESTree.CallExpression[] = []
  let current: Node = node
  while (current.type === "CallExpression") {
    const { object, name } = callee(current)
    if (name !== null && CHAINED.has(name)) links.push(current)
    if (object === null) break
    current = object
  }
  return links
}

const rendererPurity = defineRule<Id>({
  meta: {
    type: "problem",
    docs: { description: "RENDERER-PURITY-1: a renderer (.tsx) of a root package holds presentation only; data computation, aggregation, date math, domain rules and mutations live in measured .ts." },
    schema: [],
    messages: Object.fromEntries(Object.entries(MESSAGES).map(([id, message]) => [id, `FE_RENDERER_LOGIC: ${message}; move it into a measured .ts module the renderer calls (BE-TEST-13, FE-PACKAGES-2) and let the renderer map, choose and format.`])) as Record<Id, string>,
  },
  create(context) {
    if (!isRootPackageRenderer(context.filename)) return {}
    const seen = new Set<Node>()
    const report = (node: Node, messageId: Id, what: string): void => {
      if (seen.has(node)) return
      seen.add(node)
      context.report({ node, messageId, data: { what } })
    }
    const checkCall = (node: TSESTree.CallExpression): void => {
      const { object, name } = callee(node)
      if (name === null) return
      if (object === null && NETWORK.has(name)) report(node, "network", name)
      if (name === "reduce" || name === "reduceRight") report(node, "aggregation", `.${name}(...)`)
      if ((name === "max" || name === "min") && object?.type === "Identifier" && object.name === "Math" && node.arguments.some((argument) => argument.type === "SpreadElement")) report(node, "aggregation", `Math.${name}(...)`)
      if (object !== null && DATE_SETTER.test(name)) report(node, "dateMath", `.${name}(...)`)
      if (object?.type === "Identifier" && STORES.has(object.name) && name !== "getItem") report(node, "network", `${object.name}.${name}`)
      if (object?.type === "Identifier" && object.name === "navigator" && name === "sendBeacon") report(node, "network", "navigator.sendBeacon")
      if (object !== null && IN_PLACE.has(name) && !isFresh(context, object)) report(node, "mutation", `\`.${name}(...)\` on ${text(context, object)}`)
      const links = chainLength(node)
      if (links.length >= 2 && links[0] === node) {
        for (const link of links) seen.add(link)
        context.report({ node, messageId: "chain", data: { what: links.map((link) => `.${callee(link).name ?? ""}`).reverse().join("") } })
      }
    }
    const checkWrite = (target: Node, node: Node): void => {
      const inner = unwrap(target)
      if (inner.type !== "MemberExpression") return
      if (!isFresh(context, rootOf(inner))) report(node, "mutation", `writing ${text(context, inner)}`)
    }
    return {
      CallExpression: checkCall,
      BinaryExpression(node: TSESTree.BinaryExpression) {
        if (ARITHMETIC.has(node.operator) || node.operator === "+") {
          if ((node.operator === "-" || node.operator === "+") && (dateOperand(node.left) || dateOperand(node.right))) report(node, "dateMath", text(context, node))
          else if (ARITHMETIC.has(node.operator) && !isLiteral(node.left) && !isLiteral(node.right) && (isDataRead(node.left) || isDataRead(node.right)) && !inComparator(context, node)) report(node, "arithmetic", text(context, node))
          return
        }
        if (!RELATIONAL.has(node.operator) || isLiteral(node.left) || isLiteral(node.right)) return
        if (!isDataRead(node.left) && !isDataRead(node.right)) return
        if (readsCount(node.left) || readsCount(node.right)) return
        report(node, "domainRule", text(context, node))
      },
      AssignmentExpression(node: TSESTree.AssignmentExpression) {
        if (COMPOUND.has(node.operator) && !isLiteral(node.right) && isDataRead(node.right)) report(node, "accumulation", node.operator)
        checkWrite(node.left, node)
      },
      UpdateExpression(node: TSESTree.UpdateExpression) {
        checkWrite(node.argument, node)
      },
      UnaryExpression(node: TSESTree.UnaryExpression) {
        if (node.operator === "delete") checkWrite(node.argument, node)
      },
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        if (!/^date-fns(?:\/|$)/u.test(node.source.value)) return
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" && DATE_FNS.test(specifier.imported.name)) report(specifier, "dateFns", specifier.imported.name)
        }
      },
    }
  },
})

/** The one rule of the law. */
export const rules = { "renderer-presentation-only": rendererPurity } satisfies Rules

/** The rule reaches consumers at error. */
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name): [string, "error"] => [`starci-fe/${name}`, "error"]))
