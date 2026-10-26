/** BE-IDEMPOTENCY-3: marked client commands preserve their key and execute through the transactional inbox. */
import ts from "typescript"
import { hfsOf } from "./hfs.mjs"
import { baseName, ownerNameOf } from "./ports.mjs"
import { moduleOf, originsOfType, typed } from "./types.mjs"
import { isTransportSlot } from "./transport-slots.mjs"

/** Imported aliases and namespace access resolve to the declaring value. */
const valueSymbol = (checker, expression, seen = new Set()) => {
    if (!expression || seen.has(expression)) return undefined
    seen.add(expression)
    const name = ts.isPropertyAccessExpression(expression) ? expression.name : expression
    const symbol = name.parent && ts.isShorthandPropertyAssignment(name.parent) && name.parent.name === name
        ? checker.getShorthandAssignmentValueSymbol(name.parent) : checker.getSymbolAtLocation(name)
    const target = symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    const alias = target?.getDeclarations()?.find((declaration) => ts.isVariableDeclaration(declaration)
        && declaration.parent.flags & ts.NodeFlags.Const && declaration.initializer
        && (ts.isIdentifier(declaration.initializer) || ts.isPropertyAccessExpression(declaration.initializer)))
    return alias ? valueSymbol(checker, alias.initializer, seen) : target
}

/** The genuine decorator belongs to its platform capability, rather than merely sharing a name. */
const ownedValue = (checker, hfs, expression, name, capability) => {
    const symbol = valueSymbol(checker, expression)
    return symbol?.name === name && symbol.getDeclarations()?.some((declaration) => {
        const file = declaration.getSourceFile().fileName
        return moduleOf(declaration, file) === null && hfs.tierOf(file) === "platform" && ownerNameOf(hfs, file) === capability
    })
}

/** A resolved decorator declaration and its call arguments. */
const decorators = (checker, node) => (ts.getDecorators(node) ?? []).map((decorator) => {
    const call = decorator.expression
    const expression = ts.isCallExpression(call) ? call.expression : call
    const symbol = valueSymbol(checker, expression)
    return { expression, symbol, args: ts.isCallExpression(call) ? call.arguments : [], called: ts.isCallExpression(call) }
})

/** Whether the class carries the platform inbox's effectful marker. */
const effectful = (checker, hfs, node) => decorators(checker, node).some((decorator) => decorator.called
    && decorator.args.length === 0 && ownedValue(checker, hfs, decorator.expression, "Effectful", "inbox"))

/** A package declaration establishes framework identity even through an import alias. */
const fromPackage = (checker, expression, name, pkg) => {
    const symbol = valueSymbol(checker, expression)
    return symbol?.name === name && symbol.getDeclarations()?.some((declaration) => moduleOf(declaration, declaration.getSourceFile().fileName) === pkg)
}

/** Class inheritance keeps the Nest Command identity without relying on local spelling. */
const commandType = (checker, type, seen = new Set()) => {
    if (!type || seen.has(type)) return false
    seen.add(type)
    if (originsOfType(checker, type).some((origin) => origin.name === "Command" && origin.module === "@nestjs/cqrs")) return true
    return type.isClassOrInterface() && (checker.getBaseTypes(type) ?? []).some((base) => commandType(checker, base, seen))
}

/** Required strings exclude optional properties, undefined, null and unconstrained types. */
const requiredString = (checker, type, property) => {
    const member = checker.getPropertyOfType(type, property)
    if (!member || member.flags & ts.SymbolFlags.Optional) return false
    const declaration = member.valueDeclaration ?? member.declarations?.[0]
    if (!declaration) return false
    const value = checker.getTypeOfSymbolAtLocation(member, declaration)
    return (value.isUnion() ? value.types : [value]).every((part) => !!(part.flags & ts.TypeFlags.StringLike))
}

/** Canonical ExecuteParams carries the request, while a direct client params object carries its own key. */
const keyContract = (checker, type) => {
    if (requiredString(checker, type, "idempotencyKey")) return true
    const request = checker.getPropertyOfType(type, "request")
    const declaration = request?.valueDeclaration ?? request?.declarations?.[0]
    return !!declaration && !(request.flags & ts.SymbolFlags.Optional)
        && requiredString(checker, checker.getTypeOfSymbolAtLocation(request, declaration), "idempotencyKey")
}

/** A sole returned expression admits an optional await and inline expression-bodied callbacks. */
const returned = (body) => {
    if (!body) return null
    let expression = ts.isBlock(body) ? body.statements.length === 1 && ts.isReturnStatement(body.statements[0]) ? body.statements[0].expression : null : body
    while (expression && ts.isParenthesizedExpression(expression)) expression = expression.expression
    return expression && ts.isAwaitExpression(expression) ? expression.expression : expression
}

/** Only a literal member name has a statically proved operation. */
const memberName = (expression) => ts.isPropertyAccessExpression(expression) ? expression.name.text : null

/** Computed literal names have ordinary last-write semantics; dynamic names could overwrite any field. */
const propertyName = (name) => ts.isComputedPropertyName(name)
    ? ts.isStringLiteralLike(name.expression) ? name.expression.text : null
    : ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : null

/** Property mappings retain their last assignment, including spreads, as JavaScript does. */
const propertyValue = (checker, expression, name) => {
    if (!expression) return null
    if (!ts.isObjectLiteralExpression(expression)) return checker.getPropertyOfType(checker.getTypeAtLocation(expression), name) ? { base: expression, name } : null
    let result = null
    for (const property of expression.properties) {
        if (ts.isSpreadAssignment(property)) {
            const type = checker.getTypeAtLocation(property.expression)
            if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || checker.getIndexTypeOfType(type, ts.IndexKind.String)) result = null
            else if (checker.getPropertyOfType(type, name)) result = { base: property.expression, name }
        } else if (propertyName(property.name) === null) result = null
        else if (propertyName(property.name) === name) {
            result = ts.isPropertyAssignment(property) ? { expression: property.initializer }
                : ts.isShorthandPropertyAssignment(property) ? { expression: property.name } : null
        }
    }
    return result
}

/** A property path is rooted in the same lexical parameter, so a renamed or shadowed value cannot invent a key. */
const parameterPath = (checker, expression, parameter) => {
    const path = []
    let current = expression
    while (current && ts.isPropertyAccessExpression(current) && !current.questionDotToken) {
        path.unshift(current.name.text)
        current = current.expression
    }
    return current && ts.isIdentifier(current) && valueSymbol(checker, current) === valueSymbol(checker, parameter.name) ? path : null
}

/** A mapped field has the expected path from the original parameter. */
const mappedFrom = (checker, mapping, parameter, paths) => {
    if (!mapping) return false
    const path = parameterPath(checker, mapping.expression ?? mapping.base, parameter)
    if (!path) return false
    if (mapping.name) path.push(mapping.name)
    return paths.some((expected) => path.length === expected.length && path.every((part, index) => part === expected[index]))
}

/** Type origins bind the transactional manager and inbox port to their actual owners. */
const hasOrigin = (checker, hfs, expression, name, pkg, capability) => !!expression && originsOfType(checker, checker.getTypeAtLocation(expression)).some((origin) =>
    origin.name === name && origin.module === pkg && (!capability || hfs.tierOf(origin.file) === "platform" && ownerNameOf(hfs, origin.file) === capability))

/** Rejects visible calls, writes, constructions and explicit getter accesses before the inbox claim. */
const pureEnvelope = (checker, expression) => {
    let pure = true
    const visit = (node) => {
        if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node)
            || ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
            || ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
            || ts.isPostfixUnaryExpression(node)) pure = false
        if (ts.isPropertyAccessExpression(node) && valueSymbol(checker, node)?.getDeclarations()?.some(ts.isGetAccessorDeclaration)) pure = false
        ts.forEachChild(node, visit)
    }
    visit(expression)
    return pure
}

/** The service returns its transaction, whose actual callback returns the inbox execution with that callback's own manager. */
const transactionalClient = (checker, hfs, method) => {
    const transaction = returned(method.body)
    if (!transaction || !ts.isCallExpression(transaction) || transaction.questionDotToken || transaction.expression.questionDotToken || memberName(transaction.expression) !== "transaction"
        || !hasOrigin(checker, hfs, transaction.expression.expression, "EntityManager", "typeorm")) return false
    const first = transaction.arguments[0]
    const callback = transaction.arguments.length === 1 ? first : transaction.arguments.length === 2
        && ts.isStringLiteral(first) && ["READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"].includes(first.text) ? transaction.arguments[1] : null
    if (!callback || ![ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression].includes(callback.kind)
        || callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)) return false
    const execution = returned(callback.body)
    if (!execution || !ts.isCallExpression(execution) || execution.questionDotToken || execution.expression.questionDotToken || memberName(execution.expression) !== "runClient"
        || !hasOrigin(checker, hfs, execution.expression.expression, "Inbox", null, "inbox") || execution.arguments.length !== 3) return false
    const [envelope, manager, effect] = execution.arguments
    const original = method.parameters[0]
    if (!original || !ts.isIdentifier(original.name) || !requiredString(checker, checker.getTypeAtLocation(original), "idempotencyKey")
        || !ts.isIdentifier(manager) || valueSymbol(checker, manager) !== valueSymbol(checker, callback.parameters[0].name)
        || !hasOrigin(checker, hfs, manager, "EntityManager", "typeorm") || !ts.isObjectLiteralExpression(envelope)
        || ![ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression].includes(effect.kind) || effect.parameters.length !== 0
        || !pureEnvelope(checker, envelope)) return false
    const key = propertyValue(checker, envelope, "idempotencyKey")
    const principal = propertyValue(checker, envelope, "principalId")
    const operation = propertyValue(checker, envelope, "operation")?.expression
    return mappedFrom(checker, key, original, [["idempotencyKey"]]) && !!principal?.expression
        && (parameterPath(checker, principal.expression, original)?.length ?? 0) > 0
        && !!operation && ts.isStringLiteralLike(operation) && operation.text.length > 0
        && !!propertyValue(checker, envelope, "request")
}

/** The CommandHandler decorator resolves its marked command declaration. */
const handledCommand = (checker, hfs, node) => {
    for (const decorator of decorators(checker, node)) {
        if (!fromPackage(checker, decorator.expression, "CommandHandler", "@nestjs/cqrs") || decorator.args.length !== 1) continue
        const command = valueSymbol(checker, decorator.args[0])?.getDeclarations()?.find(ts.isClassDeclaration)
        if (command && effectful(checker, hfs, command)) return command
    }
    return null
}

/** A marked handler delegates once to a concrete domain service and preserves the request's key. */
const delegatedMethod = (checker, hfs, handler) => {
    const process = handler.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText() === "process")
    const call = returned(process?.body)
    if (!process || process.parameters.length !== 1 || !ts.isIdentifier(process.parameters[0].name)
        || !call || !ts.isCallExpression(call) || call.questionDotToken || call.expression.questionDotToken || call.arguments.length !== 1) return null
    const method = checker.getResolvedSignature(call)?.declaration
    if (!method || !ts.isMethodDeclaration(method) || !method.body
        || hfs.tierOf(method.getSourceFile().fileName) !== "domain" || !baseName(method.getSourceFile().fileName).endsWith(".service.ts")) return null
    const mapping = propertyValue(checker, call.arguments[0], "idempotencyKey")
    return mappedFrom(checker, mapping, process.parameters[0], [["params", "idempotencyKey"], ["params", "request", "idempotencyKey"]]) ? method : null
}

/** Every reached service method is judged when that file is linted, including changed domain files. */
const reachedByProgram = new WeakMap()
const reachedServices = (checker, program, hfs) => {
    const cached = reachedByProgram.get(program)
    if (cached) return cached
    const methods = new Set()
    for (const source of program.getSourceFiles()) {
        if (hfs.slotOf(source.fileName) !== "be.feature.application") continue
        const visit = (node) => {
            if (ts.isClassDeclaration(node) && handledCommand(checker, hfs, node)) {
                const method = delegatedMethod(checker, hfs, node)
                if (method) methods.add(method)
            }
            ts.forEachChild(node, visit)
        }
        visit(source)
    }
    reachedByProgram.set(program, methods)
    return methods
}

/** Genuine validators must reject empty, optional and overlong wire keys. */
const boundedKey = (checker, declaration) => {
    if (!declaration || !ts.isPropertyDeclaration(declaration) || declaration.questionToken
        || propertyName(declaration.name) === null
        || !requiredString(checker, checker.getTypeAtLocation(declaration.parent), propertyName(declaration.name))) return false
    const validators = decorators(checker, declaration).filter((decorator) => decorator.called && decorator.symbol?.getDeclarations()?.some((item) => moduleOf(item, item.getSourceFile().fileName) === "class-validator"))
    const has = (name) => validators.some((decorator) => decorator.symbol.name === name)
    const bound = (name, accepts) => validators.some((decorator) => decorator.symbol.name === name
        && decorator.args.length > 0 && ts.isNumericLiteral(decorator.args[0]) && accepts(Number(decorator.args[0].text)))
    return !has("IsOptional") && !has("ValidateIf") && (has("IsUUID") || has("IsString")
        && bound("MinLength", (value) => value >= 1) && bound("MaxLength", (value) => value >= 1 && value <= 64))
}

/** Follow object mappings to their original property declarations rather than trusting an annotated return type. */
const propertySymbol = (checker, expression, path) => {
    if (path.length === 0) return valueSymbol(checker, expression)
    if (ts.isObjectLiteralExpression(expression)) {
        const mapping = propertyValue(checker, expression, path[0])
        if (!mapping) return undefined
        return mapping.expression ? propertySymbol(checker, mapping.expression, path.slice(1))
            : propertySymbol(checker, mapping.base, [mapping.name, ...path.slice(1)])
    }
    let type = checker.getTypeAtLocation(expression)
    let symbol
    for (const name of path) {
        symbol = checker.getPropertyOfType(type, name)
        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
        if (!declaration) return undefined
        type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    }
    return symbol
}

/** A key mapped by a pure function must come from its actual argument, never a constant or captured replacement. */
const mappedKeySymbol = (checker, mapping, bindings = new Map()) => {
    if (!mapping) return undefined
    const path = mapping.name ? [mapping.name] : []
    let expression = mapping.expression ?? mapping.base
    while (ts.isPropertyAccessExpression(expression) && !expression.questionDotToken) {
        path.unshift(expression.name.text)
        expression = expression.expression
    }
    const actual = bindings.get(valueSymbol(checker, expression))
    if (actual) return propertySymbol(checker, actual, path)
    return bindings.size > 0 ? undefined : propertySymbol(checker, expression, path)
}

/** A mapper is proved by its sole pure return expression and original argument bindings, not its function name. */
const requestKey = (checker, expression) => {
    if (!ts.isCallExpression(expression)) return mappedKeySymbol(checker, propertyValue(checker, expression, "idempotencyKey"))
    const mapper = checker.getResolvedSignature(expression)?.declaration
    const body = returned(mapper?.body)
    if (!mapper || !body || expression.questionDotToken || mapper.parameters.length !== expression.arguments.length
        || mapper.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
        || !pureEnvelope(checker, body) || expression.arguments.some((argument) => !pureEnvelope(checker, argument))) return undefined
    const bindings = new Map()
    for (const [index, parameter] of mapper.parameters.entries()) {
        if (!ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken) return undefined
        bindings.set(valueSymbol(checker, parameter.name), expression.arguments[index])
    }
    return mappedKeySymbol(checker, propertyValue(checker, body, "idempotencyKey"), bindings)
}

/** Follow the constructor's key mapping to the original DTO property, including a whole ExecuteParams value. */
const constructionKey = (checker, construction) => {
    const params = construction.arguments?.[0]
    const request = propertyValue(checker, params, "request")
    let nestedSymbol
    if (request?.base) {
        const property = checker.getPropertyOfType(checker.getTypeAtLocation(request.base), request.name)
        const declaration = property?.valueDeclaration ?? property?.declarations?.[0]
        if (declaration) nestedSymbol = checker.getPropertyOfType(checker.getTypeOfSymbolAtLocation(property, declaration), "idempotencyKey")
    }
    return nestedSymbol ?? (request?.expression ? requestKey(checker, request.expression)
        : mappedKeySymbol(checker, propertyValue(checker, params, "idempotencyKey")))
}

/** Only DTO key declarations that reach an effectful command carry this rule's transport obligation. */
const keysByProgram = new WeakMap()
const reachedKeys = (checker, program, hfs) => {
    const cached = keysByProgram.get(program)
    if (cached) return cached
    const keys = new Set()
    for (const source of program.getSourceFiles()) {
        if (!isTransportSlot(hfs.slotOf(source.fileName))) continue
        const visit = (node) => {
            if (ts.isNewExpression(node)) {
                const command = valueSymbol(checker, node.expression)?.getDeclarations()?.find(ts.isClassDeclaration)
                if (command && effectful(checker, hfs, command)) {
                    for (const declaration of constructionKey(checker, node)?.getDeclarations() ?? []) keys.add(declaration)
                }
            }
            ts.forEachChild(node, visit)
        }
        visit(source)
    }
    keysByProgram.set(program, keys)
    return keys
}

/** Effectful commands carry a bounded client key to the one atomic domain inbox execution. */
export const mutationIdempotent = {
    meta: {
        type: "problem",
        docs: { description: "An @Effectful command requires a validated client key and delegates to a domain transaction returning Inbox.runClient with that same key and manager." },
        schema: [],
        messages: {
            marker: "[BE_MUTATION_IDEMPOTENT] Use @Effectful() exported by platform/inbox on a Nest Command; a local lookalike or a marker on a query does not designate an effectful command.",
            declaration: "[BE_MUTATION_IDEMPOTENT] This @Effectful command requires idempotency in hfs.json sides.be.patterns, including its required behavior scenarios in the app's proof lane.",
            key: "[BE_MUTATION_IDEMPOTENT] This @Effectful command requires a non-optional string idempotencyKey in its params request. Preserve the client's key through transport and handler mapping.",
            handler: "[BE_MUTATION_IDEMPOTENT] This effectful command handler must return one domain service call carrying the original params.request.idempotencyKey. The service owns its transaction and the inbox claim.",
            transaction: "[BE_MUTATION_IDEMPOTENT] This effectful domain method must return an EntityManager transaction whose inline callback returns Inbox.runClient({principalId, operation, idempotencyKey, request}, callbackManager, async () => outcome). Use the original key and callback manager, and put every effect in the final callback.",
            validation: "[BE_MUTATION_IDEMPOTENT] The client idempotencyKey must be required and validated by class-validator: @IsUUID(), or @IsString() @MinLength(1) @MaxLength(64). Optional or conditional validation cannot protect an effectful command.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const slot = hfs.slotOf(context.filename)
        if (!slot || slot.startsWith("be.tests.")) return {}
        const { checker, program, toTs } = typed(context)
        let reached
        let keys
        return {
            Identifier(node) {
                if (hfs.tierOf(context.filename) === "platform" && ownerNameOf(hfs, context.filename) === "inbox"
                    || !ownedValue(checker, hfs, toTs(node), "Effectful", "inbox")) return
                const parent = node.parent
                const typeOnly = parent?.type?.startsWith("TS") && !["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "TSSatisfiesExpression", "TSInstantiationExpression"].includes(parent.type)
                if (["ImportSpecifier", "ExportSpecifier", "Decorator"].includes(parent?.type) || typeOnly) return
                if (parent?.type === "VariableDeclarator" && parent.id === node) return
                if (parent?.type === "Property" && parent.key === node && !parent.computed && parent.value !== node) return
                const reference = parent?.type === "MemberExpression" && parent.property === node ? parent : node
                if (reference.parent?.type === "CallExpression" && reference.parent.callee === reference) return
                if (reference.parent?.type === "VariableDeclarator" && reference.parent.init === reference && reference.parent.parent.kind === "const") return
                context.report({ node, messageId: "marker" })
            },
            CallExpression(node) {
                const call = toTs(node)
                if (ownedValue(checker, hfs, call.expression, "Effectful", "inbox") && node.parent?.type !== "Decorator") context.report({ node, messageId: "marker" })
            },
            ClassDeclaration(node) {
                const declaration = toTs(node)
                const marks = decorators(checker, declaration).filter((decorator) => decorator.symbol?.name === "Effectful")
                if (marks.length > 0) {
                    if (!effectful(checker, hfs, declaration) || !commandType(checker, checker.getTypeAtLocation(declaration))) {
                        context.report({ node: node.id ?? node, messageId: "marker" })
                    } else {
                        if (!(hfs.patterns ?? []).includes("idempotency")) context.report({ node: node.id ?? node, messageId: "declaration" })
                        const constructor = declaration.members.find(ts.isConstructorDeclaration)
                        if (!constructor || constructor.parameters.length !== 1 || !keyContract(checker, checker.getTypeAtLocation(constructor.parameters[0]))) context.report({ node: node.id ?? node, messageId: "key" })
                    }
                }
                if (!handledCommand(checker, hfs, declaration)) return
                const method = delegatedMethod(checker, hfs, declaration)
                if (!method) context.report({ node: node.id ?? node, messageId: "handler" })
                else if (!transactionalClient(checker, hfs, method)) context.report({ node: node.id ?? node, messageId: "transaction" })
            },
            MethodDefinition(node) {
                if (hfs.tierOf(context.filename) !== "domain" || !baseName(context.filename).endsWith(".service.ts")) return
                reached ??= reachedServices(checker, program, hfs)
                const method = toTs(node)
                if (reached.has(method) && !transactionalClient(checker, hfs, method)) context.report({ node: node.key, messageId: "transaction" })
            },
            PropertyDefinition(node) {
                if (!isTransportSlot(slot)) return
                keys ??= reachedKeys(checker, program, hfs)
                const declaration = toTs(node)
                if (keys.has(declaration) && !boundedKey(checker, declaration)) context.report({ node: node.key, messageId: "validation" })
            },
            NewExpression(node) {
                if (!isTransportSlot(slot)) return
                const construction = toTs(node)
                const command = valueSymbol(checker, construction.expression)?.getDeclarations()?.find(ts.isClassDeclaration)
                if (!command || !effectful(checker, hfs, command)) return
                const declarations = constructionKey(checker, construction)?.getDeclarations() ?? []
                const localProperty = declarations.some((declaration) => ts.isPropertyDeclaration(declaration) && declaration.getSourceFile() === construction.getSourceFile())
                if (!localProperty && !declarations.some((declaration) => boundedKey(checker, declaration))) context.report({ node, messageId: "validation" })
            },
        }
    },
}
