/**
 * The rules that keep one slow or malformed dependency from taking a process down.
 *
 * - `http-needs-timeout` (R70 `BE_HTTP_TIMEOUT`): an outbound HTTP call states how long it may take. A socket
 *   with no deadline holds a request, a connection and a worker slot for as long as the far side sleeps.
 * - `json-parse-needs-guard` (R76 `BE_JSON_PARSE_UNGUARDED`): `JSON.parse` of text that came from outside the
 *   function sits inside a `try`. A corrupt row or a hostile payload then becomes a typed outcome instead of a 500.
 * - `no-hand-rolled-retry` (R81 `BE_HAND_ROLLED_RETRY`): a loop that catches an error and waits before trying
 *   again re-implements retry by hand, outside `platform/retry`'s bounded, jittered, abortable helper.
 *
 * A config held in a variable or returned by a helper proves its deadline through its type.
 */
import ts from "typescript"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { keyName, staticText, walk } from "./lib/ast.ts"
import { hfsOf } from "./lib/hfs.ts"
import { isOwnedBy } from "./lib/ports.ts"
import { isPackageType, isTypeNamed, typed, childNode } from "./lib/types.ts"
import { isDeclarationFile } from "./lib/path.ts"
import type { Context, Node, Recommended, RuleListener, RuleModule, Rules } from "./lib/rule.ts"

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "request"])

/** The outbound HTTP client types a call may be made on, by the package that declares each. */
const HTTP_CLIENT_TYPES: ReadonlyArray<readonly [string, string]> = Object.freeze([["AxiosInstance", "axios"], ["AxiosStatic", "axios"], ["HttpService", "@nestjs/axios"]] as const)

/** Whether the node's TYPE is an outbound HTTP client (an axios instance or the Nest `HttpService`), whatever it is called. */
const isHttpClient = (context: Context, node: Node): boolean => HTTP_CLIENT_TYPES.some(([name, pkg]) => isPackageType(context, node, name, pkg))

const hasSpread = (objectNode: TSESTree.ObjectExpression): boolean => objectNode.properties.some((property) => property.type === "SpreadElement")

/** A deadline value cannot be absent in any branch of its type. */
const mayBeAbsent = (type: ts.Type): boolean => type.isUnion()
  ? type.types.some(mayBeAbsent)
  : (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) !== 0

/** A non-literal config promises a present deadline in every possible branch, including a generic's constraint. */
const typeHasDeadline = (checker: ts.TypeChecker, type: ts.Type, atNode: ts.Node, names: readonly string[]): boolean => {
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type)
    return constraint !== undefined && constraint !== type && typeHasDeadline(checker, constraint, atNode, names)
  }
  if (type.isUnion()) return type.types.every((part) => typeHasDeadline(checker, part, atNode, names))
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0 || mayBeAbsent(type)) return false
  return names.some((name) => {
    const property = checker.getPropertyOfType(type, name)
    if (!property || (property.flags & ts.SymbolFlags.Optional) !== 0) return false
    const valueType = checker.getTypeOfSymbolAtLocation(property, atNode)
    return !mayBeAbsent(valueType) && (valueType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) === 0
  })
}

/** Literal keys state a deadline directly; other configs must prove it with a required, present typed member. */
const hasDeadline = (context: Context, config: TSESTree.CallExpressionArgument | undefined, names: readonly string[]): boolean => {
  if (!config) return false
  const { checker, toTs } = typed(context)
  if (config.type === "ObjectExpression" && !hasSpread(config)) {
    return names.some((name) => {
      const property = config.properties.findLast((entry): entry is TSESTree.Property => entry.type === "Property"
        && (entry.computed ? staticText(entry.key) : keyName(entry.key)) === name)
      if (!property) return false
      let expression: Node = property.value
      while (expression.type === "TSAsExpression" || expression.type === "TSTypeAssertion" || expression.type === "TSNonNullExpression" || expression.type === "TSSatisfiesExpression") expression = expression.expression
      const value = toTs(expression)
      return Boolean(value) && !mayBeAbsent(checker.getTypeAtLocation(value))
    })
  }
  const configNode = toTs(config)
  return Boolean(configNode) && typeHasDeadline(checker, checker.getTypeAtLocation(configNode), configNode, names)
}

/** Every outbound HTTP call carries a deadline. */
export const httpNeedsTimeout: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "`fetch`, axios and HttpService calls state a `timeout` or an abort `signal`." },
    schema: [],
    messages: {
      fetchNoSignal:
        "`fetch` without a `signal`. A peer that accepts the connection and then goes quiet holds this request for as long as it likes. Pass `{ signal: AbortSignal.timeout(<named ms>) }`.",
      clientNoTimeout:
        "`{{call}}` states no `timeout` or `signal`. A peer that goes quiet holds this request, its socket and a worker slot indefinitely. Pass `{ timeout: <named ms> }` (or an abort `signal`) in the request config, or set it once on `axios.create({ timeout })`.",
      createNoTimeout:
        "`axios.create` without a `timeout`. Every call through this instance inherits no deadline. Set `timeout: <named ms>` here.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    if (isDeclarationFile(filename)) return {}
    return {
      CallExpression(node) {
        const { callee } = node
        if (callee.type === "Identifier" && callee.name === "fetch") {
          const init = node.arguments[1]
          if (!hasDeadline(context, init, ["signal"])) context.report({ node, messageId: "fetchNoSignal" })
          return
        }
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return
        const method = callee.property.name
        if (!isHttpClient(context, callee.object)) return
        const receiver = callee.object.type === "Identifier" ? callee.object.name : "client"
        if (method === "create" && isPackageType(context, callee.object, "AxiosStatic", "axios")) {
          const config = node.arguments[0]
          if (!hasDeadline(context, config, ["timeout", "signal"])) {
            context.report({ node, messageId: "createNoTimeout" })
          }
          return
        }
        if (!HTTP_METHODS.has(method)) return
        const configAt = method === "request" ? 0 : ["post", "put", "patch"].includes(method) ? 2 : 1
        const config = node.arguments[configAt]
        if (!hasDeadline(context, config, ["timeout", "signal"])) {
          context.report({ node, messageId: "clientNoTimeout", data: { call: `${receiver}.${method}` } })
        }
      },
    }
  },
}

/** Whether `node` sits inside a `try` block of its own function. */
const insideTry = (node: Node): boolean => {
  let child: Node = node
  let current: Node | undefined = node.parent
  while (current) {
    if (current.type === "TryStatement" && current.block === child) return true
    if (current.type === "FunctionDeclaration" || current.type === "FunctionExpression" || current.type === "ArrowFunctionExpression") return false
    child = current
    current = current.parent
  }
  return false
}

/** `JSON.parse` of outside text fails inside a guard. */
export const jsonParseNeedsGuard: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "`JSON.parse` sits inside a `try` in its own function." },
    schema: [],
    messages: {
      unguarded:
        "`JSON.parse` outside a `try`. Stored text, a webhook body and a provider reply can all be malformed, and the throw surfaces far from here as an unmasked 500. Wrap it and return a typed outcome (or a `DomainError`) naming what was being parsed.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    if (isDeclarationFile(filename)) return {}
    return {
      CallExpression(node) {
        const { callee } = node
        if (callee.type !== "MemberExpression" || callee.computed) return
        if (callee.object.type !== "Identifier" || callee.object.name !== "JSON") return
        if (callee.property.type !== "Identifier" || callee.property.name !== "parse") return
        if (insideTry(node)) return
        context.report({ node, messageId: "unguarded" })
      },
    }
  },
}

/** Modules whose functions wait: `node:timers/promises` `setTimeout` and `scheduler.wait`, and the callback timers. */
const TIMER_MODULES = new Set(["node:timers/promises", "timers/promises", "node:timers", "timers"])
const LOOP_TYPES = ["ForStatement", "WhileStatement", "DoWhileStatement", "ForOfStatement", "ForInStatement"]

/** A loop of any of the five forms. */
type LoopNode = TSESTree.ForStatement | TSESTree.WhileStatement | TSESTree.DoWhileStatement | TSESTree.ForOfStatement | TSESTree.ForInStatement

/** The variable a name resolves to from `node`'s scope, or null when it is a global. */
const variableOf = (context: Context, node: Node, name: string): TSESLint.Scope.Variable | null => {
  let scope: TSESLint.Scope.Scope | null = (context.sourceCode || context.getSourceCode()).getScope(node)
  while (scope) {
    const found = scope.set.get(name)
    if (found) return found
    scope = scope.upper
  }
  return null
}

/** Whether an identifier is the global timer function of that name, not a local one. */
const isGlobalTimer = (context: Context, identifier: TSESTree.Identifier): boolean => identifier.name === "setTimeout" && (variableOf(context, identifier, identifier.name)?.defs.length ?? 0) === 0

/** The module specifier of an import binding's declaration; an `import x = require()` has no `source` and throws, as reading `source.value` off it did. */
const importSourceValue = (parent: TSESTree.ImportDeclaration | TSESTree.TSImportEqualsDeclaration): string => {
  if (parent.type === "ImportDeclaration") return parent.source.value
  throw new TypeError("Cannot read properties of undefined (reading 'value')")
}

/** Whether an identifier is bound by an import of a timers module (`import { setTimeout as pause } from "node:timers/promises"`). */
const isTimerImport = (context: Context, identifier: TSESTree.Identifier): boolean =>
  variableOf(context, identifier, identifier.name)?.defs.some((def) => def.type === "ImportBinding" && TIMER_MODULES.has(importSourceValue(def.parent))) ?? false

/** The leftmost identifier of `a.b.c`, else null. */
const rootOf = (node: Node): TSESTree.Identifier | null => {
  let current: Node = node
  while (current.type === "MemberExpression") current = current.object
  return current.type === "Identifier" ? current : null
}

/** The import a TypeScript identifier resolves to, when it is an import of a timers module. */
const isTimerImportTs = (checker: ts.TypeChecker, identifier: ts.Node): boolean => {
  const declarations = checker.getSymbolAtLocation(identifier)?.declarations ?? []
  return declarations.some((declaration) => {
    const importDeclaration = ts.findAncestor(declaration, ts.isImportDeclaration)
    return importDeclaration !== undefined && ts.isStringLiteral(importDeclaration.moduleSpecifier) && TIMER_MODULES.has(importDeclaration.moduleSpecifier.text)
  })
}

/** Whether a TypeScript identifier named `setTimeout` is the ambient timer (declared by a `.d.ts`, or by nothing), not a function of the repository. */
const isGlobalTimerTs = (checker: ts.TypeChecker, identifier: ts.Node): boolean =>
  (checker.getSymbolAtLocation(identifier)?.declarations ?? []).every((declaration) => declaration.getSourceFile().isDeclarationFile)

/** The functions a TypeScript declaration is or holds (`function f`, `const f = () => ...`, a method, a property arrow). */
const bodiesOf = (declaration: ts.Declaration): ts.Node[] => {
  if (ts.isFunctionLike(declaration)) {
    const body = childNode(declaration, "body")
    if (body) return [body]
  }
  if ((ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
    const body = ts.isFunctionLike(declaration.initializer) ? childNode(declaration.initializer, "body") : undefined
    return body ? [body] : []
  }
  return []
}

/**
 * Whether calling the function a TypeScript call resolves to WAITS: its body calls the global `setTimeout`, a
 * `node:timers` function, or another function that does (followed up to three levels deep). A function declared by
 * the `platform/retry` owner is the sanctioned helper and never counts. A function whose body is not in the program
 * (a package declaration file) cannot be judged and does not count; the timer-import ban (R90) closes that door.
 */
const waitsThrough = (context: Context, checker: ts.TypeChecker, call: ts.CallExpression, depth: number, seen: Set<ts.Node>): boolean => {
  const hfs = hfsOf(context)
  const target = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression
  let symbol = checker.getSymbolAtLocation(target)
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol)
  for (const declaration of symbol?.declarations ?? []) {
    if (seen.has(declaration)) continue
    seen.add(declaration)
    if (isOwnedBy(hfs, declaration.getSourceFile().fileName, "platform", "retry")) continue
    for (const body of bodiesOf(declaration)) if (waitsIn(context, checker, body, depth, seen)) return true
  }
  return false
}

/** Whether a TypeScript subtree waits: it calls a timer, or a function that waits. */
const waitsIn = (context: Context, checker: ts.TypeChecker, root: ts.Node, depth: number, seen: Set<ts.Node>): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(node)) {
      let base: ts.Expression = node.expression
      while (ts.isPropertyAccessExpression(base)) base = base.expression
      if (ts.isIdentifier(base) && ((base.text === "setTimeout" && isGlobalTimerTs(checker, base)) || isTimerImportTs(checker, base))) found = true
      else if (depth > 0 && waitsThrough(context, checker, node, depth - 1, seen)) found = true
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

/** Whether an ESTree call waits: a global or imported timer, or a function declared outside `platform/retry` whose body waits. */
const isWaitCall = (context: Context, node: TSESTree.CallExpression): boolean => {
  const { callee } = node
  const root = rootOf(callee)
  if (root && (isGlobalTimer(context, root) || isTimerImport(context, root))) return true
  const { checker, toTs } = typed(context)
  const tsCall = toTs(node)
  return Boolean(tsCall) && waitsThrough(context, checker, tsCall, 3, new Set())
}

/** Whether a call catches: a `.catch(...)` on a Promise. */
const isPromiseCatch = (context: Context, node: Node): boolean =>
  node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.property.type === "Identifier"
  && node.callee.property.name === "catch" && isTypeNamed(context, node.callee.object, "Promise")

/** A loop that both catches an error and waits is retrying by hand. */
export const noHandRolledRetry: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "A loop that catches an error and waits before trying again goes through `platform/retry`, not a hand-written loop." },
    schema: [],
    messages: {
      handRolled:
        "This loop catches an error and waits before trying again - a hand-rolled retry with no attempt bound visible here, no jitter and no way to honor an abort signal. Retry through `retry(work, { maxAttempts, baseDelayMs, maxDelayMs, signal })` from `platform/retry` (or the queue's declared `attempts`/`backoff`) instead of a loop written at the call site.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    if (isDeclarationFile(filename) || isOwnedBy(hfsOf(context), filename, "platform", "retry")) return {}
    const check = (node: LoopNode): void => {
      let hasCatch = false
      walk(node.body, (child) => {
        if (child.type === "CatchClause" || isPromiseCatch(context, child)) hasCatch = true
      }, { intoFunctions: false })
      if (!hasCatch) return
      // a wait is often a `new Promise((resolve) => setTimeout(resolve, ms))` executor, so the wait search enters functions
      let hasWait = false
      walk(node.body, (child) => {
        if (!hasWait && child.type === "CallExpression" && isWaitCall(context, child)) hasWait = true
      })
      if (hasWait) context.report({ node, messageId: "handRolled" })
    }
    const listener: RuleListener = Object.fromEntries(LOOP_TYPES.map((type) => [type, check]))
    return listener
  },
}

/** The rules this law contributes to the plugin. */
export const rules = {
  "http-needs-timeout": httpNeedsTimeout,
  "json-parse-needs-guard": jsonParseNeedsGuard,
  "no-hand-rolled-retry": noHandRolledRetry,
} satisfies Rules

/** All three start at error: no baseline exists, and the repositories' fix lanes clear the debt. */
export const recommended: Recommended = {
  "starci-be/http-needs-timeout": "error",
  "starci-be/json-parse-needs-guard": "error",
  "starci-be/no-hand-rolled-retry": "error",
}
