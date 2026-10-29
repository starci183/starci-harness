/**
 * The rules that hold the composition files of a back-end app (catalog R245 `BE_APP_OPTIONS_COMPOSITION`, R265
 * `BE_COMPOSITION_UNTYPED` and R246
 * `BE_APP_COMPOSITION_BUDGET`, owner ruling 2026-10-14). An app's `src/` holds five roles, named by the entries of its `be.app.*` slot (`lib/app-roles.mjs`):
 * `main.ts`, `app.module.ts`, `<app>.env.ts`, `<app>.options.ts` and the composition groups `compose/<area>.ts`.
 *
 *   - `app-options-composition-free` (`BE_APP_OPTIONS_COMPOSITION`) keeps `<app>.env.ts` to typed, fail-fast environment
 *     parsing only and `<app>.options.ts` to options types and port bindings (provider maps such as `{ approvalGate: X }`): an array that lists Nest modules (a
 *     `*Module` class, a `X.register(...)`/`forRoot(...)`/`registerQueue(...)` call), queue registrations or scheduler entries
 *     (a `*SchedulerOf(...)`, `*Scheduler(...)` or `*Queue(...)` call), a spread of such a list, and an `imports`, `modules`,
 *     `schedulers` or `processors` array are refused. Those lists are composition: they live in `compose/<area>.ts`, one
 *     group per area, which `app.module.ts` spreads. The env role also refuses registration and scheduler calls outside arrays.
 *     `config-owner.mjs` keeps process environment access and owned `EnvSource` reads in `main.ts` or the matching env role;
 *     options files and composition groups receive the typed result of `read<App>Env(env: EnvSource)`.
 *   - `app-file-budget` (`BE_APP_COMPOSITION_BUDGET`) holds each composition file to the line budget its app slot names
 *     (`budget` of the slot, keyed by the same entry: `app.module.ts` 250, `<app>.env.ts` 150, `<app>.options.ts` 200, `compose/<area>.ts` 120,
 *     `main.ts` 80), counted in lines EXCLUDING import declarations (a multi-line import counts none of its lines): an import
 *     is the cost of naming a capability, not composition. The budget is absolute, not a ratchet: an app root that outgrows it moves
 *     an area into a new group.
 *
 * R265 resolves composition from types, including renamed constructors, factories, maps and scheduler tables. All
 * three rules ask the slot view which entry a file matches; none keeps a path of its own.
 */
import { lineCount } from "../runtime/scripts/lib/line-count.mjs"
import ts from "typescript"
import { APP_ENV_ROLE, APP_OPTIONS_ROLE, appRoleOf } from "./lib/app-roles.ts"
import { hfsOf } from "./lib/hfs.ts"
import { isOwnedBy } from "./lib/declared.ts"
import { keyName, staticText } from "./lib/ast.ts"
import { isDeclarationFile, normalizePath } from "./lib/path.ts"
import { childNode, moduleOf, originsOfType, packageOfExport, resolvedSymbol as resolveAlias, typed } from "./lib/types.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import type { Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"

/** Static factories that register a Nest module (a dynamic module), a queue or a flow producer. */
const REGISTRATION_CALLS: ReadonlySet<string | null> = new Set([
    "register",
    "registerAsync",
    "forRoot",
    "forRootAsync",
    "forFeature",
    "forFeatureAsync",
    "registerQueue",
    "registerQueueAsync",
    "registerFlowProducer",
])

/** Keys whose array value is a composition list whatever it holds. */
const COMPOSITION_KEYS = new Set(["imports", "modules", "schedulers", "processors"])

/** A name that is a Nest module class. */
const MODULE_NAME = /Module$/
/** A name that is a list of modules, queues, schedulers or processors (the operand of a spread). */
const LIST_NAME = /(?:Modules|Queues|Schedulers|Processors)$/
/** A call that builds a scheduler entry or a queue registration: `orderExpirySchedulerOf(...)`, `ordersQueue(...)`. */
const ENTRY_CALL = /(?:Scheduler|Queue)(?:Of)?$/

/** Type-only wrappers do not change whether an expression composes modules. */
const WRAPPERS: ReadonlySet<string> = new Set(["TSAsExpression", "TSTypeAssertion", "TSSatisfiesExpression", "TSNonNullExpression", "TSInstantiationExpression", "ChainExpression"])
/** A type-only wrapper node. */
type Wrapper = TSESTree.TSAsExpression | TSESTree.TSTypeAssertion | TSESTree.TSSatisfiesExpression | TSESTree.TSNonNullExpression | TSESTree.TSInstantiationExpression | TSESTree.ChainExpression
const isWrapper = (node: Node | null | undefined): node is Wrapper => node !== null && node !== undefined && WRAPPERS.has(node.type)
function unwrap(node: Node): Node
function unwrap(node: Node | null | undefined): Node | null | undefined
function unwrap(node: Node | null | undefined): Node | null | undefined {
    while (isWrapper(node)) node = node.expression
    return node
}

/** The known name of a member, including a static computed string. */
const memberName = (node: TSESTree.MemberExpression): string | null => node.computed ? staticText(node.property) : keyName(node.property)

/** The last name of an identifier or a statically named member expression, else null. */
const lastName = (node: Node | null | undefined): string | null => {
    node = unwrap(node)
    if (node?.type === "Identifier") return node.name
    if (node?.type === "MemberExpression") return memberName(node)
    return null
}

/** What an array element composes (`module`, `registration`, `scheduler`, `list`), or null when it is plain options data. */
type Composition = "module" | "registration" | "scheduler" | "list"
const compositionOf = (element: Node | null | undefined): Composition | null => {
    element = unwrap(element)
    if (!element) return null
    if (element.type === "SpreadElement") {
        const argument = unwrap(element.argument)
        const spread = argument?.type === "CallExpression" ? lastName(argument.callee) : lastName(argument)
        return spread !== null && (LIST_NAME.test(spread) || MODULE_NAME.test(spread)) ? "list" : null
    }
    if (element.type === "CallExpression") {
        const callee = unwrap(element.callee)
        if (callee.type === "MemberExpression" && REGISTRATION_CALLS.has(memberName(callee))) return "registration"
        const name = lastName(callee)
        return name !== null && ENTRY_CALL.test(name) ? "scheduler" : null
    }
    const name = lastName(element)
    return name !== null && MODULE_NAME.test(name) ? "module" : null
}

/** Env parsing and options bindings hold no module, queue or scheduler composition. */
export const appOptionsCompositionFree: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "`<app>.env.ts` holds environment parsing only and `<app>.options.ts` holds options types and port bindings; module, queue and scheduler composition lives in `compose/<area>.ts`." },
        schema: [],
        messages: {
            list: "`{{key}}` is a composition list in {{role}}. `<app>.env.ts` holds typed, fail-fast environment parsing only and `<app>.options.ts` holds options types and port bindings; move this list into `apps/<app>/src/compose/<area>.ts` (one group per area) and spread the group in `app.module.ts`.",
            element: "This array lists a {{what}} in {{role}}. `<app>.env.ts` holds environment parsing only and `<app>.options.ts` holds options types and port bindings; module lists, queue registrations and scheduler entries live in `apps/<app>/src/compose/<area>.ts`, which `app.module.ts` spreads.",
            call: "This {{what}} composes modules, queues or schedulers in `<app>.env.ts`. Keep typed, fail-fast environment parsing here and move composition into `apps/<app>/src/compose/<area>.ts`, which `app.module.ts` spreads.",
        },
    },
    create(context) {
        const filename = normalizePath(context.filename || context.getFilename())
        if (isDeclarationFile(filename)) return {}
        const role = appRoleOf(hfsOf(context), filename)?.entry
        if (role !== APP_OPTIONS_ROLE && role !== APP_ENV_ROLE) return {}
        const judged = new WeakSet<Node>()
        return {
            CallExpression(node) {
                if (role !== APP_ENV_ROLE) return
                let element: Node = node
                while (isWrapper(element.parent)) element = element.parent
                if (element.parent?.type === "ArrayExpression") return
                const what = compositionOf(node)
                if (what !== "registration" && what !== "scheduler") return
                context.report({ node, messageId: "call", data: { what: what === "registration" ? "registration call" : "scheduler or queue call" } })
            },
            Property(node) {
                const value = unwrap(node.value)
                if (value?.type !== "ArrayExpression") return
                const key = node.computed ? staticText(node.key) : keyName(node.key)
                if (key === null || !COMPOSITION_KEYS.has(key)) return
                judged.add(value)
                context.report({ node, messageId: "list", data: { key, role } })
            },
            "ArrayExpression:exit"(node) {
                if (judged.has(node)) return
                const what = node.elements.map(compositionOf).find((kind): kind is Composition => kind !== null)
                if (what === undefined) return
                const label = { module: "Nest module", registration: "module or queue registration", scheduler: "scheduler or queue entry", list: "spread of a module, queue or scheduler list" }[what]
                context.report({ node, messageId: "element", data: { what: label, role } })
            },
        }
    },
}

/** Whether a type is a reference to a generic type (it carries a `target`), the only kind `getTypeArguments` reads arguments from. */
const isTypeReference = (type: ts.Type): type is ts.TypeReference => "target" in type

/** Composition is a value's type, independent of the spelling of its class, factory or helper. */
const compositionTypes = (checker: ts.TypeChecker) => {
    const propertyType = (type: ts.Type, name: string): ts.Type | null => {
        const property = type.getProperty(name)
        const declaration = property?.valueDeclaration ?? property?.getDeclarations?.()?.[0]
        return property && declaration ? checker.getTypeOfSymbolAtLocation(property, declaration) : null
    }
    const constructor = (type: ts.Type | null | undefined): boolean => (type?.getConstructSignatures().length ?? 0) > 0
    const dynamicModule = (type: ts.Type): boolean => constructor(propertyType(type, "module"))
    const moduleConstructor = (type: ts.Type): boolean => {
        if (!constructor(type)) return false
        for (const declaration of type.getSymbol()?.getDeclarations?.() ?? []) {
            if (!ts.isClassDeclaration(declaration) && !ts.isClassExpression(declaration)) continue
            for (const decorator of ts.getDecorators(declaration) ?? []) {
                const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression
                const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression)
                const resolved = resolveAlias(checker, symbol)
                if (resolved?.name === "Module" && resolved.getDeclarations()?.some((origin) => moduleOf(origin, normalizePath(origin.getSourceFile().fileName)) === "@nestjs/common")) return true
            }
        }
        // A factory returning DynamicModule identifies a module even if it has no decorator or conventional name.
        return type.getProperties().some((property) => {
            const factory = propertyType(type, property.name)
            return factory?.getCallSignatures().some((signature) => dynamicModule(checker.getReturnTypeOfSignature(signature)))
        })
    }
    const arrayElement = (type: ts.Type): ts.Type | null | undefined => checker.isArrayType(type) || checker.isTupleType(type)
        ? checker.getIndexTypeOfType(type, ts.IndexKind.Number)
        : type.getSymbol()?.name === "ReadonlyArray" ? (isTypeReference(type) ? checker.getTypeArguments(type)[0] : undefined) : null
    const MAX_DEPTH = 12
    const contains = (type: ts.Type | null | undefined, constructors = false, seen = new Set<ts.Type>(), depth = 0): boolean => {
        // A library type graph (the application, an HTTP adapter) can be deep and cyclic through member types: a bounded walk never overflows the stack.
        if (depth > MAX_DEPTH) return false
        if (!type || seen.has(type) || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) return false
        seen.add(type)
        if (type.isUnionOrIntersection()) return type.types.some((part) => contains(part, constructors, new Set(seen), depth + 1))
        // Async bootstrap returns Promise<void>; walk its result rather than recursively instantiating .then/.catch.
        const awaited = checker.getAwaitedType(type)
        if (awaited && awaited !== type) return contains(awaited, constructors, seen, depth + 1)
        const origins = originsOfType(checker, type)
        if (origins.some((origin) => origin.module === "@nestjs/common" && ["DynamicModule", "Type", "Provider"].includes(origin.name))) return true
        if (constructor(type)) return constructors || moduleConstructor(type)
        if (dynamicModule(type)) return true
        const properties = new Set(type.getProperties().map((property) => property.name))
        if (properties.has("provide") && ["useClass", "useFactory", "useValue", "useExisting"].some((key) => properties.has(key))) return true
        if (properties.has("queue") && ["cron", "everyMs", "pattern", "repeat"].some((key) => properties.has(key))) return true
        // Primitive options values and their library methods never compose an app.
        if (!(type.flags & ts.TypeFlags.Object)) return false
        const element = arrayElement(type)
        if (element) return contains(element, true, seen, depth + 1)
        // Index signatures retain the Type<unknown> contract of a module map, unlike a plain adapter port map.
        for (const index of checker.getIndexInfosOfType(type)) {
            if (contains(index.type, false, new Set(seen), depth + 1)) return true
        }
        for (const signature of type.getCallSignatures()) {
            if (contains(checker.getReturnTypeOfSignature(signature), false, new Set(seen), depth + 1)) return true
        }
        return type.getProperties().some((property) => contains(propertyType(type, property.name), false, new Set(seen), depth + 1))
    }
    const typedList = (type: ts.Type): boolean => {
        const element = arrayElement(type)
        if (!element || element.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false
        const parts = element.isUnion() ? element.types : [element]
        return parts.every((part) => contains(part, true))
    }
    return { arrayElement, contains, typedList }
}

/** R265: app values compose only in typed groups, never in env/options/bootstrap lists. */
export const appCompositionTyped: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Module, provider, queue and scheduler composition is judged by its resolved type and lives in typed compose groups." },
        schema: [],
        messages: {
            outside: "[BE_COMPOSITION_UNTYPED] This value composes modules, providers, queues or schedules in `{{role}}`. Move it into a typed `compose/<area>.ts` group and spread the group in `app.module.ts`.",
            group: "[BE_COMPOSITION_UNTYPED] Declare this composition group's array type or return type explicitly (for example `Array<DynamicModule | Type<unknown>>`); every element must be a module, provider, queue or scheduler entry.",
            business: "[BE_APP_BUSINESS_ROLE] Composition groups only wire modules, providers, queues and schedules. Move business functions and branching into their owning feature or module.",
        },
    },
    create(context) {
        const filename = normalizePath(context.filename || context.getFilename())
        if (isDeclarationFile(filename)) return {}
        const role = appRoleOf(hfsOf(context), filename)?.entry
        const typedRoles: ReadonlyArray<string | undefined> = [APP_ENV_ROLE, APP_OPTIONS_ROLE, "main.ts", "compose/<area>.ts"]
        if (!typedRoles.includes(role)) return {}
        const { checker, toTs } = typed(context)
        const { arrayElement, contains, typedList } = compositionTypes(checker)
        const reported = new WeakSet<Node>()
        const hasReport = (node: Node): boolean => {
            for (let ancestor: Node | undefined = node; ancestor; ancestor = ancestor.parent) if (reported.has(ancestor)) return true
            return false
        }
        const report = (node: Node, messageId: "outside" | "group" | "business"): void => {
            if (hasReport(node)) return
            reported.add(node)
            context.report({ node, messageId, data: { role } })
        }
        const typeOf = (node: Node): ts.Type => checker.getTypeAtLocation(toTs(node))
        const bootCalls: ReadonlyArray<string | null> = ["create", "createApplicationContext", "createMicroservice"]
        const bootstrapArgument = (node: Node): boolean => {
            // The root module's registration belongs here; inline lists and metadata still belong in compose/.
            if (role !== "main.ts" || node.type !== "CallExpression") return false
            let expression: Node = node
            while (isWrapper(expression.parent)) expression = expression.parent
            const parent = expression.parent
            if (parent?.type !== "CallExpression" || !parent.arguments.some((argument) => argument === expression) || parent.callee.type !== "MemberExpression") return false
            const owner = (callee: TSESTree.MemberExpression): string | null => packageOfExport(context, callee) ?? packageOfExport(context, callee.object)
            // An api boots through NestFactory; a cli app boots its root module through nest-commander's CommandFactory.run (R148).
            return (bootCalls.includes(memberName(parent.callee)) && owner(parent.callee) === "@nestjs/core")
                || (memberName(parent.callee) === "run" && parent.arguments[0] === expression && owner(parent.callee) === "nest-commander")
        }
        const checkValue = (node: Node): void => {
            if (role === "compose/<area>.ts" || hasReport(node) || bootstrapArgument(node)) return
            if (contains(typeOf(node))) report(node, "outside")
        }
        const checkGroup = (node: Node, value: Node, annotation: unknown): void => {
            if (role !== "compose/<area>.ts") return
            const type = typeOf(value)
            const signatures = type.getCallSignatures()
            const first = signatures[0]
            const result = first ? checker.getReturnTypeOfSignature(first) : type
            if (signatures.length && !arrayElement(result) && !contains(result)) {
                report(node, "business")
                return
            }
            if (!annotation || !typedList(result)) report(node, "group")
        }
        const annotationOf = (node: Node | null | undefined): unknown => {
            if (!node) return null
            if (node.type === "TSSatisfiesExpression") return node.typeAnnotation
            if (isWrapper(node)) return annotationOf(node.expression)
            if (node.type === "VariableDeclarator") return node.id.typeAnnotation ?? annotationOf(node.init)
            if ("returnType" in node && node.returnType) return node.returnType
            if (node.type !== "Identifier") return null
            const symbol = checker.getSymbolAtLocation(toTs(node))
            const resolved = resolveAlias(checker, symbol)
            return resolved?.getDeclarations()?.some((declaration) => {
                const initializer = childNode(declaration, "initializer")
                return childNode(declaration, "type") || initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) || ts.isSatisfiesExpression(initializer)) && initializer.type
            }) ?? false
        }
        return {
            ExportNamedDeclaration(node) {
                if (role !== "compose/<area>.ts" || node.exportKind === "type") return
                const declaration = node.declaration
                if (!declaration) {
                    for (const specifier of node.specifiers) {
                        if (specifier.exportKind !== "type") checkGroup(specifier, specifier.local, annotationOf(specifier.local))
                    }
                    return
                }
                if (declaration.type === "FunctionDeclaration" && declaration.body) checkGroup(declaration, declaration, declaration.returnType)
                if (declaration.type !== "VariableDeclaration") return
                for (const binding of declaration.declarations) {
                    if (!binding.init) continue
                    checkGroup(binding, binding.id, annotationOf(binding))
                }
            },
            ExportDefaultDeclaration(node) {
                if (role === "compose/<area>.ts") checkGroup(node, node.declaration, annotationOf(node.declaration))
            },
            VariableDeclarator(node) {
                if (node.init) checkValue(node.init)
            },
            FunctionDeclaration(node) {
                if (node.body && role !== "compose/<area>.ts" && contains(typeOf(node))) report(node, "outside")
            },
            ArrowFunctionExpression(node) {
                if (role !== "compose/<area>.ts" || hasReport(node)) return
                const signature = typeOf(node).getCallSignatures()[0]
                if (signature && !contains(checker.getReturnTypeOfSignature(signature))) report(node, "business")
            },
            IfStatement(node) { if (role === "compose/<area>.ts") report(node, "business") },
            SwitchStatement(node) { if (role === "compose/<area>.ts") report(node, "business") },
            ConditionalExpression(node) { if (role === "compose/<area>.ts") report(node, "business") },
            ForStatement(node) { if (role === "compose/<area>.ts") report(node, "business") },
            ForOfStatement(node) { if (role === "compose/<area>.ts") report(node, "business") },
            WhileStatement(node) { if (role === "compose/<area>.ts") report(node, "business") },
            ArrayExpression: checkValue,
            ObjectExpression: checkValue,
            CallExpression: checkValue,
            ReturnStatement(node) {
                if (node.argument) checkValue(node.argument)
            },
        }
    },
}

/** Resolve an imported or local binding without relying on its local spelling. */
const resolvedSymbol = (checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined => {
    const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node)
    return resolveAlias(checker, symbol)
}

/** Whether a value is a TypeScript symbol (it carries numeric `flags` and an `escapedName`). */
const isSymbol = (value: unknown): value is ts.Symbol =>
    typeof value === "object" && value !== null && "flags" in value && typeof value.flags === "number" && "escapedName" in value

/** The symbol the binder gave a node (a module's own symbol for an external-module source file), if any. */
const ownSymbol = (node: ts.Node): ts.Symbol | undefined => {
    const value: unknown = Reflect.get(node, "symbol")
    return isSymbol(value) ? value : undefined
}

/** The app's declared name comes from its matching env filename, not its kind's slot name. */
const appEnvNames = (filename: string, role: string): { file: string; reader: string } => {
    const root = filename.slice(0, filename.lastIndexOf("/"))
    const app = role === APP_ENV_ROLE ? (filename.split("/").at(-1) ?? "").slice(0, -".env.ts".length) : root.split("/").at(-2)
    if (app === undefined) throw new TypeError("Cannot read properties of undefined (reading 'replace')")
    const pascal = app.replace(/(?:^|[-_])([a-z\d])/g, (_: string, letter: string) => letter.toUpperCase())
    return { file: `${root}/${app}.env.ts`, reader: `read${pascal}Env` }
}

/** R289: the typed app env reader owns parsing; main acquires one source and delegates once. */
export const appEnvRequired: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Every app exports its typed EnvSource reader; main builds one source and delegates parsing to that reader." },
        schema: [],
        messages: {
            shape: "[BE_APP_ENV_REQUIRED] Export an environment interface and `{{reader}}(env: EnvSource)` returning that interface from the matching app env file.",
            inline: "[BE_APP_ENV_REQUIRED] Bootstrap builds EnvSource once and delegates environment parsing only to the matching app env reader. Move this environment read or parser into `<app>.env.ts`.",
            delegate: "[BE_APP_ENV_REQUIRED] Main must build EnvSource once and call `{{reader}}` from `{{file}}` with that source once.",
        },
    },
    create(context) {
        const filename = normalizePath(context.filename || context.getFilename())
        if (isDeclarationFile(filename)) return {}
        const hfs = hfsOf(context)
        const role = appRoleOf(hfs, filename)?.entry
        if (role !== APP_ENV_ROLE && role !== "main.ts") return {}
        const { checker, toTs } = typed(context)
        const names = appEnvNames(filename, role)
        const ownedEnv = (type: ts.Type): boolean => originsOfType(checker, type).some((origin) => origin.name === "EnvSource" && isOwnedBy(hfs, origin.file, "platform", "config"))
        const envValue = (node: Node | null | undefined): boolean | null | undefined => node && ownedEnv(checker.getTypeAtLocation(toTs(node)))
        const matchingReader = (node: Node): boolean | undefined => {
            const symbol = resolvedSymbol(checker, toTs(node))
            return symbol?.name === names.reader && symbol.getDeclarations()?.some((declaration) => normalizePath(declaration.getSourceFile().fileName) === names.file)
        }
        const envContract = (node: TSESTree.Program): boolean | undefined => {
            const source = toTs(node)
            const moduleSymbol = ownSymbol(source)
            if (!moduleSymbol) return false
            const exported = checker.getExportsOfModule(moduleSymbol)
            const reader = exported.find((symbol) => symbol.name === names.reader)
            const declaration = reader?.valueDeclaration ?? reader?.getDeclarations()?.[0]
            if (!reader || !declaration) return false
            const signatures = checker.getTypeOfSymbolAtLocation(reader, declaration).getCallSignatures()
            return signatures.some((signature) => {
                const parameters = signature.getParameters()
                if (parameters.length !== 1 || !signature.declaration?.type) return false
                const parameter = parameters[0]
                const valueDeclaration = parameter?.valueDeclaration
                if (!parameter || !valueDeclaration || !childNode(valueDeclaration, "type") || !ownedEnv(checker.getTypeOfSymbolAtLocation(parameter, valueDeclaration))) return false
                const result = checker.getReturnTypeOfSignature(signature)
                return result.getSymbol()?.getDeclarations()?.some((item) => ts.isInterfaceDeclaration(item)
                    && item.getSourceFile() === source && exported.some((symbol) => symbol.name === item.name.text))
            })
        }
        let sources = 0
        let delegates = 0
        let inline = false
        const reported = new WeakSet<Node>()
        const reportInline = (node: Node): void => {
            for (let parent: Node | undefined = node; parent; parent = parent.parent) if (reported.has(parent)) return
            reported.add(node)
            inline = true
            context.report({ node, messageId: "inline" })
        }
        return {
            CallExpression(node) {
                if (role !== "main.ts") return
                const declaration = checker.getResolvedSignature(toTs(node))?.declaration
                if (declaration && ts.isMethodDeclaration(declaration) && declaration.name.getText() === "fromProcess"
                    && envValue(node) && isOwnedBy(hfs, normalizePath(declaration.getSourceFile().fileName), "platform", "config")) {
                    sources += 1
                    if (sources > 1 || node.arguments.length) reportInline(node)
                    return
                }
                if (matchingReader(node.callee) && node.arguments.length === 1 && envValue(node.arguments[0])) {
                    delegates += 1
                    if (delegates > 1) reportInline(node)
                    return
                }
                const callee = unwrap(node.callee)
                if (callee.type === "MemberExpression" && envValue(callee.object) || node.arguments.some(envValue)) reportInline(node)
            },
            MemberExpression(node) {
                if (role !== "main.ts") return
                if (memberName(node) === "env" && lastName(node.object) === "process") reportInline(node)
                if (envValue(node.object) && !node.parent?.type.startsWith("CallExpression") && memberName(node) !== "fromProcess") reportInline(node)
            },
            "Program:exit"(node) {
                if (role === APP_ENV_ROLE) {
                    if (!envContract(node)) context.report({ node, messageId: "shape", data: names })
                } else if (!inline && (sources !== 1 || delegates !== 1)) context.report({ node, messageId: "delegate", data: names })
            },
        }
    },
}

/** R289: module lists in the app root contain only spreads of its own compose groups. */
export const appModuleListInline: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "The app root spreads compose groups; its only inline provider registrations are app-wide guards and filters." },
        schema: [],
        messages: {
            inline: "[BE_APP_MODULE_LIST_INLINE] Move module, provider, queue or schedule entries into typed `compose/<area>.ts` groups and spread those groups here. Only app-wide guards and filters may be inline.",
        },
    },
    create(context) {
        const filename = normalizePath(context.filename || context.getFilename())
        if (isDeclarationFile(filename)) return {}
        const hfs = hfsOf(context)
        if (appRoleOf(hfs, filename)?.entry !== "app.module.ts") return {}
        const { checker, toTs } = typed(context)
        const { contains } = compositionTypes(checker)
        const composeRoot = filename.slice(0, filename.lastIndexOf("/")) + "/compose/"
        const groupSpread = (node: Node): boolean => {
            if (node.type !== "SpreadElement") return false
            const value = unwrap(node.argument)
            const reference = value.type === "CallExpression" ? unwrap(value.callee) : value
            const symbol = resolvedSymbol(checker, toTs(reference))
            return symbol?.getDeclarations()?.some((declaration) => {
                const file = normalizePath(declaration.getSourceFile().fileName)
                return file.startsWith(composeRoot) && appRoleOf(hfs, file)?.entry === "compose/<area>.ts"
            }) ?? false
        }
        const providerTokens: ReadonlyArray<string | undefined> = ["APP_GUARD", "APP_FILTER"]
        const globalProvider = (element: Node): boolean => {
            const node = unwrap(element)
            if (node?.type !== "ObjectExpression") return false
            const binding = node.properties.find((property): property is TSESTree.Property => property.type === "Property" && keyName(property.key) === "provide")
            const value = binding && unwrap(binding.value)
            if (!value || !providerTokens.includes(resolvedSymbol(checker, toTs(value))?.name)) return false
            return packageOfExport(context, value) === "@nestjs/core"
        }
        return {
            ArrayExpression(node) {
                const parent = node.parent
                const key = parent?.type === "Property" ? parent.computed ? staticText(parent.key) : keyName(parent.key) : null
                const listKeys: ReadonlyArray<string | null> = [...COMPOSITION_KEYS, "providers"]
                if (!listKeys.includes(key) && !contains(checker.getTypeAtLocation(toTs(node)))) return
                const violation = node.elements.find((element) => !element || !groupSpread(element) && !(key === "providers" && globalProvider(element)))
                if (violation || node.elements.includes(null)) context.report({ node: violation ?? node, messageId: "inline" })
            },
        }
    },
}

/** The lines of a source text that no import declaration (`import ...` or `import x = require(...)`) covers, one or many lines each. */
const linesExcludingImports = (text: string, body: ReadonlyArray<{ readonly type: string, readonly loc?: { readonly start: { readonly line: number }, readonly end: { readonly line: number } } | null }>): number => {
    const covered = new Set<number>()
    for (const statement of body) {
        if ((statement.type !== "ImportDeclaration" && statement.type !== "TSImportEqualsDeclaration") || !statement.loc) continue
        for (let line = statement.loc.start.line; line <= statement.loc.end.line; line += 1) covered.add(line)
    }
    return lineCount(text) - covered.size
}

/** Each composition file of an app stays within the line budget its app slot names, counted without its import lines. */
export const appFileBudget: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "`main.ts`, `app.module.ts`, `<app>.env.ts`, `<app>.options.ts` and `compose/<area>.ts` stay within the line budget of their app slot, counted without import lines." },
        schema: [],
        messages: {
            over: "This {{role}} has {{lines}} lines excluding imports, over its budget of {{max}} (the `budget` of slot {{slot}}). {{fix}}",
        },
    },
    create(context) {
        const filename = normalizePath(context.filename || context.getFilename())
        if (isDeclarationFile(filename)) return {}
        const hfs = hfsOf(context)
        const role = appRoleOf(hfs, filename)
        const max = role ? hfs.slot(role.slot)?.budget?.[role.entry] : undefined
        if (!role || max === undefined || !Number.isInteger(max)) return {}
        const fix = role.entry === APP_ENV_ROLE
            ? "Keep typed, fail-fast environment parsing only here; move module composition into `compose/<area>.ts` and business code into its owning module."
            : role.entry === APP_OPTIONS_ROLE
            ? "Keep options types and port bindings here; move environment parsing into `<app>.env.ts` and module, queue or scheduler lists into `compose/<area>.ts`."
            : role.entry === "main.ts"
            ? "Move environment parsing into `<app>.env.ts` and module composition into `compose/<area>.ts`; keep the bootstrap here."
            : "Move one area of the composition into its own group `apps/<app>/src/compose/<area>.ts` and spread it in `app.module.ts`."
        return {
            "Program:exit"(node) {
                const lines = linesExcludingImports((context.sourceCode || context.getSourceCode()).text, node.body)
                if (lines > max) context.report({ node, loc: { line: 1, column: 0 }, messageId: "over", data: { role: role.entry, lines, max, slot: role.slot, fix } })
            },
        }
    },
}

/** The rules this law contributes to the plugin. */
export const rules = {
    "app-options-composition-free": appOptionsCompositionFree,
    "app-composition-typed": appCompositionTyped,
    "app-env-required": appEnvRequired,
    "app-module-list-inline": appModuleListInline,
    "app-file-budget": appFileBudget,
} satisfies Rules

/** Every rule starts at error; an app already over a budget migrates its lists into compose/. */
export const recommended: Recommended = {
    "starci-be/app-options-composition-free": "error",
    "starci-be/app-composition-typed": "error",
    "starci-be/app-env-required": "error",
    "starci-be/app-module-list-inline": "error",
    "starci-be/app-file-budget": "error",
}
