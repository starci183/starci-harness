/**
 * The lite event-bus law (catalog R336 `BE_EVENT_BUS_LITE_SHAPE`; contexts/code/be/event-bus.md BE-EVENT-BUS-6): delivery on pgmq is at
 * least once and unordered, so every event carries a business dedupe key and every consumer is a static subscription.
 *
 *   - `event-dedupe-key` refuses an event class (a class of `src/modules/events/**` extending `BaseEvent`) whose `payload` type has no
 *     `dedupeKey` member: the consumer inbox claims (consumer, dedupeKey), so a payload without one cannot be deduplicated. The type is
 *     a literal, `EventPayload`, or an interface or type alias of the same file that declares `dedupeKey` or extends `EventPayload`.
 *   - `event-subscription-static` refuses a `subscribe(queue, consumer, options?)` call of a file that imports platform/event-bus whose
 *     queue is not a `*_TOPIC_QUEUE` constant imported from `@modules/platform/event-bus` (the literal constants R258 holds to the
 *     migrations), or whose options are not an object literal of literal values.
 *
 * Both rules judge lite apps only; full's bus is Kafka (BE-EVENT-BUS-3).
 */
import type { TSESTree } from "@typescript-eslint/utils"
import { hfsOf } from "./lib/hfs.ts"
import type { RuleModule, Recommended, Rules } from "./lib/rule.ts"

/** The public entry of the event bus capability. */
const EVENT_BUS_MODULE = "@modules/platform/event-bus"
/** The base class every typed event extends. */
const BASE_EVENT = "BaseEvent"
/** The payload type of platform/event-bus that carries the dedupe key. */
const EVENT_PAYLOAD = "EventPayload"
/** The member the consumer inbox claims. */
const DEDUPE_KEY = "dedupeKey"
/** The name every consumer queue constant ends with. */
const TOPIC_QUEUE = /_TOPIC_QUEUE$/
/** An event file. */
const EVENT_FILE = /[\\/]src[\\/]modules[\\/]events[\\/].+\.event\.ts$/

type TypeNode = TSESTree.TypeNode
type Declarations = ReadonlyMap<string, TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeAliasDeclaration>

/** The interfaces and type aliases a file declares, exported or not. */
const declarationsOf = (program: TSESTree.Program): Declarations => {
    const found = new Map<string, TSESTree.TSInterfaceDeclaration | TSESTree.TSTypeAliasDeclaration>()
    for (const statement of program.body) {
        const node = statement.type === "ExportNamedDeclaration" && statement.declaration ? statement.declaration : statement
        if (node.type === "TSInterfaceDeclaration" || node.type === "TSTypeAliasDeclaration") found.set(node.id.name, node)
    }
    return found
}

/** True when a member list declares `dedupeKey`. */
const declaresKey = (members: ReadonlyArray<TSESTree.TypeElement>): boolean =>
    members.some((member) => member.type === "TSPropertySignature" && !member.computed && member.key.type === "Identifier" && member.key.name === DEDUPE_KEY)

/** True when a type carries `dedupeKey`, following the interfaces and aliases of the same file (each at most once). */
const carriesKey = (type: TypeNode | undefined, declarations: Declarations, seen: Set<string> = new Set()): boolean => {
    if (type === undefined) return false
    if (type.type === "TSTypeLiteral") return declaresKey(type.members)
    if (type.type === "TSIntersectionType") return type.types.some((part) => carriesKey(part, declarations, seen))
    if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return false
    const name = type.typeName.name
    if (name === EVENT_PAYLOAD) return true
    const declaration = declarations.get(name)
    if (declaration === undefined || seen.has(name)) return false
    seen.add(name)
    if (declaration.type === "TSTypeAliasDeclaration") return carriesKey(declaration.typeAnnotation, declarations, seen)
    if (declaresKey(declaration.body.body)) return true
    return (declaration.extends ?? []).some((heritage) => heritage.expression.type === "Identifier"
        && (heritage.expression.name === EVENT_PAYLOAD || carriesKey({ type: "TSTypeReference", typeName: heritage.expression } as TypeNode, declarations, seen)))
}

/** The declared type of a class's `payload`: a property or a constructor parameter property; null when there is none. */
const payloadTypeOf = (body: TSESTree.ClassBody): TypeNode | undefined | null => {
    for (const member of body.body) {
        if (member.type === "PropertyDefinition" && !member.computed && member.key.type === "Identifier" && member.key.name === "payload") return member.typeAnnotation?.typeAnnotation
        if (member.type !== "MethodDefinition" || member.kind !== "constructor") continue
        for (const parameter of member.value.params) {
            if (parameter.type === "TSParameterProperty" && parameter.parameter.type === "Identifier" && parameter.parameter.name === "payload") return parameter.parameter.typeAnnotation?.typeAnnotation
        }
    }
    return null
}

/** An event payload carries the business dedupe key the consumer inbox claims. */
export const eventDedupeKey: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A lite event class's payload type declares dedupeKey, the business key a consumer's inbox claims." },
        schema: [],
        messages: {
            missing: "The payload of `{{name}}` has no `dedupeKey`. Add `readonly dedupeKey: string` (the business identity of the fact, such as the order id) to its payload type, or extend `EventPayload` of platform/event-bus: delivery is at least once and the consumer inbox claims (consumer, dedupeKey).",
        },
    },
    create(context) {
        if (hfsOf(context).edition !== "lite" || !EVENT_FILE.test(context.filename)) return {}
        let declarations: Declarations = new Map()
        const judge = (node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void => {
            if (node.superClass?.type !== "Identifier" || node.superClass.name !== BASE_EVENT) return
            const type = payloadTypeOf(node.body)
            if (type === null || !carriesKey(type, declarations)) context.report({ node: node.id ?? node, messageId: "missing", data: { name: node.id?.name ?? "the event" } })
        }
        return {
            Program(program) { declarations = declarationsOf(program) },
            ClassDeclaration: judge,
            ClassExpression: judge,
        }
    },
}

/** A subscription names a literal topic-queue constant of platform/event-bus and literal options. */
export const eventSubscriptionStatic: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A lite reactor subscribes with a *_TOPIC_QUEUE constant imported from platform/event-bus and literal options." },
        schema: [],
        messages: {
            queue: "`subscribe` must name its queue with a `*_TOPIC_QUEUE` constant imported from `@modules/platform/event-bus`, the literal constant whose pgmq queue, dead-letter queue and topic binding a migration declares (R258); a computed or local queue name is a subscription nobody can see.",
            options: "`subscribe` options are an object literal of literal values (`{ maxDeliveries: 5 }`), so the subscription is static data.",
        },
    },
    create(context) {
        if (hfsOf(context).edition !== "lite") return {}
        const topicQueues = new Set<string>()
        let importsBus = false
        const literalOptions = (node: TSESTree.Node): boolean => node.type === "ObjectExpression" && node.properties.every((property) =>
            property.type === "Property" && !property.computed && property.value.type === "Literal")
        return {
            ImportDeclaration(node) {
                if (node.source.value !== EVENT_BUS_MODULE) return
                importsBus = true
                for (const specifier of node.specifiers) {
                    if (specifier.type === "ImportSpecifier" && TOPIC_QUEUE.test(specifier.local.name)) topicQueues.add(specifier.local.name)
                }
            },
            CallExpression(node) {
                const callee = node.callee
                if (!importsBus || callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier" || callee.property.name !== "subscribe" || node.arguments.length < 2) return
                const queue = node.arguments[0]
                const options = node.arguments[2]
                if (queue === undefined) return
                if (queue.type !== "Identifier" || !topicQueues.has(queue.name)) context.report({ node: queue, messageId: "queue" })
                if (options !== undefined && !literalOptions(options)) context.report({ node: options, messageId: "options" })
            },
        }
    },
}

/** The rules of the lite event-bus law, by name. */
export const rules = { "event-dedupe-key": eventDedupeKey, "event-subscription-static": eventSubscriptionStatic } satisfies Rules
/** On at error; each judges lite apps only. */
export const recommended: Recommended = { "starci-be/event-dedupe-key": "error", "starci-be/event-subscription-static": "error" }
