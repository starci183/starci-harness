/** R263 extends inbox dedupe to scalar delivery ids and signed raw-body intakes. */
import ts from "typescript"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"
import { memberKeyValue, nameOrValue, walk } from "./ast.ts"
import { hfsOf } from "./hfs.ts"
import { baseName, isOwnedType, ownerNameOf } from "./ports.ts"
import { resolveVariable } from "./transactions.ts"
import { isPackageType, typed } from "./types.ts"
import { webhookIntakeProcessesDelivery } from "./webhook-handoff-intake.ts"
import type { Context, Node, RuleModule } from "./rule.ts"
import type { HfsView } from "./hfs.ts"

/** Where a delivery intake takes its delivery key from: an `*Id` parameter, DTO properties, or a signed raw body. */
interface DeliveryKey {
    readonly parameter: Node
    readonly properties?: string[]
    readonly raw?: true
}

const DELIVERY_ID = /Id$/

/** The slot of provider webhook doors (`<provider>.webhook.ts`), the only entrance of a delivery intake. */
const DOOR_SLOT = "be.feature.webhooks.http"

/** The method declarations each program's webhook doors call, computed once per program. */
const reachedByProgram = new WeakMap<ts.Program, Set<ts.Node>>()

/** Declarations a call resolves to: its signature's declaration and its (alias-resolved) callee symbol's declarations. */
const calledDeclarations = (checker: ts.TypeChecker, call: ts.CallExpression): ts.Node[] => {
    const expression = call.expression
    const name = ts.isPropertyAccessExpression(expression) ? expression.name
        : ts.isElementAccessExpression(expression) ? expression.argumentExpression : expression
    const symbol = checker.getSymbolAtLocation(name)
    const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return [checker.getResolvedSignature(call)?.declaration, ...(target?.getDeclarations() ?? [])].filter((declaration): declaration is ts.Declaration => Boolean(declaration))
}

/** Every method a webhook door file (slot be.feature.webhooks.http, `*.webhook.ts`) calls, by resolved declaration. */
const doorCalledDeclarations = (context: Context, hfs: HfsView): Set<ts.Node> => {
    const { program, checker } = typed(context)
    const cached = reachedByProgram.get(program)
    if (cached) return cached
    const reached = new Set<ts.Node>()
    for (const source of program.getSourceFiles()) {
        if (hfs.slotOf(source.fileName) !== DOOR_SLOT || !baseName(source.fileName).endsWith(".webhook.ts")) continue
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) for (const declaration of calledDeclarations(checker, node)) reached.add(declaration)
            ts.forEachChild(node, visit)
        }
        visit(source)
    }
    reachedByProgram.set(program, reached)
    return reached
}

/** A method is a webhook delivery intake only when a webhook door's call resolves to it. */
const isDoorIntake = (context: Context, hfs: HfsView, method: TSESTree.MethodDefinition): boolean => {
    const declaration: ts.Node = typed(context).toTs(method)
    return !!declaration && doorCalledDeclarations(context, hfs).has(declaration)
}

/** Defaults keep the same first-parameter binding. */
const parameterOf = (parameter: Node | undefined): Node | undefined => parameter?.type === "AssignmentPattern" ? parameter.left : parameter

/** The extra delivery contracts missed by the existing eventId-object rule. */
const deliveryKey = (context: Context, method: TSESTree.MethodDefinition): DeliveryKey | null => {
    const first = parameterOf(method.value.params[0])
    if (!first) return null
    if (first.type === "Identifier" && DELIVERY_ID.test(first.name)) return { parameter: first }
    const { checker, toTs } = typed(context)
    const type = checker.getTypeAtLocation(toTs(first))
    const parts = type.isUnion() ? type.types : [type]
    const ids = [...new Set(parts.flatMap((part) => checker.getPropertiesOfType(part).map((property) => property.getName()).filter((name) => DELIVERY_ID.test(name))))]
    if (ids.length) return { parameter: first, properties: ids }
    const raw = first.type === "Identifier" && first.name === "rawBody"
        && method.value.params.slice(1).some((parameter) => {
            const bound = parameterOf(parameter)
            return bound?.type === "Identifier" && bound.name === "signature"
        })
        || parts.some((part) => checker.getPropertyOfType(part, "rawBody") && checker.getPropertyOfType(part, "signature"))
    // A declared verifier class proves authenticity; its ordinary domain intake owns dedupe.
    const owner: Node | undefined = method.parent?.parent
    const ownerName = owner?.type === "ClassDeclaration" || owner?.type === "ClassExpression" ? owner.id?.name : undefined
    if (raw && !/(?:Verifier|verify)$/.test(ownerName ?? "")) return { parameter: first, raw: true }
    return null
}

/** Identifiers are compared by lexical binding, so a same-spelled shadow is not a key. */
const sameBinding = (context: Context, left: Node | null | undefined, right: Node | null | undefined): boolean => left?.type === "Identifier" && right?.type === "Identifier"
    && resolveVariable(context.sourceCode, left) !== null
    && resolveVariable(context.sourceCode, left) === resolveVariable(context.sourceCode, right)

/** A decoded key comes from the raw input or a later delivery-id parameter, never a widened constant. */
const rawKeySource = (context: Context, expression: Node | null | undefined, key: DeliveryKey, seen = new Set<Node>()): boolean => {
    if (!expression || seen.has(expression)) return false
    seen.add(expression)
    let sourced = false
    walk(expression, (node) => {
        if (node.type !== "Identifier") return
        if (sameBinding(context, node, key.parameter)) sourced = true
        const variable = resolveVariable(context.sourceCode, node)
        for (const definition of variable?.defs ?? []) {
            if (definition.type === "Parameter" && (DELIVERY_ID.test(node.name)
                || node.parent?.type === "MemberExpression" && node.parent.object === node
                    && DELIVERY_ID.test(String(memberKeyValue(node.parent))))) sourced = true
            if (definition.type === "Variable" && rawKeySource(context, definition.node.init, key, seen)) sourced = true
        }
    }, { intoFunctions: false })
    return sourced
}

/** Scalar ids and object ids must actually key the claim; a raw payload itself is never a delivery key. */
const usesKey = (context: Context, argument: Node | undefined, key: DeliveryKey): boolean => {
    if (!argument) return false
    if (key.raw) {
        if (sameBinding(context, argument, key.parameter) || argument.type === "Literal") return false
        const name = argument.type === "Identifier" ? argument.name
            : argument.type === "MemberExpression" ? memberKeyValue(argument) : null
        if (!name || !DELIVERY_ID.test(String(name))) return false
        const { checker, toTs } = typed(context)
        const type = checker.getTypeAtLocation(toTs(argument))
        const parts = type.isUnion() ? type.types : [type]
        return parts.every((part) => part.flags & ts.TypeFlags.StringLike && !(part.flags & ts.TypeFlags.StringLiteral))
            && rawKeySource(context, argument, key)
    }
    if (key.parameter.type === "ObjectPattern") {
        return key.parameter.properties.some((property) => property.type === "Property"
            && key.properties?.some((name) => name === nameOrValue(property.key))
            && sameBinding(context, argument, parameterOf(property.value)))
    }
    if (!key.properties) return sameBinding(context, argument, key.parameter)
    return argument.type === "MemberExpression" && !argument.optional
        && sameBinding(context, argument.object, key.parameter)
        && key.properties.some((name) => name === memberKeyValue(argument))
}

/** Find the first completed await, without treating a nested helper as work performed here. */
const firstAwait = (body: Node | null | undefined): TSESTree.AwaitExpression | null => {
    let result: TSESTree.AwaitExpression | null = null
    walk(body, (node) => {
        if (node.type === "AwaitExpression" && (!result || node.range[1] < result.range[1])) result = node
    }, { intoFunctions: false })
    return result
}

/** A parameter's binding cannot be overwritten before the claim and still prove the delivered id. */
const preservesKey = (context: Context, key: DeliveryKey, call: TSESTree.CallExpression): boolean => {
    const parameter = key.raw ? call.arguments[1] : key.parameter
    if (parameter?.type !== "Identifier") return true
    const variable = resolveVariable(context.sourceCode, parameter)
    return variable !== null && !variable.references.some((reference) => reference.isWrite() && !reference.init
        && reference.identifier.range[0] < call.range[1])
}

/** Scalar/DTO claims are the first statement; a raw intake may first bind its decoded key. */
const claimsBeforeWork = (context: Context, body: TSESTree.BlockStatement, statement: Node | undefined, key: DeliveryKey, call: TSESTree.CallExpression): boolean => {
    const index = body.body.findIndex((entry) => entry === statement)
    if (index === 0) return true
    if (index < 0 || !key.raw) return false
    const dependencies = new Set<TSESLint.Scope.Variable | null>()
    const read = (expression: Node | null | undefined): void => {
        if (!expression) return
        walk(expression, (node) => {
            if (node.type !== "Identifier") return
            const variable = resolveVariable(context.sourceCode, node)
            if (!variable || dependencies.has(variable)) return
            dependencies.add(variable)
            for (const definition of variable.defs) if (definition.type === "Variable") read(definition.node.init)
        }, { intoFunctions: false })
    }
    read(call.arguments[1])
    return body.body.slice(0, index).every((entry) => entry.type === "VariableDeclaration" && entry.kind === "const"
        && entry.declarations.every((declaration) => declaration.id.type === "Identifier" && dependencies.has(resolveVariable(context.sourceCode, declaration.id))))
}

/** A claim cannot be made conditionally or after another operation in its own statement. */
const priorWork = (expression: Node | undefined, call: TSESTree.CallExpression): boolean => {
    let found = false
    walk(expression, (node) => {
        if (node !== call && ["CallExpression", "NewExpression", "AssignmentExpression", "UpdateExpression", "ConditionalExpression", "LogicalExpression"].includes(node.type)
            && node.range[1] < call.range[1]) found = true
    }, { intoFunctions: false })
    return found
}

/** Select TypeORM's actual inline transaction callback, never a later ignored callback. */
const claimBody = (context: Context, body: TSESTree.BlockStatement): { body: TSESTree.BlockStatement; manager: TSESTree.Identifier | null } => {
    if (body.body.length !== 1) return { body, manager: null }
    const [statement] = body.body
    if (!statement) return { body, manager: null }
    const expression = statement.type === "ReturnStatement" ? statement.argument
        : statement.type === "ExpressionStatement" && statement.expression.type === "AwaitExpression" ? statement.expression : null
    const call = expression?.type === "AwaitExpression" ? expression.argument : expression
    if (call?.type !== "CallExpression") return { body, manager: null }
    const callee = call.callee
    if (callee.type !== "MemberExpression" || callee.computed
        || callee.property.name !== "transaction" || !isPackageType(context, callee.object, "EntityManager", "typeorm")
        || priorWork(call, call)) return { body, manager: null }
    const first = call.arguments[0]
    const callback = call.arguments.length === 1 ? first
        : call.arguments.length === 2 && first?.type === "Literal" && typeof first.value === "string"
            && ["READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"].includes(first.value) ? call.arguments[1] : null
    if (!callback || (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")
        || !callback.async || callback.body.type !== "BlockStatement" || callback.params.length !== 1) return { body, manager: null }
    const manager = callback.params[0]
    return manager?.type === "Identifier" && isPackageType(context, manager, "EntityManager", "typeorm")
        ? { body: callback.body, manager } : { body, manager: null }
}

/** Match an immediate false refusal with no work before the return. */
const rejectsDuplicate = (context: Context, awaited: TSESTree.AwaitExpression, body: TSESTree.BlockStatement): boolean => {
    const rejects = (test: Node | null | undefined, target: Node): boolean => test?.type === "UnaryExpression" && test.operator === "!" && (test.argument === target || sameBinding(context, test.argument, target))
        || test?.type === "BinaryExpression" && test.operator === "==="
            && ((test.left === target && test.right.type === "Literal" && test.right.value === false)
                || (test.right === target && test.left.type === "Literal" && test.left.value === false))
    const returns = (statement: Node | null | undefined): boolean => statement?.type === "ReturnStatement" && !statement.argument
        || statement?.type === "BlockStatement" && statement.body.length === 1 && returns(statement.body[0])
    const parent = awaited.parent
    if (parent.type === "UnaryExpression" || parent.type === "BinaryExpression") {
        const branch = parent.parent
        return body.body.some((entry) => entry === branch) && branch.type === "IfStatement" && rejects(branch.test, awaited) && returns(branch.consequent)
    }
    if (parent.type !== "VariableDeclarator" || parent.id.type !== "Identifier" || parent.init !== awaited) return false
    const declaration = parent.parent
    const index = body.body.indexOf(declaration)
    const branch = body.body[index + 1]
    return index !== -1 && declaration.declarations.length === 1
        && branch?.type === "IfStatement" && rejects(branch.test, parent.id) && returns(branch.consequent)
}

/** A public service intake with a delivery key claims that same key first and refuses replays. */
export const webhookInboxKey: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Delivery methods with first *Id parameters or DTO properties, or raw-body signature contracts, claim the real Inbox with a stable delivery key before work and return on duplicates. Receipt transactions publish events and leave processing to a reactor/job." },
        schema: [],
        messages: {
            key: "[BE_WEBHOOK_INBOX_KEY] This delivery intake must first await the real platform/inbox claim(source, deliveryId), using its first *Id parameter or DTO property, or a decoded id for a signed raw-body intake, and return immediately when the claim is false. A transaction claim uses that callback's own manager; raw payloads and fixed literals are not delivery keys.",
            handoff: "[BE_WEBHOOK_INBOX_KEY] A receipt transaction records the inbox delivery and publishes the typed event. Remove the process callback and domain/command processing from this transaction; a reactor or job processes the delivery after commit.",
        },
    },
    create(context: Context) {
        const hfs = hfsOf(context)
        const slot = hfs.slotOf(context.filename)
        if (!slot || slot.startsWith("be.tests.") || !baseName(context.filename).endsWith(".service.ts")) return {}
        if (slot.startsWith("be.platform") && ["event-bus", "http-security"].includes(ownerNameOf(hfs, context.filename) ?? "")) return {}
        return {
            MethodDefinition(method) {
                if (method.kind !== "method" || method.static || method.key.type === "PrivateIdentifier" || !method.value.body
                    || method.accessibility === "private" || method.accessibility === "protected") return
                // A service no webhook door reaches is an ordinary domain service, whatever its first parameter is called.
                if (!isDoorIntake(context, hfs, method)) return
                const key = deliveryKey(context, method)
                if (!key) return
                if (webhookIntakeProcessesDelivery(context, hfs, method)) context.report({ node: method.key, messageId: "handoff" })
                const { body, manager } = claimBody(context, method.value.body)
                const awaited = firstAwait(body)
                const call = awaited?.argument
                const parent: Node | undefined = awaited?.parent
                const statement: Node | undefined = parent?.type === "VariableDeclarator" ? parent.parent
                    : parent?.type === "UnaryExpression" || parent?.type === "BinaryExpression" ? parent.parent : parent
                const claims = awaited !== null && call?.type === "CallExpression" && !call.optional
                    && call.callee.type === "MemberExpression" && !call.callee.computed && !call.callee.optional
                    && call.callee.property.name === "claim" && call.arguments.length >= 2
                    && isOwnedType(context, call.callee.object, { name: "Inbox", capability: "inbox", tier: "platform" })
                    && usesKey(context, call.arguments[1], key)
                    && preservesKey(context, key, call)
                    && (!manager || sameBinding(context, call.arguments[2], manager))
                    && claimsBeforeWork(context, body, statement, key, call)
                    && !priorWork(statement, call)
                    && rejectsDuplicate(context, awaited, body)
                if (!claims) context.report({ node: method.key, messageId: "key" })
            },
        }
    },
}
