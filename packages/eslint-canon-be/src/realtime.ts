/**
 * The rules that hold the realtime kind (R184 `BE_REALTIME_SHAPE`, R185 `BE_REALTIME_WRITES`, R186 `BE_REALTIME_TOPIC_SCOPE`).
 *
 * A realtime door (`src/features/realtime/<channel>/transport/websocket/<channel>.gateway.ts` for a socket, `transport/graphql/<x>.subscription.ts` for a GraphQL
 * subscription, `transport/sse/<channel>.controller.ts` for server-sent events, slot `be.feature.realtime`) READS and PUSHES. It never writes: the push is fed by a reactor that calls the `RealtimeHub`
 * of `platform/realtime`, and the door only subscribes a client to a topic of that hub.
 *
 *   - `realtime-shape` (R184): a `.gateway.ts` holds one `@WebSocketGateway` class whose handlers are `@SubscribeMessage`, or a
 *     push-only gateway whose `@WebSocketServer` streams take the server's typed principal; a
 *     `.subscription.ts` holds one `@Resolver` class whose operations are `@Subscription`, and an SSE `.controller.ts` holds one
 *     `@Controller` class whose one route is `@Sse`. Each is the door its file role names, and none carries a query, a mutation or a
 *     plain REST route.
 *   - `realtime-read-only` (R185): the only value injected into a realtime door is the `RealtimeHub` of `platform/realtime`. No
 *     `EntityManager`, bus, queue, event bus or domain service reaches it.
 *   - `realtime-topic-scope` (R186): the topic passed to `hub.subscribe` (or `hub.stream`, the SSE form) is built from the principal parameter of the handler
 *     (`@CurrentPrincipal()` of `domain/identity`, or `Principal` of `platform/cqrs` for a push-only stream), so a client
 *     can only listen to what the principal owns. A `Last-Event-ID` header only picks where the replay resumes inside that topic.
 *
 * What a receiver is comes from its TYPE, what a decorator is from the import that binds it, and where a parameter comes
 * from from the declaration its name resolves to. No rule here tests a path pattern or a variable name.
 */
import { walk } from "./lib/ast.ts"
import { aliasTarget, callsOf, hasClassDecorator, injectedMembers, methodsDecoratedBy, parametersOf } from "./lib/doors.ts"
import { hfsOf } from "./lib/hfs.ts"
import { decoratorCallee } from "./lib/import-source.ts"
import { baseName, isOwnedType, ownerNameOf } from "./lib/ports.ts"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import type { ClassNode, MethodCall } from "./lib/doors.ts"
import type { Context, Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"
import type { HfsView } from "./lib/hfs.ts"

/** One parameter of a handler method, as `parametersOf` unwraps it. */
type Parameter = ReturnType<typeof parametersOf>[number]

/** The slot of realtime doors. */
const DOOR_SLOTS = new Set(["be.feature.realtime.graphql", "be.feature.realtime.websocket", "be.feature.realtime.sse"])

/** The `RealtimeHub` port of `platform/realtime`. */
const isHubType = (context: Context, node: Node): boolean => isOwnedType(context, node, { name: "RealtimeHub", capability: "realtime", tier: "platform" })

/** The plain HTTP route decorators of `@nestjs/common`: an SSE controller carries none of them, its one route is `@Sse`. */
const HTTP_ROUTES = ["Get", "Post", "Put", "Patch", "Delete", "All", "Options", "Head"] as const

/** The decorators that make a class a door of one kind of realtime file, by file role. */
const ROLES = {
    gateway: { classDecorator: ["@nestjs/websockets", "WebSocketGateway"], operation: ["@nestjs/websockets", "SubscribeMessage"], foreign: [["@nestjs/graphql", ["Query", "Mutation", "ResolveField", "Subscription"]], ["@nestjs/common", ["Controller"]]] },
    subscription: { classDecorator: ["@nestjs/graphql", "Resolver"], operation: ["@nestjs/graphql", "Subscription"], foreign: [["@nestjs/graphql", ["Query", "Mutation", "ResolveField"]], ["@nestjs/websockets", ["WebSocketGateway", "SubscribeMessage"]], ["@nestjs/common", ["Controller"]]] },
    controller: { classDecorator: ["@nestjs/common", "Controller"], operation: ["@nestjs/common", "Sse"], foreign: [["@nestjs/graphql", ["Query", "Mutation", "ResolveField", "Subscription", "Resolver"]], ["@nestjs/websockets", ["WebSocketGateway", "SubscribeMessage"]], ["@nestjs/common", HTTP_ROUTES]] },
} as const

/** A realtime file role: a key of `ROLES`. */
type Role = keyof typeof ROLES

/** Whether a captured file role is one of `ROLES`. */
const isRole = (value: string | undefined): value is Role => value === "gateway" || value === "subscription" || value === "controller"

/** The role (`gateway`, `subscription` or `controller`) a realtime file name carries, or null. */
const roleOf = (filename: string): Role | null => {
    const found = /\.(gateway|subscription|controller)\.ts$/.exec(baseName(filename))?.[1]
    return isRole(found) ? found : null
}

/** The door classes of a file: every class with a class-level door decorator of the role. */
const doorClasses = (context: Context, program: TSESTree.Program, role: Role): TSESTree.ClassDeclaration[] => {
    const found: TSESTree.ClassDeclaration[] = []
    const [source, name] = ROLES[role].classDecorator
    walk(program, (node) => {
        if (node.type === "ClassDeclaration" && hasClassDecorator(context, node, source, name)) found.push(node)
    })
    return found
}

/** The framework supplies this server property; no inbound message supplies a stream's principal. */
const hasSocketServer = (context: Context, node: ClassNode): boolean => node.body.body.some((member) =>
    member.type === "PropertyDefinition" && hasClassDecorator(context, member, "@nestjs/websockets", "WebSocketServer"))

/** The authenticated principal port the socket middleware passes to a push-only stream. */
const isStreamPrincipal = (context: Context, param: Node): boolean => isOwnedType(context, param, { name: "Principal", capability: "cqrs", tier: "platform" })

/** The hub calls that open a client's stream: `subscribe` (an async iterable of frames) and `stream` (server-sent events), including those inside closures. */
const OPENING_CALLS = new Set(["subscribe", "stream"])
const hubSubscriptions = (context: Context, method: TSESTree.MethodDefinition): MethodCall[] => callsOf(method).filter(({ receiver, method: called }) =>
    called !== null && OPENING_CALLS.has(called) && receiver !== null && isHubType(context, receiver))

/** The nonstatic methods a push-only gateway uses to feed its socket server. */
const streamMethods = (context: Context, node: ClassNode): TSESTree.MethodDefinition[] => {
    if (!hasSocketServer(context, node)) return []
    return node.body.body.filter((member): member is TSESTree.MethodDefinition => member.type === "MethodDefinition" && member.kind === "method" && !member.static
        && hubSubscriptions(context, member).length > 0)
}

/** An inbound handler or a push-only stream taking the server's authenticated principal. */
const hasOperation = (context: Context, node: ClassNode, role: Role): boolean => methodsDecoratedBy(context, node, ROLES[role].operation[0], ROLES[role].operation[1]).length > 0
    || (role === "gateway" && streamMethods(context, node).some((method) => parametersOf(method).some((param) => isStreamPrincipal(context, param))))

/** A realtime file is the one door its role names, and nothing else. */
export const realtimeShape: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A realtime file is one door: a `.gateway.ts` holds one `@WebSocketGateway` class with `@SubscribeMessage` handlers or principal-typed push streams through `@WebSocketServer`, a `.subscription.ts` holds one `@Resolver` class with `@Subscription` operations, and neither carries a route, query or mutation." },
        schema: [],
        messages: {
            door: "A `<channel>.{{role}}.ts` file declares exactly one `{{decorator}}` class (this one declares {{count}}). One file is one door.",
            operations: "This {{role}} door has no `@{{operation}}` handler or principal-typed push stream through `@WebSocketServer`. A realtime door subscribes the client to a topic of the `RealtimeHub`.",
            single: "This SSE controller declares {{count}} `@Sse` methods. A `<channel>.controller.ts` of the sse slot is one door with exactly one `@Sse` stream; a second stream is a second channel in its own folder.",
            foreign: "`@{{name}}` has no place in a realtime {{role}} door. A realtime door only subscribes and pushes; a query, a mutation, a field resolver or a REST route belongs in an api feature, and the other realtime protocol in its own file.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const role = roleOf(context.filename)
        if (!DOOR_SLOTS.has(hfs.slotOf(context.filename) ?? "") || role === null) return {}
        const spec = ROLES[role]
        return {
            "Program:exit"(program) {
                const doors = doorClasses(context, program, role)
                const [door] = doors
                if (doors.length !== 1 || !door) {
                    context.report({ node: program, messageId: "door", data: { role, decorator: `@${spec.classDecorator[1]}`, count: String(doors.length) } })
                    return
                }
                if (!hasOperation(context, door, role)) context.report({ node: door, messageId: "operations", data: { role, operation: spec.operation[1] } })
                const streams = role === "controller" ? methodsDecoratedBy(context, door, spec.operation[0], spec.operation[1]).length : 1
                if (streams > 1) context.report({ node: door, messageId: "single", data: { count: String(streams) } })
                walk(program, (node) => {
                    if (node.type !== "Decorator") return
                    for (const [source, names] of spec.foreign) {
                        const hit = names.find((name) => hasDecorator(context, node, source, name))
                        if (hit !== undefined) context.report({ node, messageId: "foreign", data: { name: hit, role } })
                    }
                })
            },
        }
    },
}

/** True when one decorator node is `name` exported by `source`. */
const hasDecorator = (context: Context, decorator: TSESTree.Decorator, source: string, name: string): boolean => hasClassDecorator(context, { decorators: [decorator] }, source, name)

/** A realtime door injects the hub and nothing else: it reads and pushes, it never writes. */
export const realtimeReadOnly: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "The only value a realtime door injects is the `RealtimeHub` of `platform/realtime`: no `EntityManager`, bus, queue, event bus or domain service." },
        schema: [],
        messages: {
            injects: "`{{what}}` is injected into a realtime door. A realtime door reads and pushes only: it injects the `RealtimeHub` of `platform/realtime` and nothing that can write (an `EntityManager`, a `CommandBus`, an event bus, a queue, a domain service). The push is fed by a reactor that calls the hub; a write belongs in an api feature.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        if (!DOOR_SLOTS.has(hfs.slotOf(context.filename) ?? "") || roleOf(context.filename) === null) return {}
        return {
            ClassDeclaration(node) {
                for (const { node: member, annotation } of injectedMembers(context, node)) {
                    if (!annotation || !isHubType(context, annotation)) context.report({ node: member, messageId: "injects", data: { what: context.sourceCode.getText(member) } })
                }
            },
        }
    },
}

/** True when the parameter carries `@CurrentPrincipal()` declared by `domain/identity`, judged by the declaration the decorator resolves to. */
const isPrincipalParameter = (context: Context, hfs: HfsView, param: Parameter): boolean =>
    (param.decorators ?? []).some((decorator) => {
        const callee = decoratorCallee(decorator)
        if (callee?.type !== "Identifier") return false
        const symbol = aliasTarget(context, callee)
        return symbol?.getName() === "CurrentPrincipal" && (symbol.getDeclarations() ?? []).some((declaration) => ownerNameOf(hfs, declaration.getSourceFile().fileName) === "identity" && hfs.tierOf(declaration.getSourceFile().fileName) === "domain")
    })

/** True when the identifier resolves to one of the `names` (parameters of the handler). */
const resolvesTo = (context: Context, identifier: TSESTree.Identifier, parameters: ReadonlySet<Node>): boolean => {
    for (let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name)
        if (!variable) continue
        return variable.defs.some((definition) => definition.type === "Parameter" && parameters.has(definition.name))
    }
    return false
}

/** A method's principal parameters, declared by the identity decorator or the push stream's platform type. */
const principalParameters = (context: Context, hfs: HfsView, method: TSESTree.MethodDefinition, push: boolean): Set<Node> => {
    const principals = new Set<Node>()
    for (const param of parametersOf(method)) {
        if (!isPrincipalParameter(context, hfs, param) && !(push && isStreamPrincipal(context, param))) continue
        const target = param.type === "AssignmentPattern" ? param.left : param
        if (target.type === "Identifier") principals.add(target)
    }
    return principals
}

/** The hub topic must use the method's principal declaration rather than a shadowing identifier. */
const checkMethodTopics = (context: Context, hfs: HfsView, method: TSESTree.MethodDefinition, push: boolean): void => {
    const principals = principalParameters(context, hfs, method, push)
    for (const { call } of hubSubscriptions(context, method)) {
        let scoped = false
        walk(call.arguments[0], (child) => {
            if (child.type === "Identifier" && resolvesTo(context, child, principals)) scoped = true
        })
        if (!scoped) context.report({ node: call, messageId: "scope" })
    }
}

/** The topic a client subscribes to is built from the principal the handler receives. */
export const realtimeTopicScope: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "The topic passed to `RealtimeHub.subscribe` is built from the handler's `@CurrentPrincipal()` parameter or the push-only stream's platform `Principal` parameter." },
        schema: [],
        messages: {
            scope: "The topic of this `subscribe` is not built from the principal. A realtime handler takes `@CurrentPrincipal() principal`, or a push-only stream takes the platform `Principal`, and subscribes to a topic made from `principal.id` (plus any verified id), so one client cannot listen to another's channel. A topic taken only from client input is a leak.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const role = roleOf(context.filename)
        if (!DOOR_SLOTS.has(hfs.slotOf(context.filename) ?? "") || role === null) return {}
        const [source, name] = ROLES[role].operation
        return {
            ClassDeclaration(node) {
                const handlers = methodsDecoratedBy(context, node, source, name)
                for (const method of handlers) checkMethodTopics(context, hfs, method, false)
                if (role !== "gateway") return
                for (const method of streamMethods(context, node)) {
                    if (!handlers.includes(method)) checkMethodTopics(context, hfs, method, true)
                }
            },
        }
    },
}

/** The rules this law contributes to the plugin. */
export const rules = {
    "realtime-shape": realtimeShape,
    "realtime-read-only": realtimeReadOnly,
    "realtime-topic-scope": realtimeTopicScope,
} satisfies Rules

/** Every rule of this law at `error`. */
export const recommended: Recommended = {
    "starci-be/realtime-shape": "error",
    "starci-be/realtime-read-only": "error",
    "starci-be/realtime-topic-scope": "error",
}
