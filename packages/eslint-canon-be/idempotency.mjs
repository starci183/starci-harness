/**
 * The rule that holds inbox dedupe (catalog R80 `BE_INBOX_DEDUPE_MISSING`).
 *
 * A sender that gets no timely reply resends: a payment provider retries a webhook, a queue redelivers a message it
 * never saw acknowledged. The standard is one inbox table keyed by `(source, event id)` in front of every door
 * delivery can repeat through, so a repeat is a no-op instead of a second charge, a second email or a second state
 * transition.
 *
 *   - `inbox-dedupe-required` judges every DELIVERY method of a service. Doors (consumers, `SignedWebhook` controllers) are
 *     thin (R88): they map the delivery and dispatch one message, so the claim lives in the `*.service.ts` the handler calls,
 *     inside its transaction. A delivery method is a public method of a `<name>.service.ts` whose FIRST parameter has an
 *     `eventId` property, read by the parameter's TYPE. Its first awaited work is the Inbox claim, directly or as the
 *     first work of the one write transaction it runs, with that transaction's manager, and the method must return
 *     early when the claim answers `false`. A lookalike `Inbox` declared by another owner, a renamed receiver and a
 *     property injection are all judged by the receiver's type, so only the real port satisfies the rule; a keyword or a
 *     class name never does.
 *
 * Accepted shapes of "claim, then return on false":
 *   if (!(await this.inbox.claim(source, id))) return
 *   if ((await this.inbox.claim(source, id)) === false) { return }
 *   const fresh = await this.inbox.claim(source, id)
 *   if (!fresh) return
 * A transaction delivery returns or awaits one `.transaction(...)` as its sole statement, on a receiver typed as typeorm's
 * `EntityManager` or as a port the `platform/database` owner declares; the callback's one parameter is typed `EntityManager`.
 * Either the actual selected inline async callback claims with that manager in its first statement, then returns on false,
 * or an arrow callback hands its whole work to one `this.<method>(..., tx, ...)` of the same class, resolved by the checker:
 * that async helper is private or a public delivery method judged in its own right, receives the manager in a never-reassigned
 * `EntityManager` runtime parameter, and prepares only `const` arguments without this/manager access, writes, construction,
 * awaits or calls other than free functions. Its first await is the claim with that parameter at its top level, followed by
 * the return on false:
 *   return this.manager.transaction((tx) => this.recordInTransaction(delivery, tx))
 *   async recordInTransaction(delivery: Delivery, manager: EntityManager) {
 *       const key = keyOf(delivery)
 *       if (!(await this.inbox.claim(source, key, manager))) return this.readRepeat(delivery, manager)
 *       return this.write(delivery, manager)
 *   }
 * No outer work runs after a duplicate. Every runner and manager type origin must match its declared owner; unions with
 * lookalikes, spread handoffs, protected or replaced helpers, and callbacks handing work to another object are refused.
 * Effects hidden inside free functions or getters and helpers called past the first one stay review questions.
 */
import ts from "typescript"
import { hfsOf } from "./lib/hfs.mjs"
import { keyName, walk } from "./lib/ast.mjs"
import { baseName, isOwnedType, ownerNameOf } from "./lib/ports.mjs"
import { resolveVariable } from "./lib/transactions.mjs"
import { typeOrigins, typed } from "./lib/types.mjs"
import { mutationIdempotent } from "./lib/client-idempotency.mjs"

/** The `Inbox` port of `platform/inbox`. */
const isInboxType = (context, node) => isOwnedType(context, node, { name: "Inbox", capability: "inbox", tier: "platform" })

/** A `return` statement, or a block that ends in one. */
const returns = (statement) =>
    statement?.type === "ReturnStatement"
    || (statement?.type === "BlockStatement" && statement.body.at(-1)?.type === "ReturnStatement")

/** Whether `test` is `!<expression>` or `<expression> === false` around `target` (the awaited claim, or the identifier holding it). */
const refusesOn = (test, target) => {
    if (test.type === "UnaryExpression" && test.operator === "!") return test.argument === target || (test.argument.type === "Identifier" && target.type === "Identifier" && test.argument.name === target.name)
    if (test.type === "BinaryExpression" && (test.operator === "===" || test.operator === "==")) {
        const [left, right] = [test.left, test.right]
        const isFalse = (node) => node.type === "Literal" && node.value === false
        return (left === target && isFalse(right)) || (right === target && isFalse(left))
    }
    return false
}

/** Where the awaited claim sits: the statement that tests it, or the declaration that stores it followed by that test. */
const returnsOnFalse = (awaited) => {
    const node = awaited
    const parent = node.parent
    if (parent.type === "UnaryExpression" || parent.type === "BinaryExpression") {
        const statement = parent.parent
        return statement.type === "IfStatement" && statement.test === parent && refusesOn(parent, node) && returns(statement.consequent)
    }
    if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
        const declaration = parent.parent
        const siblings = declaration.parent?.body
        if (!Array.isArray(siblings)) return false
        const next = siblings[siblings.indexOf(declaration) + 1]
        return next?.type === "IfStatement" && refusesOn(next.test, parent.id) && returns(next.consequent)
    }
    return false
}

/** The awaited expression that completes first in a body, ignoring nested functions; null when the body awaits nothing. */
const firstAwait = (body) => {
    let first = null
    walk(body, (node) => {
        if (node.type === "AwaitExpression" && (first === null || node.range[1] < first.range[1])) first = node
    }, { intoFunctions: false })
    return first
}

/** True when an expression evaluates a call, construction or write before the designated call completes. */
const hasPriorEffect = (expression, call) => {
    let found = false
    walk(expression, (node) => {
        if (["CallExpression", "NewExpression", "AssignmentExpression", "UpdateExpression"].includes(node.type)
            && node !== call && node.range[1] < call.range[1]) found = true
    }, { intoFunctions: false })
    return found
}

/** A transaction port the `platform/database` owner declares: a receiver typed by that owner, never by its name. */
const isDatabasePort = (context, node) => {
    const hfs = hfsOf(context)
    const origins = typeOrigins(context, node)
    return origins.length > 0 && origins.every((origin) =>
        origin.module === null && hfs.tierOf(origin.file) === "platform" && ownerNameOf(hfs, origin.file) === "database")
}

/** Every declared alternative must be TypeORM's manager: one genuine union member cannot vouch for a lookalike. */
const isEntityManager = (context, node) => {
    const origins = typeOrigins(context, node)
    return origins.length > 0 && origins.every((origin) => origin.name === "EntityManager" && origin.module === "typeorm")
}

/** TypeScript erases a `this` parameter, so only these parameters receive call arguments at runtime. */
const runtimeParams = (method) => method.value.params.filter((param) => !(param.type === "Identifier" && param.name === "this"))

/** The callback a sole, returned or awaited `.transaction(...)` runs on an EntityManager or the database port, and its manager parameter. */
const soleTransactionCallback = (context, body) => {
    if (body.body.length !== 1) return null
    const outer = body.body[0]
    const expression = outer.type === "ReturnStatement" ? outer.argument
        : outer.type === "ExpressionStatement" && outer.expression.type === "AwaitExpression" ? outer.expression : null
    const call = expression?.type === "AwaitExpression" ? expression.argument : expression
    const callee = call?.callee
    if (call?.type !== "CallExpression" || callee.type !== "MemberExpression" || callee.computed
        || callee.property.type !== "Identifier" || callee.property.name !== "transaction" || hasPriorEffect(call, call)) return null
    let callback = null
    if (isEntityManager(context, callee.object)) {
        // TypeORM runs arg0 when it is a function, otherwise arg1. Never accept a later, ignored callback.
        const isolation = call.arguments[0]
        callback = call.arguments.length === 1 ? isolation
            : call.arguments.length === 2 && isolation.type === "Literal"
                && ["READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"].includes(isolation.value)
                ? call.arguments[1] : null
    } else if (isDatabasePort(context, callee.object) && call.arguments.length === 1) callback = call.arguments[0]
    if (!callback || !["ArrowFunctionExpression", "FunctionExpression"].includes(callback.type) || callback.params.length !== 1) return null
    const manager = callback.params[0]
    if (manager.type !== "Identifier" || !isEntityManager(context, manager)) return null
    return { callback, manager }
}

/** True when `argument` is the identifier bound to the parameter `param`; with `unwritten`, that parameter is also never reassigned. */
const isParameter = (context, argument, param, { unwritten = false } = {}) => {
    const binding = resolveVariable(context.sourceCode, param)
    const argumentBinding = argument?.type === "Identifier" ? resolveVariable(context.sourceCode, argument) : null
    return !!binding && binding.defs[0]?.name === param && argumentBinding === binding
        && !(unwritten && binding.references.some((reference) => reference.isWrite()))
}

/** The statement of a block that holds its first await as the claim it tests, stores or awaits; null when that await sits deeper. */
const claimStatement = (block) => {
    const awaited = firstAwait(block)
    const parent = awaited?.parent
    const statement = parent?.type === "VariableDeclarator" && parent.init === awaited
        && parent.parent.declarations.length === 1 ? parent.parent
        : ["UnaryExpression", "BinaryExpression"].includes(parent?.type) ? parent.parent
            : parent?.type === "ExpressionStatement" ? parent : null
    return statement?.parent === block ? { awaited, statement } : null
}

/** The claim that opens the inline async callback with its own manager, as its first statement. */
const inlineClaim = (context, { callback, manager }) => {
    if (!callback.async || callback.body.type !== "BlockStatement") return null
    const found = claimStatement(callback.body)
    if (!found || found.statement !== callback.body.body[0]) return null
    const claim = found.awaited.argument
    if (claim?.type !== "CallExpression" || !isParameter(context, claim.arguments[2], manager) || hasPriorEffect(found.statement, claim)) return null
    return found.awaited
}

/** The `this.<method>(...)` call an arrow callback hands its whole work to: its expression body, or its sole returned or awaited statement. */
const handedCall = (callback) => {
    if (callback.type !== "ArrowFunctionExpression") return null
    let expression = callback.body
    if (expression.type === "BlockStatement") {
        const [sole] = expression.body
        if (expression.body.length !== 1) return null
        expression = sole.type === "ReturnStatement" ? sole.argument
            : sole.type === "ExpressionStatement" && sole.expression.type === "AwaitExpression" ? sole.expression : null
    }
    const call = expression?.type === "AwaitExpression" ? expression.argument : expression
    const callee = call?.callee
    return call?.type === "CallExpression" && callee.type === "MemberExpression" && !callee.computed
        && callee.object.type === "ThisExpression" && ["Identifier", "PrivateIdentifier"].includes(callee.property.type) ? call : null
}

/** Argument preparation cannot start instance or transactional work before the inbox claim. */
const preparesArguments = (context, statement, manager) => {
    if (statement.type !== "VariableDeclaration" || statement.kind !== "const") return false
    let safe = true
    walk(statement, (node) => {
        if (node.type === "ThisExpression" || (node.type === "Identifier" && isParameter(context, node, manager))
            || ["AwaitExpression", "NewExpression", "AssignmentExpression", "UpdateExpression"].includes(node.type)
            || (node.type === "CallExpression" && node.callee.type !== "Identifier")) safe = false
    }, { intoFunctions: false })
    return safe
}

/** An assignment anywhere in the class can replace the method that the checker resolved for the handoff. */
const replacesHelper = (classBody, helper) => {
    let replaced = false
    walk(classBody, (node) => {
        if (node.type !== "AssignmentExpression") return
        const target = node.left
        if (target.type === "MemberExpression" && target.object.type === "ThisExpression"
            && (!target.computed || target.property.type === "Literal")
            && (target.property.type === "PrivateIdentifier") === (helper.key.type === "PrivateIdentifier")
            && keyName(target.property) === keyName(helper.key)) replaced = true
    })
    return replaced
}

/** The helper body must claim first with its unchanged runtime manager, after only argument preparation. */
const helperClaim = (context, helper, param) => {
    if (!helper.value?.async || helper.value.body?.type !== "BlockStatement"
        || param?.type !== "Identifier" || !isEntityManager(context, param)) return null
    const body = helper.value.body
    const found = claimStatement(body)
    if (!found) return null
    const before = body.body.slice(0, body.body.indexOf(found.statement))
    if (before.some((statement) => !preparesArguments(context, statement, param))) return null
    const claim = found.awaited.argument
    if (claim?.type !== "CallExpression" || !isParameter(context, claim.arguments[2], param, { unwritten: true })
        || hasPriorEffect(found.statement, claim)) return null
    return found.awaited
}

/**
 * The claim of a typed helper the callback delegates to: a method of the delivery's own class, resolved by the checker, that receives
 * the callback's manager, awaits nothing before the claim, claims with that parameter at its top level and runs no statement but `const`
 * argument preparation before it.
 */
const delegatedClaim = (context, delivery, { callback, manager }) => {
    const call = handedCall(callback)
    if (!call || call.arguments.some((argument) => argument.type === "SpreadElement") || hasPriorEffect(call, call)) return null
    const position = call.arguments.findIndex((argument) => argument.type === "Identifier" && argument.name === manager.name)
    if (position < 0 || !isParameter(context, call.arguments[position], manager)) return null
    const { checker, toTs } = typed(context)
    const declarations = checker.getSymbolAtLocation(toTs(call.callee.property))?.getDeclarations?.() ?? []
    const helper = declarations.length === 1
        ? delivery.parent.body.find((member) => member.type === "MethodDefinition" && toTs(member) === declarations[0]) : undefined
    if (!helper || helper === delivery || helper.kind !== "method" || helper.static || !helper.value.async || !helper.value.body) return null
    const params = runtimeParams(helper)
    // A public delivery contract carries its claim and manager obligations into every override.
    if (helper.accessibility === "protected" || (helper.accessibility !== "private" && helper.key.type !== "PrivateIdentifier"
        && (!params[0] || !isDeliveryParam(context, params[0]))) || replacesHelper(delivery.parent, helper)) return null
    return helperClaim(context, helper, params[position])
}

/** The first awaited claim of a delivery that runs as one transaction: inline in its callback, or in the typed helper that callback delegates to. */
const transactionClaim = (context, delivery) => {
    const transaction = soleTransactionCallback(context, delivery.value.body)
    if (!transaction) return null
    return inlineClaim(context, transaction) ?? delegatedClaim(context, delivery, transaction)
}

/** A delivery's type, including a union alternative, exposes the sender's `eventId`. */
const hasEventId = (checker, type) =>
    (type.isUnion() ? type.types : [type]).some((part) => checker.getPropertyOfType(part, "eventId") !== undefined)

/** Whether a parameter's type has an `eventId` property: the shape of a delivery. */
const isDeliveryParam = (context, param) => {
    const target = param.type === "TSParameterProperty" ? param.parameter : param.type === "AssignmentPattern" ? param.left : param
    const { checker, toTs } = typed(context)
    const tsNode = toTs(target)
    if (!tsNode) return false
    return hasEventId(checker, checker.getTypeAtLocation(tsNode))
}

/** The runtime parameter the declared signature's first awaited claim uses, including declarations in another source file. */
const claimedManagerPosition = (checker, signature) => {
    let awaited = null
    const visit = (node) => {
        if (ts.isAwaitExpression(node) && (!awaited || node.end < awaited.end)) awaited = node
        ts.forEachChild(node, (child) => { if (!ts.isFunctionLike(child)) visit(child) })
    }
    const body = signature.getDeclaration()?.body
    if (body) visit(body)
    const claim = awaited?.expression
    if (!claim || !ts.isCallExpression(claim) || !ts.isPropertyAccessExpression(claim.expression)
        || claim.expression.name.text !== "claim" || !claim.arguments[2]) return -1
    const manager = checker.getSymbolAtLocation(claim.arguments[2])
    return manager ? signature.parameters.indexOf(manager) : -1
}

/** An override preserves inherited delivery and transaction-manager obligations even when it widens its own parameter. */
const inheritedDelivery = (context, method) => {
    const name = keyName(method.key)
    const result = { delivery: false, managers: new Set() }
    if (name === null) return result
    const { checker, toTs } = typed(context)
    const location = toTs(method)
    const seen = new Set()
    const visit = (type) => {
        if (seen.has(type)) return
        seen.add(type)
        const member = checker.getPropertyOfType(type, name)
        const signatures = member ? checker.getTypeOfSymbolAtLocation(member, location).getCallSignatures() : []
        for (const signature of signatures) {
            const param = signature.parameters[0]
            if (!param || !hasEventId(checker, checker.getTypeOfSymbolAtLocation(param, location))) continue
            result.delivery = true
            const manager = claimedManagerPosition(checker, signature)
            if (manager >= 0) result.managers.add(manager)
        }
        for (const base of checker.getBaseTypes(type) ?? []) visit(base)
    }
    const owner = checker.getTypeAtLocation(toTs(method.parent.parent))
    for (const base of checker.getBaseTypes(owner) ?? []) visit(base)
    return result
}

/** A service method that takes a delivery claims the event through the shared inbox before it acts. */
export const inboxDedupeRequired = {
    meta: {
        type: "problem",
        docs: { description: "A public service method whose first parameter carries an `eventId` claims `(source, eventId)` on the `Inbox` port first and returns early when it answers `false`." },
        schema: [],
        messages: {
            noClaim: "This delivery method's first awaited expression is not `claim(source, eventId)` on the `Inbox` port of `platform/inbox` (`@InjectInbox() private readonly inbox: Inbox`). A sender that gets no timely reply resends the same event: claim it before anything else so a repeat delivery is a no-op.",
            noEarlyReturn: "This delivery method claims the event but does not return when the claim answers `false`. Write `if (!(await this.inbox.claim(source, eventId))) return` (or store the answer and return on `!fresh` straight after), so a repeat does none of the work again.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const filename = context.filename || context.getFilename()
        const slot = hfs.slotOf(filename)
        if (!baseName(filename).endsWith(".service.ts") || !slot || slot.startsWith("be.tests.")) return {}
        // The event bus publishes events (their shape carries an `eventId`) and its runtime claims the inbox before a consumer runs: no delivery method here.
        if (slot.startsWith("be.platform") && ownerNameOf(hfs, filename) === "event-bus") return {}
        const judgeClaim = (node, inherited) => {
            const body = node.value?.body
            let awaited = body?.type === "BlockStatement" ? transactionClaim(context, node) ?? firstAwait(body) : null
            if (inherited.managers.size > 0) {
                const params = node.value?.params ? runtimeParams(node) : []
                if (![...inherited.managers].every((position) => helperClaim(context, node, params[position]) === awaited)) awaited = null
            }
            const call = awaited?.argument
            const claims = call?.type === "CallExpression"
                && call.callee.type === "MemberExpression"
                && !call.callee.computed
                && call.callee.property.type === "Identifier"
                && call.callee.property.name === "claim"
                && call.arguments.length >= 2
                && isInboxType(context, call.callee.object)
            if (!claims) context.report({ node: node.key, messageId: "noClaim" })
            else if (!returnsOnFalse(awaited)) context.report({ node: node.key, messageId: "noEarlyReturn" })
        }
        return {
            MethodDefinition(node) {
                if (node.kind !== "method" || node.static || node.key.type === "PrivateIdentifier" || !node.value.body) return
                if (node.accessibility === "private" || node.accessibility === "protected") return
                const first = runtimeParams(node)[0]
                const inherited = inheritedDelivery(context, node)
                if (!(first && isDeliveryParam(context, first)) && !inherited.delivery) return
                judgeClaim(node, inherited)
            },
            PropertyDefinition(node) {
                if (node.static || node.key.type === "PrivateIdentifier" || node.accessibility === "private" || node.accessibility === "protected") return
                const inherited = inheritedDelivery(context, node)
                if (inherited.delivery) judgeClaim(node, inherited)
            },
        }
    },
}

/** The rule this law contributes to the plugin. */
export const rules = {
    "inbox-dedupe-required": inboxDedupeRequired,
    "mutation-idempotent": mutationIdempotent,
}

/** Starts at error: a duplicate charge or a duplicate side effect is never a warning. */
export const recommended = {
    "starci-be/inbox-dedupe-required": "error",
    "starci-be/mutation-idempotent": "error",
}
