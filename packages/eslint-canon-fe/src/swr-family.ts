/** R285: API operations are wrapped by the SWR family before product code calls them. */
import { hfsOf } from "./lib/hfs.ts"
import { readFileSync, readdirSync, type Dirent } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { stringOf, walk } from "./lib/ast.ts"
import { functionOf, type FunctionNode, type Variable } from "./lib/bindings.ts"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules, type SourceCode } from "./lib/rule.ts"
import { classOf, fileOf, globalReferences, isApiLayer, isProductSource, resolveImport } from "./lib/scope.ts"
import { why } from "./lib/why.ts"

/** The SWR family names its wrapper files; entries and side-effect components are not wrappers. */
const isSwrHook = (context: AnyContext): boolean => {
  const found = classOf(context)
  return found.slot === "fe.hooks.swr" && !found.role && hfsOf(context).allows(fileOf(context))?.allowed === true
}

/** Cache providers and revalidation may be used by consumers; only request hooks own operations. */
const isRequestHook = (name: unknown): boolean => /^useSWR(?:Immutable|Infinite|Mutation|Subscription)?$/.test(String(name)) || name === "default"
const swrSource = (value: string): boolean => value === "swr" || value.startsWith("swr/")
const propertyName = (node: TSESTree.MemberExpression): unknown =>
  node.computed ? (node.property.type === "Literal" ? node.property.value : undefined) : node.property.name

/** The name a module export specifier spells: an identifier, or a string such as `"a-b"`. */
const exportName = (node: TSESTree.Identifier | TSESTree.StringLiteral): string => (node.type === "Identifier" ? node.name : node.value)

/** True for a specifier written `type x` inside a value import or export. */
const isTypeSpecifier = (specifier: TSESTree.ImportClause | TSESTree.ExportSpecifier): boolean =>
  (specifier.type === "ImportSpecifier" && specifier.importKind === "type") || (specifier.type === "ExportSpecifier" && specifier.exportKind === "type")

/** The parent of a reference's identifier; a reference always sits inside an expression or a declaration. */
const parentOfReference = (identifier: TSESTree.Identifier | TSESTree.JSXIdentifier): Node => {
  const parent = identifier.parent
  if (parent === undefined) throw new TypeError("Cannot read properties of undefined (reading 'type')")
  return parent
}

/** The module of the declaration holding an import binding; an import-equals declaration has none, which stops the run as it always has. */
const declarationSource = (parent: TSESTree.ImportDeclaration | TSESTree.TSImportEqualsDeclaration): unknown => {
  if (parent.type !== "ImportDeclaration") throw new TypeError("Cannot read properties of undefined (reading 'value')")
  return parent.source.value
}

/** Runtime imports of the request hooks (including aliases) are confined to named SWR wrappers. */
export const swrOnlyInFamily = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_SWR_OUTSIDE_FAMILY: request hooks belong to fe.hooks.swr." },
    schema: [],
    messages: { outside: "FE_SWR_OUTSIDE_FAMILY: SWR request hooks belong in hooks/swr/. Call the operation's wrapper hook here; cache providers and revalidation remain available to consumers." },
  },
  create(context) {
    if (!isProductSource(context) || isSwrHook(context)) return {}
    const namespaces = new Set<TSESTree.ImportNamespaceSpecifier>()
    const report = (node: Node): void => context.report({ node, messageId: "outside" })
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !swrSource(String(node.source.value))) return
        const runtime = node.specifiers.filter((s) => !isTypeSpecifier(s))
        if (runtime.some((s) => s.type === "ImportDefaultSpecifier" ||
          (s.type === "ImportSpecifier" && isRequestHook(exportName(s.imported))))) report(node)
        for (const specifier of runtime) if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier)
      },
      ExportNamedDeclaration(node) {
        if (!node.source || node.exportKind === "type" || !swrSource(String(node.source.value))) return
        if (node.specifiers.some((s) => s.exportKind !== "type" && isRequestHook(exportName(s.local)))) report(node)
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type" && swrSource(String(node.source.value))) report(node)
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && swrSource(String(node.source.value))) report(node)
      },
      CallExpression(node) {
        const [first] = node.arguments
        if (node.callee.type === "Identifier" && node.callee.name === "require" && first?.type === "Literal" &&
          swrSource(String(first.value)) && globalReferences(context, new Set(["require"])).includes(node.callee)) report(node)
      },
      "Program:exit"() {
        const source = context.sourceCode ?? context.getSourceCode()
        for (const specifier of namespaces) {
          const variable = source.getDeclaredVariables(specifier.parent).find((v) => v.name === specifier.local.name)
          for (const reference of variable?.references ?? []) {
            const id = reference.identifier
            const member = parentOfReference(id)
            // Passing or destructuring the namespace also makes its request hooks available outside the family.
            if (member.type !== "MemberExpression" || member.object !== id || member.computed && member.property.type !== "Literal" ||
              isRequestHook(propertyName(member))) report(id)
          }
        }
      },
    }
  },
})

/** The slot of the stream reader: only a stream operation of the API layer imports it, never an SWR hook, even inside a fetcher. */
const STREAM_READER_SLOT = "fe.transport.stream"

/** The slots of the result vocabulary: types, never operations. */
const OUTCOME_SLOTS: readonly (string | undefined)[] = ["fe.transport.outcome", "fe.package.api.outcome"]

/** The slots that hold API operations. */
const OPERATION_SLOTS: readonly (string | undefined)[] = ["fe.modules.api", "fe.package.api", "fe.transport.client", "fe.transport.stream", "fe.package.api.client"]

/** The `name` of a parsed package.json; reading it from `null` throws, as it always has. */
const manifestName = (manifest: unknown): unknown => {
  if (manifest === null || manifest === undefined) throw new TypeError("Cannot read properties of null (reading 'name')")
  return typeof manifest === "object" && "name" in manifest ? manifest.name : undefined
}

/** Type imports stay available; the API layer may compose its own operations and helpers. */
const isOperationSource = (context: AnyContext, value: unknown, only?: string): boolean => {
  if (typeof value !== "string") return false
  const hfs = hfsOf(context)
  let target = resolveImport(context, value)
  if (target === null) {
    // Workspace package names are read from their actual manifests, never inferred from a suffix.
    let folders: Dirent[]
    try { folders = readdirSync(join(hfs.repoRoot, "packages"), { withFileTypes: true }) } catch { return false }
    for (const folder of folders) {
      if (!folder.isDirectory()) continue
      const root = join(hfs.repoRoot, "packages", folder.name)
      if (hfs.slotOf(join(root, "src", "index.ts")) !== "fe.package.api") continue
      let name: unknown
      try { name = manifestName(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))) } catch { continue }
      if (typeof name !== "string" || !(value === name || value.startsWith(`${name}/`))) continue
      target = value === name ? join(root, "src", "index.ts") : join(root, "src", value.slice(name.length + 1))
      break
    }
    if (target === null) return false
  }
  // Prefer the actual file before a hypothetical barrel: outcome types have a more specific slot.
  const candidates = /\.[cm]?[jt]sx?$/.test(target) ? [target] : [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`, target]
  const found = candidates.map((file) => hfs.classify(file)).filter((entry) => entry.status === "owned")
  if (found.some((entry) => OUTCOME_SLOTS.includes(entry.slot))) return false
  if (only !== undefined) return found.some((entry) => entry.slot === only)
  return found.some((entry) => OPERATION_SLOTS.includes(entry.slot))
}

/** The generated input-bounds module holds constants and a pure reader derived from the contract, never an operation. */
const BOUNDS_MODULE = /(?:^|\/)__generated__\/input-bounds\.ts$/
const RE_EXPORT = /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g
const ENTRY = /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/

/** True when the named export of `target` is, through a chain of relative named re-exports, defined by a generated input-bounds module. */
const isBoundsExport = (target: string, name: string, depth = 0): boolean => {
  if (depth > 4) return false
  for (const file of [`${target}.ts`, `${target}/index.ts`, target]) {
    if (BOUNDS_MODULE.test(file.replaceAll("\\", "/"))) return true
    let text: string
    try { text = readFileSync(file, "utf8") } catch { continue }
    for (const [, list, source] of text.matchAll(RE_EXPORT)) {
      if (list === undefined || source === undefined || !source.startsWith(".")) continue
      for (const entry of list.split(",")) {
        const [, kind, origin, exported] = ENTRY.exec(entry) ?? []
        if (origin !== undefined && kind === undefined && (exported ?? origin) === name && isBoundsExport(resolve(dirname(file), source), origin, depth + 1)) return true
      }
    }
  }
  return false
}

/** A node that can bring a module in: an import, a re-export, a dynamic import or a `require` call. */
type InspectedNode = TSESTree.ImportDeclaration | TSESTree.ExportNamedDeclaration | TSESTree.ExportAllDeclaration | TSESTree.ImportExpression | TSESTree.CallExpression

/** A module brought in from the API layer, and whether it is the stream reader. */
interface Inspected {
  readonly node: InspectedNode
  readonly value: unknown
  readonly reader: boolean
}

/** The specifiers of an import or a re-export; the other inspected nodes have none. */
const specifiersOf = (node: InspectedNode): readonly (TSESTree.ImportClause | TSESTree.ExportSpecifier)[] | undefined =>
  node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" ? node.specifiers : undefined

/** An import of named values that all come from a generated input-bounds module is data, not an operation. */
const importsOnlyBounds = (context: AnyContext, node: InspectedNode, value: unknown): boolean => {
  const specifiers = specifiersOf(node)?.filter((s) => !isTypeSpecifier(s)) ?? []
  if (!specifiers.length || typeof value !== "string") return false
  const target = resolveImport(context, value)
  if (target === null) return false
  return specifiers.every((s) => {
    const name = s.type === "ImportSpecifier" ? exportName(s.imported) : s.type === "ExportSpecifier" ? exportName(s.local) : undefined
    return name !== undefined && isBoundsExport(target, name)
  })
}

const unwrap = (start: Node | null | undefined): Node | null | undefined => {
  let node = start
  while (node && (node.type === "ChainExpression" || node.type === "TSAsExpression" || node.type === "TSNonNullExpression" || node.type === "TSInstantiationExpression")) node = node.expression
  return node
}

/** Resolve lexical bindings so renamed imports and constant aliases keep their provenance. */
const bindingOf = (source: SourceCode, node: TSESTree.Identifier): Variable | null => {
  for (let scope: TSESLint.Scope.Scope | null = source.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name)
    if (variable !== undefined) return variable
  }
  return null
}

const requestOrigin = (source: SourceCode, input: Node | null | undefined, seen = new Set<Variable>()): "request" | "namespace" | null => {
  const node = unwrap(input)
  if (node?.type === "MemberExpression") return isRequestHook(propertyName(node)) && requestOrigin(source, node.object, seen) === "namespace" ? "request" : null
  if (node?.type !== "Identifier") return null
  const variable = bindingOf(source, node)
  if (!variable || seen.has(variable) || variable.defs.length !== 1) return null
  const [definition] = variable.defs
  if (definition === undefined) return null
  if (definition.type === "ImportBinding" && definition.parent.importKind !== "type" && swrSource(String(declarationSource(definition.parent)))) {
    const specifier = definition.node
    if ((specifier.type === "ImportSpecifier" || specifier.type === "TSImportEqualsDeclaration") && specifier.importKind === "type") return null
    if (specifier.type === "ImportNamespaceSpecifier") return "namespace"
    return specifier.type === "ImportDefaultSpecifier" || isRequestHook(specifier.type === "ImportSpecifier" ? exportName(specifier.imported) : "") ? "request" : null
  }
  if (definition.type !== "Variable" || definition.parent.kind !== "const") return null
  return requestOrigin(source, definition.node.init, new Set([...seen, variable]))
}

/** Every value reference to the operation must belong to an SWR fetcher, including a named local fetcher. */
const wrappedOperations = (context: AnyContext, program: TSESTree.Program, imports: readonly Inspected[]): Set<InspectedNode> => {
  const source = context.sourceCode ?? context.getSourceCode()
  const fetchers: Node[] = []
  walk(source, program, (node) => {
    if (node.type !== "CallExpression" || requestOrigin(source, node.callee) !== "request") return
    const argument = node.arguments[1]
    if (!argument) return
    let fetcher: Node = unwrap(argument) ?? argument
    if (fetcher.type === "Identifier") {
      const definition = bindingOf(source, fetcher)?.defs[0]
      if (definition?.type === "Variable" && definition.parent.kind === "const") fetcher = unwrap(definition.node.init) ?? fetcher
      else if (definition?.node.type === "FunctionDeclaration") fetcher = definition.node
    }
    fetchers.push(fetcher)
  })
  const inFetcher = (node: Node): boolean => fetchers.some((fetcher) => fetcher.range[0] <= node.range[0] && fetcher.range[1] >= node.range[1])
  return new Set(imports.filter(({ node }) => {
    if (node.type !== "ImportDeclaration") return inFetcher(node)
    const runtimeNames = new Set(node.specifiers.filter((s) => !isTypeSpecifier(s)).map((s) => s.local.name))
    const references = source.getDeclaredVariables(node).filter((v) => runtimeNames.has(v.name))
      .flatMap((v) => v.references.filter((r) => r.isValueReference !== false).map((r) => r.identifier))
    return references.length > 0 && references.every(inFetcher)
  }).map(({ node }) => node))
}

/** Direct operation access from domain hooks, features and components skips the request lifecycle. */
export const operationsOnlyInSwrHooks = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_OP_OUTSIDE_SWR_HOOK: runtime API operations are consumed only by SWR wrappers." },
    schema: [],
    messages: { outside: "FE_OP_OUTSIDE_SWR_HOOK: `{{source}}` exposes API operations outside an SWR wrapper. Wrap the operation in hooks/swr/ and call that hook; type-only imports remain available." },
  },
  create(context) {
    if (!isProductSource(context) || isApiLayer(context)) return {}
    const imports: Inspected[] = []
    const inspect = (node: InspectedNode, value: unknown): void => {
      if (isOperationSource(context, value) && !importsOnlyBounds(context, node, value)) imports.push({ node, value, reader: isOperationSource(context, value, STREAM_READER_SLOT) })
    }
    return {
      ImportDeclaration(node) {
        if (node.importKind !== "type" && (!node.specifiers.length || node.specifiers.some((s) => !isTypeSpecifier(s)))) inspect(node, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source && node.exportKind !== "type" && node.specifiers.some((s) => s.exportKind !== "type")) inspect(node, node.source.value)
      },
      ExportAllDeclaration(node) { if (node.exportKind !== "type") inspect(node, node.source.value) },
      ImportExpression(node) { inspect(node, stringOf(node.source)) },
      CallExpression(node) {
        const [first] = node.arguments
        if (node.callee.type === "Identifier" && node.callee.name === "require" && first?.type === "Literal" &&
          globalReferences(context, new Set(["require"])).includes(node.callee)) inspect(node, first.value)
      },
      "Program:exit"(program) {
        if (!imports.length) return
        const wrapped = isSwrHook(context) ? wrappedOperations(context, program, imports) : new Set<InspectedNode>()
        for (const { node, value, reader } of imports) if (reader || !wrapped.has(node)) context.report({ node, messageId: "outside", data: { source: value } })
      },
    }
  },
})

/** A stream operation: `modules/api/sse/<area>/stream-<channel>` or `modules/api/graphql/subscriptions/subscription-<name>`. */
const STREAM_OPERATION = /modules\/api\/(?:sse\/[^/]+\/stream-[^/]+|graphql\/subscriptions\/subscription-[^/]+)(?:\.tsx?)?$/

/** A subscription hook file of the SWR family: `useSubscribe<X>Swr.ts`. */
const isSubscriptionHook = (context: AnyContext): boolean => isSwrHook(context) && /^useSubscribe[A-Z0-9]\w*Swr\.ts$/.test(fileOf(context).replaceAll("\\", "/").split("/").at(-1) ?? "")

/** The `onOpen` property of an object literal, else undefined. */
const onOpenOf = (options: Node | undefined): TSESTree.Property | undefined =>
  options?.type === "ObjectExpression"
    ? options.properties.find((property): property is TSESTree.Property => property.type === "Property" && !property.computed && property.key.type === "Identifier" && property.key.name === "onOpen")
    : undefined

/** True when a function calls `mutate` (the bound mutate of a hook or the one of `useSWRConfig`): the revalidation of the snapshot query. */
const callsMutate = (source: SourceCode, handler: FunctionNode): boolean => {
  let found = false
  walk(source, handler.body, (node) => {
    if (found) return false
    if (node.type !== "CallExpression") return undefined
    const callee = unwrap(node.callee)
    if ((callee?.type === "Identifier" && callee.name === "mutate") || (callee?.type === "MemberExpression" && propertyName(callee) === "mutate")) found = true
    return undefined
  })
  return found
}

/** True when a callee is a stream operation: a named import, a member of a namespace import, or a const alias of either. */
const isStreamCallee = (source: SourceCode, input: Node | null | undefined, locals: ReadonlyMap<string, "named" | "namespace">, seen = new Set<Variable>()): boolean => {
  const node = unwrap(input)
  if (node?.type === "MemberExpression") {
    const object = unwrap(node.object)
    return object?.type === "Identifier" && locals.get(object.name) === "namespace" && bindingOf(source, object)?.defs[0]?.type === "ImportBinding"
  }
  if (node?.type !== "Identifier") return false
  const variable = bindingOf(source, node)
  if (!variable || seen.has(variable) || variable.defs.length !== 1) return false
  const [definition] = variable.defs
  if (definition === undefined) return false
  if (definition.type === "ImportBinding") return locals.get(variable.name) === "named"
  if (definition.type !== "Variable" || definition.parent.kind !== "const") return false
  return isStreamCallee(source, definition.node.init, locals, new Set([...seen, variable]))
}

/**
 * A stream or subscription has no replay of what it missed (graphql-ws has none, an SSE reconnect replays a bounded buffer), so the
 * subscription hook revalidates the snapshot query each time the stream opens: its call of the stream operation (named, through a
 * namespace or an alias) passes an `onOpen` handler that calls `mutate`, and a subscription hook that calls no stream operation at
 * all is not one (FE-REALTIME-2).
 */
export const subscriptionRefetchesSnapshot = defineRule({
  meta: {
    type: "problem",
    docs: { description: "FE_SUBSCRIPTION_NO_SNAPSHOT: a subscription hook passes the stream operation an onOpen handler that revalidates the snapshot query." },
    schema: [],
    messages: {
      missing:
        "FE_SUBSCRIPTION_NO_SNAPSHOT: this call of a stream operation has no `onOpen` handler that calls `mutate`. A stream carries changes, not the state: pass `onOpen: () => void mutate(<snapshot query key>)` so the screen reads its snapshot with the query each time the stream (re)opens.",
      noStream:
        "FE_SUBSCRIPTION_NO_SNAPSHOT: a `useSubscribe<X>Swr` hook calls one stream operation (`modules/api/sse/<area>/stream-*.ts` or `modules/api/graphql/subscriptions/subscription-*.ts`) and revalidates its snapshot query in `onOpen`; this file calls none.",
    },
  },
  create(context) {
    if (!isProductSource(context) || !isSubscriptionHook(context)) return {}
    const source = context.sourceCode ?? context.getSourceCode()
    const locals = new Map<string, "named" | "namespace">()
    let calls = 0
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || typeof node.source.value !== "string") return
        const target = resolveImport(context, node.source.value)
        if (target === null || !STREAM_OPERATION.test(target.replaceAll("\\", "/"))) return
        for (const specifier of node.specifiers) {
          if (isTypeSpecifier(specifier)) continue
          if (specifier.type === "ImportSpecifier") locals.set(specifier.local.name, "named")
          if (specifier.type === "ImportNamespaceSpecifier") locals.set(specifier.local.name, "namespace")
        }
      },
      CallExpression(node) {
        if (!isStreamCallee(source, node.callee, locals)) return
        calls += 1
        const handler = functionOf(context, onOpenOf(node.arguments[0])?.value)
        if (!handler || !callsMutate(source, handler)) context.report({ node, messageId: "missing" })
      },
      "Program:exit"(program) {
        if (calls === 0) context.report({ node: program, messageId: "noStream" })
      },
    }
  },
})

/** Code metadata is registered on the shared object without changing the shared catalog module. */
Object.assign(why, {
  "swr-only-in-family": { code: "FE_SWR_OUTSIDE_FAMILY", en: "A request hook is used outside the SWR family.", fix: "Call the operation's SWR wrapper hook." },
  "operations-only-in-swr-hooks": { code: "FE_OP_OUTSIDE_SWR_HOOK", en: "An API operation is consumed outside an SWR wrapper.", fix: "Wrap the operation in hooks/swr/." },
  "subscription-refetches-snapshot": { code: "FE_SUBSCRIPTION_NO_SNAPSHOT", en: "A subscription hook does not revalidate its snapshot query when the stream opens.", fix: "Pass the stream operation an onOpen handler that revalidates the snapshot query key." },
})

/** R285's published lint enforcers. */
export const rules: Rules = { "swr-only-in-family": swrOnlyInFamily, "operations-only-in-swr-hooks": operationsOnlyInSwrHooks, "subscription-refetches-snapshot": subscriptionRefetchesSnapshot }
export const recommended: Recommended = Object.fromEntries(Object.keys(rules).map((name) => [`starci-fe/${name}`, "error"]))
