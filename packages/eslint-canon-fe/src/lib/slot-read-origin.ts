/** R367: prove that a returned canonical slot consumes the folded data and the reads that produced it. */
import path from "node:path"
import ts from "typescript"
import type { TSESTree } from "@typescript-eslint/utils"
import { importOf, unwrap, variableOf } from "./bindings.ts"
import type { AnyContext, Node } from "./rule.ts"

const initializer = (context: AnyContext, node: TSESTree.Identifier): Node | null => {
  const definition = variableOf(context, node)?.defs.find(entry => entry.type === "Variable" && entry.parent?.kind === "const")
  return definition?.node.type === "VariableDeclarator" && definition.node.id.type === "Identifier" ? definition.node.init : null
}

/** Property names and object keys do not read an identically named variable. */
const reference = (node: TSESTree.Identifier): boolean => !(node.parent.type === "MemberExpression" && node.parent.property === node && !node.parent.computed)
  && !(node.parent.type === "Property" && node.parent.key === node && !node.parent.computed && !node.parent.shorthand)

const visits = (context: AnyContext, root: Node, visit: (node: Node) => void): void => {
  visit(root)
  for (const key of context.sourceCode.visitorKeys[root.type] ?? []) {
    const value: unknown = Reflect.get(root, key)
    const children = Array.isArray(value) ? value : [value]
    for (const child of children) if (child !== null && typeof child === "object" && "type" in child) visits(context, child as Node, visit)
  }
}

/** Follow const aliases by lexical binding; a similarly named variable in another callback is unrelated. */
const dependsOn = (context: AnyContext, input: Node, target: Node, seen = new Set<Node>()): boolean => {
  if (input === target) return true
  if (seen.has(input)) return false
  seen.add(input)
  let found = false
  visits(context, input, node => {
    if (node === target) found = true
    if (node.type !== "Identifier" || !reference(node)) return
    const value = initializer(context, node)
    if (value && dependsOn(context, value, target, seen)) found = true
  })
  return found
}

interface Access {
  readonly root: TSESTree.Identifier
  readonly keys: readonly string[]
}

const access = (input: Node, computed = false): Access | null => {
  const keys: string[] = []
  let node = unwrap(input)
  while (node.type === "MemberExpression" || node.type === "CallExpression") {
    if (node.type === "CallExpression") { node = unwrap(node.callee); continue }
    const key = !node.computed && node.property.type === "Identifier" ? node.property.name : node.property.type === "Literal" && typeof node.property.value === "string" ? node.property.value : null
    if (key === null && !computed) return null
    keys.unshift(key ?? "*")
    node = unwrap(node.object)
  }
  return node.type === "Identifier" ? { root: node, keys } : null
}

const sameAccess = (context: AnyContext, input: Node, root: TSESTree.Identifier, keys: readonly string[]): boolean => {
  const candidate = access(input)
  return candidate !== null && variableOf(context, candidate.root) === variableOf(context, root)
    && candidate.keys.length === keys.length && candidate.keys.every((key, index) => key === keys[index])
}

const canonicalFold = (context: AnyContext, node: TSESTree.CallExpression): boolean => {
  const callee = unwrap(node.callee)
  if (callee.type !== "Identifier") return false
  const imported = importOf(context, callee)
  if (imported?.imported !== "slotOfReads") return false
  const source = imported.source.startsWith(".") ? path.resolve(path.dirname(context.filename), imported.source).replaceAll("\\", "/") : imported.source
  return /(?:^|\/)hooks\/slot(?:\/index)?(?:\.[cm]?ts)?$/.test(source)
}

const ownFunction = (node: Node): Node | null => {
  for (let parent: Node | undefined = node.parent; parent; parent = parent.parent) {
    if (parent.type === "ArrowFunctionExpression" || parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") return parent
  }
  return null
}

/** A memo is a projection, not a read: trace data accesses inside it back to their hook-result bindings. */
export const projectedReads = (context: AnyContext, root: TSESTree.Identifier): readonly TSESTree.Identifier[] | null => {
  const call = unwrap(initializer(context, root))
  if (call?.type !== "CallExpression") return null
  const callee = unwrap(call.callee)
  const imported = callee.type === "Identifier" ? importOf(context, callee) : null
  if (imported?.source !== "react" || imported.imported !== "useMemo") return null
  const roots: TSESTree.Identifier[] = []
  visits(context, call, node => {
    if (node.type !== "MemberExpression" || node.computed || node.property.type !== "Identifier" || node.property.name !== "data") return
    const owner = access(node.object)
    if (!owner) return
    const origin = unwrap(initializer(context, owner.root))
    if (origin?.type === "CallExpression" && origin.callee.type === "Identifier" && /^use[A-Z]/.test(origin.callee.name)
      && !roots.some(known => variableOf(context, known) === variableOf(context, owner.root))) roots.push(owner.root)
  })
  return roots
}

const readArray = (context: AnyContext, input: Node | undefined, seen = new Set<Node>()): readonly Node[] | null => {
  const node = unwrap(input)
  if (!node || seen.has(node)) return null
  seen.add(node)
  if (node.type === "Identifier") return readArray(context, initializer(context, node) ?? undefined, seen)
  return node.type === "ArrayExpression" && node.elements.every(element => element !== null && element.type !== "SpreadElement") ? node.elements : null
}

/** A composite hook's returned data is traced to its own read declarations, then back to its public read paths. */
const compositeReads = (context: AnyContext, root: TSESTree.Identifier, output: string): readonly (readonly string[])[] | null => {
  const definition = variableOf(context, root)?.defs.find(entry => entry.type === "Variable")
  const call = definition?.node.type === "VariableDeclarator" ? unwrap(definition.node.init) : null
  const services = context.sourceCode.parserServices
  const checker = services?.program?.getTypeChecker()
  const mapped = call && services?.esTreeNodeToTSNodeMap?.get(call)
  if (!checker || !mapped || !ts.isCallExpression(mapped)) return null
  const declaration = checker.getResolvedSignature(mapped)?.declaration
  if (!declaration || !(ts.isArrowFunction(declaration) || ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration)) || !declaration.body) return null
  const returned = ts.isBlock(declaration.body) ? declaration.body.statements.filter(ts.isReturnStatement) : []
  const value = ts.isBlock(declaration.body) ? returned.length === 1 ? returned[0]?.expression : undefined : declaration.body
  if (!value || !ts.isObjectLiteralExpression(value)) return null
  const expressionOf = (property: ts.ObjectLiteralElementLike): ts.Expression | undefined => ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined
  const field = value.properties.find(property => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === output)
  const data = field && expressionOf(field)
  if (!data) return null
  const symbolOf = (node: ts.Identifier): ts.Symbol | undefined => ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
  const variable = (node: ts.Identifier): ts.VariableDeclaration | undefined => symbolOf(node)?.declarations?.find(ts.isVariableDeclaration)
  const hookRead = (node: ts.Identifier): ts.Symbol | undefined => {
    const init = variable(node)?.initializer
    return init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && /^use[A-Z]/.test(init.expression.text) ? symbolOf(node) : undefined
  }
  const origins = new Set<ts.Symbol>()
  const seen = new Set<ts.Node>()
  const collect = (node: ts.Node): void => {
    if (seen.has(node)) return
    seen.add(node)
    if (ts.isPropertyAccessExpression(node) && node.name.text === "data" && ts.isIdentifier(node.expression)) {
      const origin = hookRead(node.expression)
      if (origin) { origins.add(origin); return }
    }
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      const init = variable(node)?.initializer
      if (init && init.getSourceFile() === declaration.getSourceFile()) collect(init)
    }
    ts.forEachChild(node, collect)
  }
  collect(data)
  if (origins.size === 0) return null
  const paths = new Map<ts.Symbol, readonly string[]>()
  const exposed = (node: ts.Expression, keys: readonly string[]): void => {
    if (ts.isIdentifier(node)) {
      const origin = hookRead(node)
      if (origin) paths.set(origin, keys)
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const expression = expressionOf(property)
        if (expression && property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) exposed(expression, [...keys, property.name.text])
      }
    }
  }
  exposed(value, [])
  return [...origins].every(origin => paths.has(origin)) ? [...origins].map(origin => paths.get(origin) as readonly string[]) : null
}

/** Every underlying read is folded and the returned projector actually consumes this fallback expression. */
export const slotProtectsFold = (context: AnyContext, fold: TSESTree.LogicalExpression, fn: Node): boolean => {
  const source = access(fold.left, true)
  if (!source) return false
  const required = source.keys.length > 0 ? compositeReads(context, source.root, source.keys[0] as string) : null
  let protectedFold = false
  visits(context, fn, node => {
    if (node.type !== "CallExpression" || ownFunction(node) !== fn || !canonicalFold(context, node)) return
    const reads = readArray(context, node.arguments[0])
    const projector = unwrap(node.arguments[1])
    if (!reads || !projector || projector.type !== "ArrowFunctionExpression" || !dependsOn(context, projector.body, fold)) return
    const paths = required ?? [[]]
    if (!paths.every(keys => reads.some(read => sameAccess(context, read, source.root, keys)))) return
    visits(context, fn, candidate => {
      if (candidate.type === "ReturnStatement" && ownFunction(candidate) === fn && candidate.argument && dependsOn(context, candidate.argument, node)) protectedFold = true
    })
  })
  return protectedFold
}
