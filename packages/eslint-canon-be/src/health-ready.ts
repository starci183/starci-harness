/** R262: API health routes are wired and readiness checks a required dependency under a failing, bounded timeout. */
import fs from "node:fs"
import path from "node:path"
import tsParser from "@typescript-eslint/parser"
import type { TSESTree } from "@typescript-eslint/utils"
import { appRoleOf } from "./lib/app-roles.ts"
import { hfsOf } from "./lib/hfs.ts"
import { decoratorName, keyName, paramParts, staticText, walk } from "./lib/ast.ts"
import { decoratorArguments } from "./lib/import-source.ts"
import { isNode, type Node, type Recommended, type RuleModule, type Rules } from "./lib/rule.ts"

/** A class declaration that carries its name (every class `classesOf` collects). */
type NamedClass = TSESTree.ClassDeclaration & { readonly id: TSESTree.Identifier }

/** A declaration a name resolves to across the local import closure. */
type Declared = NamedClass | TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeAliasDeclaration | TSESTree.VariableDeclarator | TSESTree.FunctionDeclaration

/** A resolved declaration with the program and file it sits in. */
interface Found {
    readonly controller: Declared
    readonly program: TSESTree.Program
    readonly filename: string
}

/** A resolved class declaration with the program and file it sits in. */
interface ClassFound extends Found {
    readonly controller: NamedClass
}

/** Where a lookup starts: a program, its file and the repository root. */
interface Location {
    readonly program: TSESTree.Program
    readonly filename: string
    readonly root: string
}

/** A lookup that starts inside a class. */
interface Source extends Location {
    readonly controller: NamedClass
}

/** The injected members of a class: the member name and the name of its declared type. */
type Injected = ReadonlyMap<string | null, string | null>

/** A call on an injected member: the member, the method it calls and the member's declared type. */
interface InjectedCall {
    readonly name: string | null
    readonly method: string | null
    readonly type: string | null | undefined
}

/** The exported names a file is followed for (`undefined` follows every export). */
type Wanted = ReadonlyArray<string | null> | undefined

/** A file of the import closure and the names it is followed for. */
interface Target {
    readonly filename: string
    readonly wanted: Wanted
}

type Wrapper = TSESTree.TSAsExpression | TSESTree.TSNonNullExpression | TSESTree.ChainExpression | TSESTree.TSSatisfiesExpression

const WIRING_FIELDS: ReadonlyArray<string | null> = ["imports", "controllers"]

const isWrapper = (node: Node | null | undefined): node is Wrapper =>
    node?.type === "TSAsExpression" || node?.type === "TSNonNullExpression" || node?.type === "ChainExpression" || node?.type === "TSSatisfiesExpression"
const isNamedClass = (node: Node): node is NamedClass => node.type === "ClassDeclaration" && node.id !== null
const isClassFound = (found: Found | null): found is ClassFound => found?.controller.type === "ClassDeclaration"
const isObjectExpression = (node: Node): node is TSESTree.ObjectExpression => node.type === "ObjectExpression"

/** `node.name` when it is a string (an identifier's name), else undefined. */
const nameOf = (node: Node | null | undefined): string | undefined => {
    const name: unknown = node && "name" in node ? node.name : undefined
    return typeof name === "string" ? name : undefined
}
/** `node.body` of any node, else undefined. */
const bodyOf = (node: Node | null | undefined) => (node && "body" in node ? node.body : undefined)
/** `node.typeAnnotation` of any node, else undefined. */
const annotationOf = (node: Node | null | undefined): Node | null | undefined => (node && "typeAnnotation" in node ? node.typeAnnotation : undefined)
/** `node.returnType` of any node, else undefined. */
const returnTypeOf = (node: Node | null | undefined): Node | undefined => (node && "returnType" in node ? node.returnType : undefined)
/** `node.value` of any node when it is a node, else undefined. */
const valueNodeOf = (node: Node | null | undefined): Node | undefined => {
    const value: unknown = node && "value" in node ? node.value : undefined
    return isNode(value) ? value : undefined
}
/** `node.params` of any node, else undefined. */
const paramsOf = (node: Node | null | undefined): readonly Node[] | undefined => (node && "params" in node ? node.params : undefined)
/** The key of an object literal entry (a spread has none). */
const propertyKey = (entry: TSESTree.ObjectLiteralElement): Node | undefined => (entry.type === "Property" ? entry.key : undefined)
/** The value of the object literal entry keyed `name`. */
const propertyValue = (object: TSESTree.ObjectExpression, name: string): Node | undefined => {
    const found = object.properties.find((entry) => keyName(propertyKey(entry)) === name)
    return found?.type === "Property" ? found.value : undefined
}
/** The name an import clause takes from its module (`undefined` for a default or namespace import). */
const importedNode = (specifier: TSESTree.ImportClause): Node | undefined => (specifier.type === "ImportSpecifier" ? specifier.imported : undefined)

const unwrap = (node: Node | null | undefined): Node | null | undefined => {
    while (isWrapper(node)) node = node.expression
    return node
}
const memberName = (node: TSESTree.MemberExpression | null | undefined): string | null => node?.computed ? staticText(node.property) : keyName(node?.property)
const typeName = (node: TSESTree.BindingName | TSESTree.RestElement): string | null => {
    const annotation = node.typeAnnotation?.typeAnnotation
    return (annotation?.type === "TSTypeReference" ? nameOf(annotation.typeName) : undefined) ?? null
}
const methodsOf = (node: NamedClass): TSESTree.MethodDefinition[] =>
    node.body.body.filter((entry): entry is TSESTree.MethodDefinition => entry.type === "MethodDefinition")
const classesOf = (program: Node | null | undefined): Map<string, NamedClass> => {
    const classes = new Map<string, NamedClass>()
    walk(program, (node) => { if (isNamedClass(node)) classes.set(node.id.name, node) })
    return classes
}
const bindingsOf = (program: Node): Map<string, Node> => {
    const bindings = new Map<string, Node>()
    walk(program, (node) => { if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) bindings.set(node.id.name, node.init) })
    return bindings
}

/** Expand local constants when proving a race: a timeout promise or duration may be held in a const. */
function expandedNodes(node: Node | null | undefined, bindings: ReadonlyMap<string, Node>, seen: ReadonlySet<string> = new Set()): Node[] {
    const nodes: Node[] = []
    walk(node, (child) => {
        nodes.push(child)
        if (child.type !== "Identifier" || seen.has(child.name) || !bindings.has(child.name)) return
        const next = new Set(seen).add(child.name)
        nodes.push(...expandedNodes(bindings.get(child.name), bindings, next))
    })
    return nodes
}

function sourcePath(source: string, filename: string, root: string): string | null {
    let base: string | null = null
    if (source.startsWith(".")) base = path.resolve(path.dirname(filename), source)
    if (source.startsWith("@modules/")) base = path.join(root, "src/modules", source.slice(9))
    if (source.startsWith("@features/")) base = path.join(root, "src/features", source.slice(10))
    if (!base || path.relative(root, base).startsWith("..")) return null
    return [base, `${base}.ts`, path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null
}

function readProgram(filename: string): TSESTree.Program | null {
    try { return tsParser.parse(fs.readFileSync(filename, "utf8"), { sourceType: "module", ecmaVersion: "latest" }) } catch { return null }
}

const routesOf = (controller: NamedClass): { route: string; method: TSESTree.MethodDefinition }[] => {
    const decorator = controller.decorators?.find((entry) => decoratorName(entry) === "Controller")
    if (!decorator) return []
    const prefix = staticText(decoratorArguments(decorator)[0]) ?? ""
    return methodsOf(controller).flatMap((method) => (method.decorators ?? []).filter((entry) => decoratorName(entry) === "Get").flatMap((entry) => {
        const arg = decoratorArguments(entry)[0]
        const paths = arg?.type === "ArrayExpression" ? arg.elements.map((element) => staticText(element)) : [staticText(arg) ?? ""]
        return paths.filter((route): route is string => route !== null).map((route) => ({ route: `/${prefix}/${route}`.replace(/\/+/g, "/").replace(/\/$/, ""), method }))
    }))
}

function injectedOf(controller: NamedClass): Injected {
    const constructor = methodsOf(controller).find((entry) => entry.kind === "constructor")
    return new Map((constructor?.value.params ?? []).flatMap((param): [string, string | null][] => {
        const { target } = paramParts(param)
        const name = nameOf(target)
        return name ? [[name, typeName(target)]] : []
    }))
}

/** `controller.body?.body` of a declaration (`[]` for one without a body). */
const membersOf = (controller: Declared): readonly Node[] =>
    (controller.type === "ClassDeclaration" || controller.type === "TSInterfaceDeclaration" || controller.type === "FunctionDeclaration" ? controller.body?.body : undefined) ?? []

/** `node.object` of a member expression, else undefined. */
const objectOf = (node: Node | null | undefined): Node | undefined => (node?.type === "MemberExpression" ? node.object : undefined)

const injectedCall = (node: Node, injected: Injected): InjectedCall | null => {
    if (node.type !== "CallExpression") return null
    const callee = unwrap(node.callee)
    if (callee?.type !== "MemberExpression") return null
    let owner = unwrap(objectOf(node.callee))
    while (owner?.type === "CallExpression" && unwrap(owner.callee)?.type === "MemberExpression") owner = unwrap(objectOf(owner.callee))
    while (owner?.type === "MemberExpression" && owner.object?.type !== "ThisExpression") owner = unwrap(owner.object)
    if (owner?.type !== "MemberExpression" || owner.object?.type !== "ThisExpression") return null
    const name = memberName(owner)
    if (!injected.has(name) || /(?:queryBus|commandBus|logger|liveness|liveProbe)/i.test(`${name} ${injected.get(name)}`)) return null
    return { name, method: memberName(callee), type: injected.get(name) }
}

function positiveDuration(node: Node | null | undefined, bindings: ReadonlyMap<string, Node>, seen: ReadonlySet<string> = new Set()): boolean {
    node = unwrap(node)
    if (node?.type === "Identifier" && bindings.has(node.name) && !seen.has(node.name)) return positiveDuration(bindings.get(node.name), bindings, new Set(seen).add(node.name))
    return node?.type === "Literal" && typeof node.value === "number" && Number.isFinite(node.value) && node.value > 0 && node.value <= 60000
}

function resolvedType(node: Node | null | undefined, source: Location, seen: ReadonlySet<string> = new Set()): Node | null | undefined {
    if (node?.type !== "TSTypeReference") return node
    const target = delegatedClass(nameOf(node.typeName), source.program, source.filename, source.root)
    if (target?.controller.type !== "TSTypeAliasDeclaration") return null
    const identity = `${target.filename}:${target.controller.id.name}`
    if (seen.has(identity)) return null
    return resolvedType(target.controller.typeAnnotation, { ...target, root: source.root }, new Set(seen).add(identity))
}

function timerMethod(call: Node, injected: Injected, source: Source): boolean {
    const dependency = injectedCall(call, injected)
    if (!dependency) return false
    const target = delegatedClass(dependency.type, source.program, source.filename, source.root)
    if (!target) return false
    const members = membersOf(target.controller)
    const method = members.find((entry) => keyName("key" in entry ? entry.key : undefined) === dependency.method)
    const params = paramsOf(method) ?? paramsOf(valueNodeOf(method)) ?? []
    const location = { ...target, root: source.root }
    const callback = resolvedType(annotationOf(annotationOf(params[0])), location)
    const returns = resolvedType(annotationOf(returnTypeOf(method)) ?? annotationOf(returnTypeOf(valueNodeOf(method))), location)
    const delay = resolvedType(annotationOf(annotationOf(params[1])), location)
    return callback?.type === "TSFunctionType" && callback.params.length === 0
        && callback.returnType?.typeAnnotation?.type === "TSVoidKeyword"
        && delay?.type === "TSNumberKeyword"
        && returns?.type === "TSFunctionType" && returns.params.length === 0
        && returns.returnType?.typeAnnotation?.type === "TSVoidKeyword"
        && timerBinding(dependency, target, source)
}

function timerToken(name: string | null, source: Source): Found | null {
    const constructor = methodsOf(source.controller).find((entry) => entry.kind === "constructor")
    const parameter = constructor?.value.params.map((param) => paramParts(param)).find((entry) => nameOf(entry.target) === name)
    for (const decorator of parameter?.decorators ?? []) {
        const target = delegatedClass(decoratorName(decorator), source.program, source.filename, source.root)
        if (!target) continue
        const init = "init" in target.controller ? target.controller.init : undefined
        const body = bodyOf(init) ?? bodyOf(target.controller)
        const token = isNode(body) && body.type === "CallExpression" && nameOf(body.arguments[0])
        const resolved = token && delegatedClass(token, target.program, target.filename, source.root)
        if (resolved) return resolved
    }
    return null
}

function timerImplementation(target: Found, methodName: string | null, contract: Found, root: string): boolean {
    const controller = target.controller
    if (controller.type !== "ClassDeclaration") return false
    const matches = controller.implements?.some((entry) => {
        const implemented = delegatedClass(nameOf(entry.expression), target.program, target.filename, root)
        return implemented && sameClass(implemented, contract)
    })
    if (!matches) return false
    const method = methodsOf(controller).find((entry) => keyName(entry.key) === methodName)
    if (!method?.value.body) return false
    const [callback, delay] = method.value.params.map((entry) => nameOf(paramParts(entry).target))
    const statements = method.value.body.body
    const declarations = statements.flatMap((entry) => entry.type === "VariableDeclaration" ? entry.declarations : [])
    const scheduled = declarations.find((entry) => entry.init?.type === "CallExpression" && nameOf(entry.init.callee) === "setTimeout"
        && nameOf(entry.init.arguments[0]) === callback && nameOf(entry.init.arguments[1]) === delay)
    if (!scheduled) return false
    return statements.some((entry) => entry.type === "ReturnStatement" && entry.argument?.type === "ArrowFunctionExpression"
        && entry.argument.body?.type === "CallExpression" && nameOf(entry.argument.body.callee) === "clearTimeout"
        && nameOf(entry.argument.body.arguments[0]) === nameOf(scheduled.id))
}

function providedTimer(module: NamedClass, token: Found, dependency: InjectedCall, contract: Found, source: Location): boolean {
    for (const object of moduleObjects(module)) {
        const providers = propertyValue(object, "providers")
        for (const node of expandedNodes(providers, bindingsOf(source.program)).filter(isObjectExpression)) {
            const name = nameOf(propertyValue(node, "provide"))
            const provided = name && delegatedClass(name, source.program, source.filename, source.root)
            if (!provided || !sameClass(provided, token)) continue
            const implementation = nameOf(propertyValue(node, "useClass"))
            const target = implementation && delegatedClass(implementation, source.program, source.filename, source.root)
            if (target && target.controller.type === "ClassDeclaration" && timerImplementation(target, dependency.method, contract, source.root)) return true
        }
    }
    return false
}

function timerBinding(dependency: InjectedCall, contract: Found, source: Source): boolean {
    const token = timerToken(dependency.name, source)
    if (!token) return false
    const directory = path.dirname(contract.filename)
    for (const entry of fs.readdirSync(directory).filter((name) => name.endsWith(".module.ts"))) {
        const filename = path.join(directory, entry)
        const program = readProgram(filename)
        if (!program) continue
        const location = { program, filename, root: source.root }
        if ([...classesOf(program).values()].some((module) => providedTimer(module, token, dependency, contract, location))) return true
    }
    return false
}

function rejectingTimeout(nodes: readonly Node[], bindings: ReadonlyMap<string, Node>, injected: Injected, source: Source): boolean {
    return nodes.some((node) => {
        if (node.type !== "CallExpression" || !positiveDuration(node.arguments[1], bindings)) return false
        const native = node.callee.type === "Identifier" && node.callee.name === "setTimeout"
        if (!native && !timerMethod(node, injected, source)) return false
        return expandedNodes(node.arguments[0], bindings).some((entry) => entry.type === "CallExpression" && entry.callee.type === "Identifier" && entry.callee.name === "reject")
    })
}

function parentsOf(body: Node | null | undefined): Map<Node, Node> {
    const parents = new Map<Node, Node>()
    walk(body, (node) => {
        const entries: [string, unknown][] = Object.entries(node)
        for (const [key, value] of entries) {
            if (["parent", "loc", "range", "tokens", "comments"].includes(key)) continue
            const children: unknown[] = Array.isArray(value) ? value : [value]
            for (const child of children) if (isNode(child)) parents.set(child, node)
        }
    })
    return parents
}

function consumedCall(node: Node, body: Node | null | undefined, bindings: ReadonlyMap<string, Node>): boolean {
    const parents = parentsOf(body)
    const nodes: Node[] = []
    walk(body, (entry) => nodes.push(entry))
    return nodes.some((entry) => {
        if (entry.type !== "AwaitExpression" && entry.type !== "ReturnStatement") return false
        const parentType = parents.get(entry)?.type
        return expandedNodes(entry.argument, bindings).includes(node)
            && !expandedNodes(entry.argument, bindings).some((child) => child.type === "UnaryExpression" && child.operator === "void")
            && parentType !== "ArrowFunctionExpression" && parentType !== "FunctionExpression"
    })
}

/** Whether a node is `Promise.reject(...)`. */
const rejected = (node: unknown): boolean => isNode(node) && node.type === "CallExpression" && node.callee?.type === "MemberExpression"
    && nameOf(node.callee.object) === "Promise" && memberName(node.callee) === "reject"

/** Whether a block throws or returns a rejection (undefined when the node holds no statement list). */
const fails = (block: unknown): boolean | undefined => {
    const statements = isNode(block) ? bodyOf(block) : undefined
    if (!Array.isArray(statements)) return undefined
    const list: readonly Node[] = statements
    return list.some((statement) => statement.type === "ThrowStatement" || statement.type === "ReturnStatement" && rejected(statement.argument))
}

/** A required dependency failure must still make the readiness promise fail. */
function propagatesFailures(body: Node | null | undefined): boolean {
    const catches: TSESTree.CatchClause[] = []
    const promiseCatches: (Node | undefined)[] = []
    walk(body, (node) => { if (node.type === "CatchClause") catches.push(node) })
    walk(body, (node) => { if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && memberName(node.callee) === "catch") promiseCatches.push(node.arguments[0]) })
    return catches.every((node) => node.body.body.some((statement) => statement.type === "ThrowStatement"
        || statement.type === "ReturnStatement" && statement.argument?.type === "CallExpression" && statement.argument.callee?.type === "MemberExpression"
            && nameOf(statement.argument.callee.object) === "Promise" && memberName(statement.argument.callee) === "reject"))
        && promiseCatches.every((callback) => callback && (rejected(bodyOf(callback)) || fails(bodyOf(callback))))
}

function boundedDependency(method: TSESTree.MethodDefinition, injected: Injected, bindings: ReadonlyMap<string, Node>, source: Source): boolean {
    if (!propagatesFailures(method.value.body)) return false
    const nodes = expandedNodes(method.value.body, bindings)
    return nodes.some((node) => {
        if (node.type !== "CallExpression" || !consumedCall(node, method.value.body, bindings)) return false
        const callee = unwrap(node.callee)
        if (callee?.type !== "MemberExpression") return false
        if (injectedCall(node, injected)) return requiredCall(node, injected, source) && expandedNodes(node, bindings).some((entry) => entry.type === "CallExpression"
            && entry.callee.type === "MemberExpression" && nameOf(entry.callee.object) === "AbortSignal" && memberName(entry.callee) === "timeout" && positiveDuration(entry.arguments[0], bindings))
        if (nameOf(callee.object) !== "Promise" || memberName(callee) !== "race") return false
        const racers = expandedNodes(node.arguments[0], bindings)
        return racers.some((entry) => requiredCall(entry, injected, source)) && rejectingTimeout(racers, bindings, injected, source)
    })
}

function classInSource(name: string | null | undefined, program: TSESTree.Program, filename: string, root: string, seen: ReadonlySet<string> = new Set()): Found | null {
    const identity = `${filename}:${name}`
    if (seen.has(identity)) return null
    const next = new Set(seen).add(identity)
    let local: Declared | undefined = typeof name === "string" ? classesOf(program).get(name) : undefined
    walk(program, (node) => {
        if ((node.type === "TSInterfaceDeclaration" || node.type === "TSTypeAliasDeclaration" || node.type === "VariableDeclarator" || node.type === "FunctionDeclaration") && nameOf(node.id) === name) local = node
    })
    if (local) return { controller: local, program, filename }
    for (const entry of program.body) {
        if (entry.type !== "ExportNamedDeclaration" && entry.type !== "ExportAllDeclaration") continue
        if (!entry.source) continue
        const specifier = entry.type === "ExportNamedDeclaration" ? entry.specifiers?.find((node) => keyName(node.exported) === name) : undefined
        if (entry.type !== "ExportAllDeclaration" && !specifier) continue
        const target = sourcePath(entry.source.value, filename, root)
        const imported = target ? readProgram(target) : null
        const controller = imported && target ? classInSource(keyName(specifier?.local) ?? name, imported, target, root, next) : null
        if (controller) return controller
    }
    return null
}

function delegatedClass(name: string | null | undefined, program: TSESTree.Program, filename: string, root: string): Found | null {
    const local = classInSource(name, program, filename, root)
    if (local) return local
    for (const entry of program.body) {
        if (entry.type !== "ImportDeclaration") continue
        const specifier = entry.specifiers.find((node) => node.local.name === name)
        if (!specifier) continue
        const target = sourcePath(entry.source.value, filename, root)
        const imported = target ? readProgram(target) : null
        const controller = imported && target ? classInSource(nameOf(importedNode(specifier)) ?? name, imported, target, root) : null
        if (controller) return controller
    }
    return null
}

function consumedDependencies(method: TSESTree.MethodDefinition, injected: Injected, source: Source): { node: Node; call: InjectedCall }[] {
    const bindings = bindingsOf(source.program)
    return expandedNodes(method.value.body, bindings).filter((node) => consumedCall(node, method.value.body, bindings))
        .flatMap((node) => {
            const call = injectedCall(node, injected)
            return call ? [{ node, call }] : []
        })
}

function requiredCall(node: Node, injected: Injected, source: Source, visited: ReadonlySet<string> = new Set()): boolean {
    const call = injectedCall(node, injected)
    if (!call || timerMethod(node, injected, source)) return false
    const target = delegatedClass(call.type, source.program, source.filename, source.root)
    if (!target) return true
    if (!isClassFound(target)) return false
    const method = methodsOf(target.controller).find((entry) => keyName(entry.key) === call.method)
    const identity = `${target.filename}:${call.type}:${call.method}`
    if (!method || visited.has(identity) || !propagatesFailures(method.value.body)) return false
    const next = new Set(visited).add(identity)
    const location: Source = { ...target, root: source.root }
    const dependencies = injectedOf(target.controller)
    return consumedDependencies(method, dependencies, location).some((entry) => requiredCall(entry.node, dependencies, location, next))
}

function importedAs(program: TSESTree.Program, name: string | null | undefined, imported: string, module: string): boolean {
    return program.body.some((entry) => entry.type === "ImportDeclaration" && entry.source.value === module
        && entry.specifiers.some((specifier) => specifier.local.name === name && keyName(importedNode(specifier)) === imported))
}

function moduleObjects(controller: NamedClass): TSESTree.ObjectExpression[] {
    const objects: TSESTree.ObjectExpression[] = []
    const decorator = controller.decorators?.find((entry) => decoratorName(entry) === "Module")
    const declared = decoratorArguments(decorator)[0]
    if (declared?.type === "ObjectExpression") objects.push(declared)
    for (const method of methodsOf(controller).filter((entry) => entry.static)) walk(method.value.body, (node) => {
        if (node.type === "ReturnStatement" && node.argument?.type === "ObjectExpression") objects.push(node.argument)
    })
    return objects
}

function moduleReferences(controller: NamedClass, field: string, source: Location): ClassFound[] {
    const names = new Set<string>()
    for (const object of moduleObjects(controller)) {
        const value = propertyValue(object, field)
        for (const node of expandedNodes(value, bindingsOf(source.program))) if (node.type === "Identifier") names.add(node.name)
    }
    return [...names].map((name) => delegatedClass(name, source.program, source.filename, source.root))
        .filter(isClassFound)
}

const sameClass = (left: Pick<Found, "filename" | "controller">, right: Pick<Found, "filename" | "controller">): boolean =>
    left.filename === right.filename && nameOf(left.controller.id) === nameOf(right.controller.id)

function routeModules(controller: NamedClass, source: Source): Source[] {
    const roots: Source[] = []
    let directory = path.dirname(source.filename)
    while (!path.relative(source.root, directory).startsWith("..")) {
        for (const entry of fs.readdirSync(directory).filter((name) => name.endsWith(".module.ts"))) {
            const filename = path.join(directory, entry)
            const program = readProgram(filename)
            if (!program) continue
            const location = { program, filename, root: source.root }
            for (const module of classesOf(program).values()) {
                const target = { controller, filename: source.filename }
                if (moduleReferences(module, "controllers", location).some((candidate) => sameClass(candidate, target))) roots.push({ ...location, controller: module })
            }
        }
        if (directory === source.root) break
        directory = path.dirname(directory)
    }
    return roots
}

function registeredProviders(controller: NamedClass, source: Source): ClassFound[] {
    const pending: ClassFound[] = routeModules(controller, source)
    const visited = new Set<string>()
    const providers: ClassFound[] = []
    while (pending.length) {
        const module = pending.pop()
        if (!module) break
        const identity = `${module.filename}:${module.controller.id.name}`
        if (visited.has(identity)) continue
        visited.add(identity)
        providers.push(...moduleReferences(module.controller, "providers", { ...module, root: source.root }))
        pending.push(...moduleReferences(module.controller, "imports", { ...module, root: source.root }))
    }
    return providers
}

function thisCall(node: Node, name: string): boolean {
    return node.type === "CallExpression" && node.callee.type === "MemberExpression"
        && node.callee.object.type === "ThisExpression" && memberName(node.callee) === name
}

function handlerEntry(target: ClassFound, root: string): TSESTree.MethodDefinition | false | null | undefined {
    const own = methodsOf(target.controller)
    const execute = own.find((entry) => keyName(entry.key) === "execute")
    if (execute) return execute
    const base = target.controller.superClass
    const parent = base?.type === "Identifier" ? delegatedClass(base.name, target.program, target.filename, root) : null
    if (!isClassFound(parent)) return null
    const inherited = methodsOf(parent.controller).find((entry) => keyName(entry.key) === "execute")
    if (!inherited || !propagatesFailures(inherited.value.body)) return null
    const bindings = bindingsOf(parent.program)
    const consumesProcess = expandedNodes(inherited.value.body, bindings).some((node) => thisCall(node, "process") && consumedCall(node, inherited.value.body, bindings))
    return consumesProcess && own.find((entry) => keyName(entry.key) === "process")
}

function handlerOf(target: ClassFound, query: Found, root: string): boolean | undefined {
    return target.controller.decorators?.some((entry) => {
        const expression = entry.expression
        if (!importedAs(target.program, "callee" in expression ? nameOf(expression.callee) : undefined, "QueryHandler", "@nestjs/cqrs")) return false
        const name = nameOf("arguments" in expression ? expression.arguments[0] : undefined)
        const handled = name && delegatedClass(name, target.program, target.filename, root)
        return handled && sameClass(handled, query)
    })
}

function dispatchedQueries(controller: NamedClass, method: TSESTree.MethodDefinition, source: Source): Found[] {
    const injected = injectedOf(controller)
    const bindings = bindingsOf(source.program)
    return expandedNodes(method.value.body, bindings).flatMap((node) => {
        if (node.type !== "CallExpression") return []
        const callee = unwrap(node.callee)
        if (callee?.type !== "MemberExpression" || memberName(callee) !== "execute") return []
        const owner = callee.object
        if (owner.type !== "MemberExpression" || owner.object.type !== "ThisExpression") return []
        if (!importedAs(source.program, injected.get(memberName(owner)), "QueryBus", "@nestjs/cqrs")) return []
        if (!consumedCall(node, method.value.body, bindings)) return []
        const message = unwrap(node.arguments[0])
        const target = message?.type === "NewExpression" && delegatedClass(nameOf(message.callee), source.program, source.filename, source.root)
        return target ? [target] : []
    })
}

function busReadiness(controller: NamedClass, method: TSESTree.MethodDefinition, source: Source, visited: ReadonlySet<string>): boolean {
    const queries = dispatchedQueries(controller, method, source)
    if (!queries.length) return false
    return registeredProviders(controller, source).some((target) => {
        if (!queries.some((query) => handlerOf(target, query, source.root))) return false
        const entry = handlerEntry(target, source.root)
        return entry && realReadiness(target.controller, entry, target.program, target.filename, source.root, visited)
    })
}

function realReadiness(controller: NamedClass, method: TSESTree.MethodDefinition, program: TSESTree.Program, filename: string, root: string, visited: ReadonlySet<string> = new Set()): boolean {
    const identity = `${filename}:${controller.id.name}:${keyName(method.key)}`
    if (visited.has(identity)) return false
    const next = new Set(visited).add(identity)
    const injected = injectedOf(controller)
    const source = { program, filename, root, controller }
    if (boundedDependency(method, injected, bindingsOf(program), source)) return true
    if (!propagatesFailures(method.value.body)) return false
    if (busReadiness(controller, method, source, next)) return true
    return consumedDependencies(method, injected, source).some(({ call }) => {
        const target = call.type ? delegatedClass(call.type, program, filename, root) : null
        if (!isClassFound(target)) return false
        const delegated = methodsOf(target.controller).find((entry) => keyName(entry.key) === call.method)
        return delegated && realReadiness(target.controller, delegated, target.program, target.filename, root, next)
    })
}

/** Readiness delegation is proved through the injected service; the HTTP controller remains a thin door. */
export const readyReal: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "BE_READY_REAL: readiness probes an injected required dependency and fails under a bounded timeout." },
        schema: [],
        messages: { real: "BE_READY_REAL: this readiness route must probe an injected required dependency with a failing, bounded timeout; a liveness query or an unconditional success is not readiness." },
    },
    create(context) {
        const hfs = hfsOf(context)
        const filename = context.filename || context.getFilename()
        if (hfs.slotOf(filename) !== "be.transport.http") return {}
        return {
            "Program:exit"(program) {
                for (const controller of classesOf(program).values()) for (const { route, method } of routesOf(controller)) {
                    if (!/(?:\/health\/ready|\/readyz)$/.test(route)) continue
                    if (!realReadiness(controller, method, program, filename, hfs.repoRoot)) context.report({ node: method, messageId: "real" })
                }
            },
        }
    },
}

/** Follow the app's local import closure; unused imports do not install a health transport. */
function wiringNames(program: TSESTree.Program, wanted: Wanted): Set<string | null> {
    const used = new Set<string | null>()
    const bindings = bindingsOf(program)
    const collect = (node: Node | null | undefined): void => { for (const entry of expandedNodes(node, bindings)) if (entry.type === "Identifier") used.add(entry.name) }
    const moduleObject = (node: Node | null | undefined): void => {
        if (node?.type !== "ObjectExpression") return
        for (const property of node.properties) if (WIRING_FIELDS.includes(keyName(propertyKey(property)))) collect(property.type === "Property" ? property.value : undefined)
    }
    for (const controller of classesOf(program).values()) {
        if (wanted?.includes(controller.id.name) === false) continue
        const module = controller.decorators?.find((entry) => decoratorName(entry) === "Module")
        moduleObject(decoratorArguments(module)[0])
        for (const method of methodsOf(controller).filter((entry) => entry.static)) walk(method.value.body, (node) => {
            if (node.type === "ReturnStatement" && node.argument?.type === "ObjectExpression" && node.argument.properties.some((entry) => keyName(propertyKey(entry)) === "module")) moduleObject(node.argument)
        })
    }
    walk(program, (node) => {
        if (node.type === "VariableDeclarator") {
            const id = nameOf(node.id)
            if (id !== undefined && wanted?.includes(id)) collect(node.init)
        }
        if (node.type === "FunctionDeclaration") {
            const id = nameOf(node.id)
            if (id !== undefined && wanted?.includes(id)) collect(node.body)
        }
        if (node.type === "ExportNamedDeclaration" && !node.source) for (const specifier of node.specifiers) if (!wanted || wanted.includes(keyName(specifier.exported))) used.add(keyName(specifier.local))
    })
    return used
}

function importedTargets(program: TSESTree.Program, filename: string, root: string, used: ReadonlySet<string | null>): Target[] {
    const targets: Target[] = []
    for (const entry of program.body) {
        if (entry.type !== "ImportDeclaration") continue
        if (entry.importKind === "type" || !entry.specifiers.some((specifier) => used.has(specifier.local.name))) continue
        const target = sourcePath(entry.source.value, filename, root)
        const imported = entry.specifiers.filter((specifier) => used.has(specifier.local.name)).map((specifier) => keyName(importedNode(specifier)) ?? specifier.local.name)
        if (target) targets.push({ filename: target, wanted: imported })
    }
    return targets
}

function exportedTargets(program: TSESTree.Program, filename: string, root: string, wanted: Wanted): Target[] {
    const targets: Target[] = []
    for (const entry of program.body) {
        if (entry.type !== "ExportNamedDeclaration" && entry.type !== "ExportAllDeclaration") continue
        if (!entry.source || entry.exportKind === "type") continue
        const target = sourcePath(entry.source.value, filename, root)
        const exported = entry.type === "ExportAllDeclaration" ? wanted : entry.specifiers.filter((specifier) => !wanted || wanted.includes(keyName(specifier.exported))).map((specifier) => keyName(specifier.local))
        if (target && (!exported || exported.length)) targets.push({ filename: target, wanted: exported })
    }
    return targets
}

function usedRoutes(program: TSESTree.Program, wanted: Wanted, used: ReadonlySet<string | null>): string[] {
    return [...classesOf(program).values()].filter((controller) => !wanted || wanted.includes(controller.id.name) || used.has(controller.id.name))
        .flatMap((controller) => routesOf(controller).map((entry) => entry.route))
}

function appRoutes(filename: string, root: string): Set<string> {
    const routes = new Set<string>()
    const pending: Target[] = [{ filename, wanted: ["AppModule"] }]
    const visited = new Set<string>()
    while (pending.length) {
        const next = pending.pop()
        if (!next) break
        const { filename: current, wanted } = next
        const identity = `${current}:${wanted?.join(",") ?? "*"}`
        if (visited.has(identity)) continue
        visited.add(identity)
        const program = readProgram(current)
        if (!program) continue
        const used = wiringNames(program, wanted)
        for (const route of usedRoutes(program, wanted, used)) routes.add(route)
        pending.push(...importedTargets(program, current, root, used), ...exportedTargets(program, current, root, wanted))
    }
    return routes
}

/** Each declared API composition exposes both process-local liveness and required-dependency readiness. */
export const healthSignals: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "BE_HEALTH_SIGNALS: every API app exposes /health/live and /health/ready." },
        schema: [],
        messages: { signals: "BE_HEALTH_SIGNALS: API {{app}} must register both /health/live and /health/ready in its module composition (missing {{missing}})." },
    },
    create(context) {
        const hfs = hfsOf(context)
        const filename = context.filename || context.getFilename()
        if (appRoleOf(hfs, filename)?.entry !== "main.ts") return {}
        const app = hfs.apps.find((entry) => entry.name === hfs.classify(filename).bindings?.app)
        if (app?.kind !== "api") return {}
        return {
            "Program:exit"(node) {
                const routes = appRoutes(path.join(path.dirname(filename), "app.module.ts"), hfs.repoRoot)
                const missing = ["/health/live", "/health/ready"].filter((route) => !routes.has(route))
                if (missing.length) context.report({ node, messageId: "signals", data: { app: app.name, missing: missing.join(", ") } })
            },
        }
    },
}

export const rules = { "ready-real": readyReal, "health-signals": healthSignals } satisfies Rules
export const recommended: Recommended = { "starci-be/ready-real": "error", "starci-be/health-signals": "error" }
