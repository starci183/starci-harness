/**
 * R287 FE_CALLBACK_SHAPE: the Supabase callback only reads the PKCE code (or the email-link `token_hash` and `type`), exchanges it
 * through the auth owner with exactly one `exchangeAuthCode(code)` or one `verifyOtp({ token_hash, type })`, and redirects. It may read
 * the exchange result's `success` or `ok` flag and call PURE text helpers of `modules/routes` or `modules/auth` (`requestOrigin`,
 * `safeNextPath`), found by symbol resolution in lib/pure-owner-helper.mjs, so open-redirect protection stays in the app's owner modules.
 * Cookie configuration and writes belong in the Supabase helper in fe.modules.auth; application data belongs in the back end.
 * This syntax check follows lexical bindings and local aliases rather than trusting a method's spelling.
 */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { stringOf, walk } from "./lib/ast.ts"
import { patternPath, type FunctionNode, type PathStep, type Variable } from "./lib/bindings.ts"
import { normalizePath } from "./lib/path.ts"
import { ownerExportKind } from "./lib/pure-owner-helper.ts"
import { defineRule, type AnyContext, type Node, type Recommended, type Rules, type SourceCode } from "./lib/rule.ts"
import { classifyImport, inSlot, resolveImport } from "./lib/scope.ts"

/** What a value is known to be: a provenance kind (`request`, `code`, `text`, ...), or null when unknown. */
type Kind = string | null

/** The imports of the callback file, by the variable they bind. */
type Imports = Map<Variable | null | undefined, string>

/** What the walk carries: the source, the GET handler and the allowed imports. */
interface Env {
  readonly sourceCode: SourceCode
  readonly handler: FunctionNode
  readonly imports: Imports
}

/** The provenance reader of one callback. */
type Origin = (input: Node | null | undefined, seen?: Set<Variable>) => Kind

/** A value a well-formed tree always has; its absence stops the run as reading it always has. */
const must = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new TypeError(`missing ${what}`)
  return value
}

/** The node a runtime wrapper wraps, or undefined when the node wraps nothing. */
const wrapped = (node: Node): Node | undefined => {
  if (node.type === "AwaitExpression") return node.argument
  if (node.type === "ChainExpression" || node.type === "TSAsExpression" || node.type === "TSTypeAssertion" || node.type === "TSNonNullExpression" || node.type === "TSInstantiationExpression") return node.expression
  return undefined
}

const WRAPPERS = new Set(["AwaitExpression", "ChainExpression", "TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "TSInstantiationExpression"])

/** Runtime expression wrappers that preserve the value's source. */
const unwrap = (input: Node | null | undefined): Node | null | undefined => {
  let node = input
  while (node && WRAPPERS.has(node.type)) node = wrapped(node)
  return node
}

/** A member's static key, including a bracketed string spelling. */
const memberName = (node: TSESTree.MemberExpression): string | null =>
  node.computed ? stringOf(node.property) : node.property.name

/** The name an identifier-like node spells, or undefined. */
const nameOf = (node: Node): string | undefined => ("name" in node && typeof node.name === "string" ? node.name : undefined)

/** The lexical binding of an identifier, including shadowing inside the handler. */
const bindingOf = (sourceCode: SourceCode, node: Node): Variable | null => {
  const name = nameOf(node)
  for (let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = name === undefined ? undefined : scope.set.get(name)
    if (variable) return variable
  }
  return null
}

/** Whether an identifier refers to the actual unshadowed platform global. */
const isGlobal = (sourceCode: SourceCode, node: Node | null | undefined, name: string): boolean =>
  node?.type === "Identifier" && node.name === name && !(bindingOf(sourceCode, node)?.defs.length)

/** Route configuration is inert; a second HTTP door or an exported helper is not. */
const CONFIG_EXPORTS = new Set(["runtime", "dynamic", "revalidate", "fetchCache", "preferredRegion", "maxDuration"])
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])
const FORBIDDEN = new Set(["AssignmentExpression", "UpdateExpression", "ImportExpression", "TaggedTemplateExpression", "ClassDeclaration", "ClassExpression", "ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement", "ThrowStatement", "YieldExpression", "SpreadElement", "ArrayPattern", "JSXElement", "JSXFragment"])
const TEXT = new Set<Kind>(["text", "code", "otp-type"])
const CALLS = new Set<Kind>(["factory", "exchange", "verify-otp", "pure", "redirect", "params-get", "params-has", "text-guard"])
/** What a pure owner helper may be given: query text, the page URL or request, and plain values; never the credential itself. */
const PURE_ARGUMENTS = new Set<Kind>(["text", "otp-type", "scalar", "url", "request"])
const URL_TEXT = new Set(["origin", "href", "pathname", "search", "hash", "host", "hostname", "protocol"])
const CALL_RESULTS = new Map<Kind, string>([["factory", "client"], ["exchange", "exchange-result"], ["verify-otp", "exchange-result"], ["pure", "text"], ["redirect", "redirect-result"], ["params-has", "scalar"], ["text-guard", "scalar"]])
const MEMBERS = new Map<Kind, Map<PathStep, string>>([
  ["request", new Map([["nextUrl", "url"], ["url", "text"]])],
  ["url", new Map<PathStep, string>([["searchParams", "params"], ...[...URL_TEXT].map((key): [string, string] => [key, "text"])])],
  ["params", new Map([["get", "params-get"], ["has", "params-has"]])],
  ["client", new Map([["auth", "auth"]])],
  ["auth", new Map([["exchangeCodeForSession", "exchange"], ["verifyOtp", "verify-otp"]])],
  ["next-response", new Map([["redirect", "redirect"]])],
  ["exchange-result", new Map([["error", "exchange-error"], ["success", "scalar"], ["ok", "scalar"]])],
])
const TEXT_GUARDS: readonly PathStep[] = ["startsWith", "endsWith", "includes"]
const UNSAFE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"]
const REDIRECT_TARGETS: readonly Kind[] = ["text", "url"]
const REDIRECT_STATUSES: readonly unknown[] = [301, 302, 303, 307, 308]

/** The query parameters whose provenance an exchange requires: the PKCE code, and the email link's token hash and type. */
const PARAM_ORIGINS = new Map<string | null, string>([["code", "code"], ["token_hash", "token-hash"], ["type", "otp-type"]])

/** True for a function node. */
const isFunctionNode = (node: Node): node is FunctionNode => FUNCTIONS.has(node.type)

/** A runtime export: its name and implementation. */
interface Export {
  readonly name: string
  readonly value: Node | null | undefined
}

/** A locally exported binding's implementation. */
const exportValue = (sourceCode: SourceCode, entry: TSESTree.ExportSpecifier): Node | null | undefined => {
  const definition = bindingOf(sourceCode, entry.local)?.defs[0]?.node
  return unwrap(definition?.type === "VariableDeclarator" ? definition.init : definition)
}

/** The spelling of an export or import name: an identifier's name or a string literal's value. */
const moduleExportName = (node: TSESTree.Identifier | TSESTree.StringLiteral): string =>
  node.type === "Identifier" ? node.name : node.value

/** The runtime names introduced by one local named export. */
const namedExports = (statement: TSESTree.ExportNamedDeclaration, sourceCode: SourceCode): Export[] | null => {
  const declaration = statement.declaration
  if (declaration?.type === "FunctionDeclaration") return [{ name: must(declaration.id, "function name").name, value: declaration }]
  if (declaration?.type === "VariableDeclaration") {
    if (declaration.declarations.some((entry) => entry.id.type !== "Identifier")) return null
    return declaration.declarations.map((entry) => ({ name: must(nameOf(entry.id), "variable name"), value: unwrap(entry.init) }))
  }
  if (declaration) return []
  return statement.specifiers.filter((entry) => entry.exportKind !== "type")
    .map((entry) => ({ name: moduleExportName(entry.exported), value: exportValue(sourceCode, entry) }))
}

/** Collect runtime exports, refusing reexports and default exports. */
const exportsOf = (program: TSESTree.Program, sourceCode: SourceCode): Export[] | null => {
  const exported: Export[] = []
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration" || statement.type === "ExportAllDeclaration") return null
    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue
    if (statement.source) return null
    const entries = namedExports(statement, sourceCode)
    if (!entries) return null
    exported.push(...entries)
  }
  return exported
}

/** Find the one locally implemented GET export and its single request parameter. */
const handlerOf = (program: TSESTree.Program, sourceCode: SourceCode): FunctionNode | null => {
  const exported = exportsOf(program, sourceCode)
  if (!exported || exported.some((entry) => entry.name !== "GET" && !CONFIG_EXPORTS.has(entry.name))) return null
  const handlers = exported.filter((entry) => entry.name === "GET")
  if (handlers.length !== 1) return null
  const handler = must(handlers[0], "GET export").value
  if (!handler || !isFunctionNode(handler) || !handler.async || handler.generator) return null
  return handler.params.length === 1 && handler.params[0]?.type === "Identifier" ? handler : null
}

/** Framework imports retain their actual owner even under a local alias. */
const frameworkImportKind = (source: string, name: string | undefined): string | null => {
  if (source === "next/server" && name === "NextResponse") return "next-response"
  if (source === "next/server" && name === "NextRequest") return "request-type"
  if (source === "next/navigation" && name === "redirect") return "redirect"
  return null
}

/** Only the server auth entry exposes the cookie-owning exchangeAuthCode helper. */
const isServerAuthImport = (context: AnyContext, source: string): boolean => {
  const target = normalizePath(resolveImport(context, source))
  return target.endsWith("/modules/auth/server") || target.endsWith("/modules/auth/server.ts")
}

/** A directory import resolves to its index, before the generic modules slot's hypothetical routes.ts. */
const isRoutesImport = (context: AnyContext, source: string, slot: string | undefined): boolean =>
  slot === "fe.modules.routes" || classifyImport(context, `${source}/index`)?.slot === "fe.modules.routes"

const CLIENT_NAMES: readonly (string | undefined)[] = ["supabase", "supabaseClient", "authClient"]

/** The exchange, client and factory names of the auth owner. */
const authImportKind = (context: AnyContext, source: string, name: string | undefined): string | null => {
  if (name === "exchangeAuthCode" && isServerAuthImport(context, source)) return "exchange"
  if (name === "verifyOtp" && isServerAuthImport(context, source)) return "verify-otp"
  if (name === "exchangeCodeForSession") return "exchange"
  if (/^(?:create|get)\w*Client$/.test(name ?? "")) return "factory"
  if (CLIENT_NAMES.includes(name)) return "client"
  return null
}

/** Auth helpers and static route values must come from their declared HFS owners; any other export of `modules/routes` or `modules/auth` counts only as a pure helper or a static table. */
const ownerImportKind = (context: AnyContext, source: string, name: string | undefined): string | null => {
  const slot = classifyImport(context, source)?.slot
  if (name === "APP_ROUTES" && isRoutesImport(context, source, slot)) return "routes"
  const authKind = slot === "fe.modules.auth" ? authImportKind(context, source, name) : null
  if (authKind || !(slot === "fe.modules.auth" || isRoutesImport(context, source, slot))) return authKind
  // A default or namespace import names no export, so no export of the owner can match it.
  return name === undefined ? null : ownerExportKind(context, source, name)
}

/** The imported name of a specifier; undefined for a default or namespace import. */
const importedName = (specifier: TSESTree.ImportClause): string | undefined =>
  specifier.type === "ImportSpecifier" ? moduleExportName(specifier.imported) : undefined

/** Register the allowed bindings in a single import statement. */
const addImportBindings = (context: AnyContext, sourceCode: SourceCode, statement: TSESTree.ImportDeclaration, imports: Imports): boolean => {
  const source = String(statement.source.value)
  if (source === "server-only" && statement.specifiers.length === 0) return true
  if (statement.specifiers.length === 0) return false
  const variables = sourceCode.getDeclaredVariables(statement)
  for (const specifier of statement.specifiers) {
    if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue
    const name = importedName(specifier)
    const kind = frameworkImportKind(source, name) ?? ownerImportKind(context, source, name)
    if (!kind) return false
    imports.set(variables.find((entry) => entry.name === specifier.local.name), kind)
  }
  return true
}

/** Every runtime import is restricted, even if it is unused in the handler. */
const importsOf = (context: AnyContext, program: TSESTree.Program, sourceCode: SourceCode): Imports | null => {
  const imports: Imports = new Map()
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue
    if (!addImportBindings(context, sourceCode, statement, imports)) return null
  }
  return imports
}

/** Select a known property without granting arbitrary methods on the selected value. */
const memberKind = (kind: Kind, key: PathStep): Kind => {
  if (kind === "routes" && typeof key === "string" && !UNSAFE_KEYS.includes(key)) return "text"
  if (TEXT.has(kind) && TEXT_GUARDS.includes(key)) return "text-guard"
  return MEMBERS.get(kind)?.get(key) ?? null
}

/** An identifier keeps the provenance of its one initializer or the GET request parameter. */
const identifierOrigin = (node: TSESTree.Identifier, seen: Set<Variable>, env: Env, origin: Origin): Kind => {
  const variable = bindingOf(env.sourceCode, node)
  if (env.imports.has(variable)) return env.imports.get(variable) ?? null
  if (!variable || seen.has(variable) || variable.defs.length !== 1) return null
  const definition = must(variable.defs[0], "definition")
  if (definition.type === "Parameter" && definition.node === env.handler) return "request"
  if (definition.node.type !== "VariableDeclarator") return null
  const path = patternPath(definition.node.id, node.name)
  const nextSeen = new Set([...seen, variable])
  return path?.reduce<Kind>((kind, key) => memberKind(kind, key), origin(definition.node.init, nextSeen)) ?? null
}

/** Combining known primitive values cannot introduce user-defined coercion. */
const combinedOrigin = (kinds: readonly [Kind, Kind], conditional = false): Kind => {
  if (conditional && kinds[0] === kinds[1]) return kinds[0]
  if (kinds.every((kind) => TEXT.has(kind))) return "text"
  if (!conditional && kinds.every((kind) => TEXT.has(kind) || kind === "scalar")) return "scalar"
  return null
}

/** The source of a call's return value, independent of argument validation. */
const callOrigin = (node: TSESTree.CallExpression, seen: Set<Variable>, origin: Origin): Kind => {
  const kind = origin(node.callee, seen)
  if (kind === "params-get") return PARAM_ORIGINS.get(stringOf(node.arguments[0])) ?? "text"
  return CALL_RESULTS.get(kind) ?? null
}

/** Composite expressions retain provenance only for supported primitive operations. */
const expressionOrigin = (node: Node, seen: Set<Variable>, env: Env, origin: Origin): Kind => {
  if (node.type === "TemplateLiteral") return node.expressions.every((expression) => TEXT.has(origin(expression, seen)) || origin(expression, seen) === "scalar") ? "text" : null
  if (node.type === "MemberExpression") return memberKind(origin(node.object, seen), memberName(node))
  if (node.type === "NewExpression" && isGlobal(env.sourceCode, node.callee, "URL")) return "url"
  if (node.type === "LogicalExpression" || node.type === "BinaryExpression") return combinedOrigin([origin(node.left, seen), origin(node.right, seen)])
  if (node.type === "ConditionalExpression") return combinedOrigin([origin(node.consequent, seen), origin(node.alternate, seen)], true)
  if (node.type === "CallExpression") return callOrigin(node, seen, origin)
  return null
}

/** Follow lexical aliases rather than trusting the spelling of an identifier. */
const originOf = (env: Env): Origin => {
  const origin: Origin = (input, seen = new Set()) => {
    const node = unwrap(input)
    if (!node) return null
    if (node.type === "Identifier") return identifierOrigin(node, seen, env, origin)
    if (node.type === "Literal") return typeof node.value === "string" || node.value === null ? "text" : "scalar"
    return expressionOrigin(node, seen, env, origin)
  }
  return origin
}

/** The closest enclosing function must be the GET handler. */
const insideHandler = (node: Node, handler: Node): boolean => {
  for (let parent = node.parent; parent; parent = parent.parent) if (FUNCTIONS.has(parent.type)) return parent === handler
  return false
}

/** Await must wrap the actual exchange call before its enclosing statement ends. */
const isAwaited = (node: Node, handler: Node): boolean => {
  for (let parent = node.parent; parent && parent !== handler; parent = parent.parent) {
    if (parent.type === "AwaitExpression") return true
    if (parent.type.endsWith("Statement")) return false
  }
  return false
}

/** The static key of a plain `init` property, or null for a computed, method or accessor property and for a spread. */
const plainKey = (property: TSESTree.ObjectLiteralElement): string | number | null => {
  if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") return null
  const key = property.key
  return key.type === "Identifier" ? key.name : key.value
}

/** Only a literal redirect status is allowed in an options object. */
const isRedirectStatus = (property: TSESTree.ObjectLiteralElement): boolean => {
  if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") return false
  return plainKey(property) === "status" && property.value.type === "Literal" && REDIRECT_STATUSES.includes(property.value.value)
}

/** Arbitrary objects can invoke getters or toString during coercion; only redirect options belong here. */
const isRedirectOptions = (node: TSESTree.ObjectExpression, origin: Origin): boolean =>
  node.parent.type === "CallExpression" && origin(node.parent.callee) === "redirect" && node.parent.arguments[1] === node && node.properties.every(isRedirectStatus)

/** The one object `verifyOtp` takes: exactly `token_hash` read from the query `token_hash` and `type` read from the query `type`. */
const isOtpArguments = (node: TSESTree.ObjectExpression, origin: Origin): boolean => {
  if (node.parent.type !== "CallExpression" || origin(node.parent.callee) !== "verify-otp" || node.parent.arguments[0] !== node) return false
  const expected = new Map<string | number | null, string>([["token_hash", "token-hash"], ["type", "otp-type"]])
  return node.properties.length === expected.size && node.properties.every((property) => property.type === "Property" && expected.get(plainKey(property)) === origin(property.value))
    && new Set(node.properties.map(plainKey)).size === expected.size
}

/** Non-call expressions must preserve the callback's narrow set of values and effects. */
const validExpression = (node: Node, env: Env, origin: Origin): boolean => {
  if (node.type === "MemberExpression") return Boolean(origin(node))
  if (node.type === "ObjectExpression") return isRedirectOptions(node, origin) || isOtpArguments(node, origin)
  if (node.type === "VariableDeclarator" && node.id.type === "ObjectPattern") return env.sourceCode.getDeclaredVariables(node).every((variable) => origin(variable.identifiers[0]))
  if (node.type === "NewExpression") return isGlobal(env.sourceCode, node.callee, "URL") && node.arguments.length >= 1 && node.arguments.length <= 2 && node.arguments.every((argument) => TEXT.has(origin(argument)))
  if (node.type === "ReturnStatement") return insideHandler(node, env.handler) && origin(node.argument) === "redirect-result"
  if (node === env.handler && env.handler.body.type !== "BlockStatement") return origin(env.handler.body) === "redirect-result"
  return true
}

/** Validate arguments to each permitted operation. */
const validCall = (node: TSESTree.CallExpression, kind: Kind, env: Env, origin: Origin): boolean => {
  if (!insideHandler(node, env.handler) || !CALLS.has(kind) || node.arguments.some((argument) => argument.type === "SpreadElement")) return false
  if (kind === "exchange") return isAwaited(node, env.handler) && node.arguments.length === 1 && origin(node.arguments[0]) === "code"
  if (kind === "verify-otp") return isAwaited(node, env.handler) && node.arguments.length === 1 && node.arguments[0]?.type === "ObjectExpression"
  if (kind === "pure") return node.arguments.length <= 4 && node.arguments.every((argument) => PURE_ARGUMENTS.has(origin(argument)))
  if (kind === "redirect") return node.arguments.length >= 1 && node.arguments.length <= 2 && REDIRECT_TARGETS.includes(origin(node.arguments[0]))
  if (kind === "factory") return node.arguments.length <= 1 && node.arguments.every((argument) => origin(argument) === "request")
  return node.arguments.length === 1 && TEXT.has(origin(node.arguments[0]))
}

/** Syntactic forms that add work beyond the one handler are refused outright. */
const forbiddenNode = (node: Node, handler: Node): boolean =>
  FORBIDDEN.has(node.type) || (FUNCTIONS.has(node.type) && node !== handler) || (node.type === "UnaryExpression" && node.operator === "delete")

/** Walk all runtime syntax, counting the single exchange and permitted redirects. */
const validOperations = (program: TSESTree.Program, env: Env): boolean => {
  const origin = originOf(env)
  const counts = new Map<Kind, number>()
  let valid = true
  walk(env.sourceCode, program, (node) => {
    if (!valid) return false
    valid = !forbiddenNode(node, env.handler) && validExpression(node, env, origin)
    if (!valid || node.type !== "CallExpression") return undefined
    const kind = origin(node.callee)
    valid = validCall(node, kind, env, origin)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
    return undefined
  })
  const exchanges = (counts.get("exchange") ?? 0) + (counts.get("verify-otp") ?? 0)
  return valid && exchanges >= 1 && (counts.get("exchange") ?? 0) <= 1 && (counts.get("verify-otp") ?? 0) <= 1 && (counts.get("factory") ?? 0) <= 1 && (counts.get("redirect") ?? 0) > 0
}

/** The callback's request, imports and operations must all have known owners. */
const callbackVerdict = (context: AnyContext, program: TSESTree.Program): boolean => {
  const sourceCode = context.sourceCode ?? context.getSourceCode()
  const handler = handlerOf(program, sourceCode)
  if (!handler) return false
  const imports = importsOf(context, program, sourceCode)
  return imports !== null && validOperations(program, { sourceCode, handler, imports })
}

/** A callback stays a PKCE exchange and redirect, with every side effect owned by the auth helper. */
export const callbackShape = defineRule({
  meta: {
    type: "problem",
    docs: { description: "R287 FE_CALLBACK_SHAPE: the Supabase callback reads the PKCE code or the email-link token_hash and type, exchanges it through modules/auth (exchangeAuthCode or verifyOtp), and redirects only." },
    schema: [],
    messages: {
      shape: "FE_CALLBACK_SHAPE: the auth callback must export an async GET that reads the query code (or the email-link token_hash and type), awaits one exchangeAuthCode(code) from modules/auth/server or auth.exchangeCodeForSession(code) and, for an email link, one verifyOtp({ token_hash, type }) built from exactly those two query values, may call pure text helpers of modules/routes or modules/auth (no I/O, no await) to compute the target and validate next, and redirects with NextResponse.redirect or next/navigation redirect. Create the client in modules/auth; keep data access, cookie writes, other calls and additional HTTP handlers outside the callback.",
    },
  },
  create(context) {
    if (!inSlot(context, "fe.route.callback")) return {}
    return {
      "Program:exit"(program: TSESTree.Program) {
        if (!callbackVerdict(context, program)) context.report({ node: program, messageId: "shape" })
      },
    }
  },
})

/** The rule R287 contributes to the front-end plugin. */
export const rules: Rules = { "callback-shape": callbackShape }

/** Every callback shape violation is an error. */
export const recommended: Recommended = { "starci-fe/callback-shape": "error" }
