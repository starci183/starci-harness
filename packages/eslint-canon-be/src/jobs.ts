/**
 * The rules that hold the fenced-job pattern (catalog R157 `BE_JOB_WRITE_OUTSIDE_OWNER`, R158 `BE_JOB_FENCE_REQUIRED`,
 * R159 `BE_JOB_EFFECT_PIECE`, R160 `BE_JOB_SHAPE`, R403 `BE_JOB_NEXT_DECLARED`, R404 `BE_JOB_PROGRESS_SHAPE`).
 *
 * A job is a step of a chain: a row whose `fencingToken` the claim bumps, declared once with `defineJob`. A worker that lost its claim (a
 * zombie) holds a stale token, so every write to the row is guarded by `expectedFencingToken`, and every outside act goes through the
 * effects piece, which commits an intent row before the act. `platform/jobs` is the ONE owner of the row: it declares the entity, the claim
 * and the guarded writes, and nothing else writes it.
 *
 * Everything is found by TYPE ORIGIN (the `JobClaims`, `JobStep`, `ClaimedJob`, `JobProgressTopic`, `defineJob` and `FencedProcessor`
 * declared by `platform/jobs`, the `Effects` port of `platform/effects`, the `RealtimeHub` of `platform/realtime`, the entity class
 * declared by that owner, typeorm receivers and query builders) and by the slot view (`be.feature.jobs.steps`, `be.feature.jobs`,
 * `be.queues`); the only names read are the contract's own members `once` (with its `act` and `confirm`), `next`, `progress`, `topic`,
 * `jobId` and `expectedFencingToken`.
 */
import ts from "typescript"
import { keyName, walk } from "./lib/ast.ts"
import { writtenEntityOrigins } from "./lib/entity-writes.ts"
import { hfsOf, inTestWorld } from "./lib/hfs.ts"
import { baseName, isOwnedType, ownerNameOf } from "./lib/ports.ts"
import { originsOfType, resolvedSymbol, typeOrigins, typed } from "./lib/types.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import type { Context, Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"
import type { HfsView } from "./lib/hfs.ts"

const isJobClaimsType = (context: Context, node: Node): boolean => isOwnedType(context, node, { name: "JobClaims", capability: "jobs", tier: "platform" })
const isJobStepType = (context: Context, node: Node): boolean => isOwnedType(context, node, { name: "JobStep", capability: "jobs", tier: "platform" })
const isFencedProcessorType = (context: Context, node: Node): boolean => isOwnedType(context, node, { name: "FencedProcessor", capability: "jobs", tier: "platform" })
const isClaimedJobType = (context: Context, node: Node): boolean => isOwnedType(context, node, { name: "ClaimedJob", capability: "jobs", tier: "platform" })
const isEffectsType = (context: Context, node: Node): boolean => isOwnedType(context, node, { name: "Effects", capability: "effects", tier: "platform" })
const isRealtimeHubType = (context: Context, node: Node): boolean => isOwnedType(context, node, { name: "RealtimeHub", capability: "realtime", tier: "platform" })

/** The contract's own members and types the rules below read. */
const ONCE = "once"
const ACT = "act"
const CONFIRM = "confirm"
const NEXT = "next"
const PROGRESS = "progress"
const TOPIC = "topic"
const DEFINE_JOB = "defineJob"
const PROGRESS_TOPIC = "JobProgressTopic"

/** True for a file of the owner itself, and for the test composition. */
const isOwnerOrTest = (hfs: HfsView, file: string): boolean => {
    const tier = hfs.tierOf(file)
    if (tier === "e2e" || tier === "fixtures" || inTestWorld(hfs, file)) return true
    return tier === "platform" && ownerNameOf(hfs, file) === "jobs"
}

/** A write to an entity that `platform/jobs` declares (the job row) is made only by `platform/jobs`. */
export const jobWriteOwner: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "The job entity is written only by `platform/jobs`: no `update`, `increment`, `save`, `insert`, `delete` or query-builder write on it elsewhere." },
        schema: [],
        messages: {
            foreign: "`{{call}}` writes the job row outside `platform/jobs`. The fencing token and the status of a job change only through `JobClaims` (`claim`, `advance`, `complete`, `fail`), each of which requires `expectedFencingToken`; a direct write lets a zombie worker overwrite the job a newer worker owns.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        if (isOwnerOrTest(hfs, context.filename)) return {}
        return {
            CallExpression(node) {
                const origins = writtenEntityOrigins(context, node)
                if (!origins.some((origin) => hfs.tierOf(origin.file) === "platform" && ownerNameOf(hfs, origin.file) === "jobs" && hfs.slotOf(origin.file) === "be.persistence")) return
                context.report({ node, messageId: "foreign", data: { call: context.sourceCode.getText(node.callee) } })
            },
        }
    },
}

/** The names the guarded-write contract fixes: the target job and the token the writer holds. */
const TARGET = "jobId"
const TOKEN = "expectedFencingToken"
/** The property of a claimed job that holds the token it carries. */
const CARRIED = "fencingToken"

/** A property of a TypeScript type by name, or undefined. */
const propertyOf = (type: ts.Type, name: string): ts.Symbol | undefined => type.getProperty(name)

/** True when the property is a required `number`. */
const isRequiredNumber = (checker: ts.TypeChecker, property: ts.Symbol | undefined, location: ts.Node): boolean => {
    if (!property || (property.flags & ts.SymbolFlags.Optional) !== 0) return false
    const type = checker.getTypeOfSymbolAtLocation(property, location)
    return (type.flags & ts.TypeFlags.Number) !== 0
}

/** Calls on the `JobClaims` port, and what a guarded write is: required token, no cast to get around it, and `JobFencedOut` is not swallowed. */
export const jobFenceRequired: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Every `JobClaims` method that writes an existing job declares a required `expectedFencingToken: number`, a call never casts around it, and a `catch` around a guarded write rethrows." },
        schema: [],
        messages: {
            optionalToken: "`{{method}}` takes a job (`{{target}}`) but its parameter type does not require `{{token}}: number`. Every write to an existing job is guarded by the fencing token the caller holds: declare it required (non-optional, non-nullable) in the type.",
            cast: "This argument of `{{call}}` uses a cast or a non-null assertion. The token a guarded write carries is the one the claim returned: pass it as typed, never `as`, `!` or `any` around it.",
            swallowed: "This `catch` hides a failed guarded write: a `JobFencedOut` means a newer worker owns the job and this one must stop with no further effect. Do not catch around `JobClaims` writes in a step or processor; the `FencedProcessor` base class owns the failure path. Rethrow if you must catch.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const owner = isOwnerOrTest(hfs, context.filename)
        const { checker, toTs } = typed(context)
        const claimsCall = (node: Node): boolean => node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed && isJobClaimsType(context, node.callee.object)
        return {
            // The declaration side: in the owner, each member of the port that takes a job requires the token.
            TSMethodSignature(node) {
                const holder = node.parent.parent
                const holderId = holder && "id" in holder ? holder.id : undefined
                if (!owner || hfs.tierOf(context.filename) !== "platform" || !isJobClaimsType(context, holderId ?? node.parent)) return
                const first = node.params?.[0]
                if (!first) return
                const tsNode = toTs(first)
                const type = tsNode ? checker.getTypeAtLocation(tsNode) : undefined
                // A parameter that already carries the token (the claimed job itself) is a derivation, not a write.
                if (!type || !propertyOf(type, TARGET) || propertyOf(type, CARRIED)) return
                if (!isRequiredNumber(checker, propertyOf(type, TOKEN), tsNode)) {
                    const methodName = node.key && "name" in node.key ? node.key.name : undefined
                    context.report({ node: first, messageId: "optionalToken", data: { method: methodName ?? "this method", target: TARGET, token: TOKEN } })
                }
            },
            CallExpression(node) {
                if (owner || !claimsCall(node)) return
                for (const argument of node.arguments) {
                    walk(argument, (child) => {
                        if (child.type === "TSAsExpression" || child.type === "TSTypeAssertion" || child.type === "TSNonNullExpression") context.report({ node: child, messageId: "cast", data: { call: context.sourceCode.getText(node.callee) } })
                    })
                }
            },
            TryStatement(node) {
                if (owner || !node.handler) return
                let writes = false
                walk(node.block, (child) => { if (claimsCall(child)) writes = true })
                if (!writes) return
                let rethrows = false
                walk(node.handler.body, (child) => { if (child.type === "ThrowStatement") rethrows = true })
                if (!rethrows) context.report({ node: node.handler, messageId: "swallowed" })
            },
        }
    },
}

/** True for a function node that takes a `ClaimedJob`: the domain method a job's step calls. */
const takesClaimedJob = (context: Context, fn: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression): boolean =>
    fn.params.some((param) => {
        const target = param.type === "TSParameterProperty" ? param.parameter : param
        const bound = target.type === "AssignmentPattern" ? target.left : target
        return isClaimedJobType(context, bound)
    })

/** True when the node sits inside a function (or a closure of one) that takes a `ClaimedJob`. */
const insideJobFunction = (context: Context, node: Node): boolean => {
    for (let current: Node | undefined = node.parent; current; current = current.parent) {
        if ((current.type === "FunctionDeclaration" || current.type === "FunctionExpression" || current.type === "ArrowFunctionExpression") && takesClaimedJob(context, current)) return true
    }
    return false
}

/** True for `Effects.once(...)`: a call of `once` on the `Effects` port of `platform/effects`. */
const isEffectsOnce = (context: Context, call: TSESTree.CallExpression): boolean =>
    call.callee.type === "MemberExpression"
    && !call.callee.computed
    && call.callee.property.type === "Identifier"
    && call.callee.property.name === ONCE
    && isEffectsType(context, call.callee.object)

/**
 * True for a call of a function that `platform/effects` itself declares and that is handed the `Effects` port (a helper of the piece,
 * such as one that answers what the act answered): the piece runs the functions passed to it inside its own `Effects.once`.
 */
const isEffectsHelperCall = (context: Context, call: TSESTree.CallExpression): boolean => {
    if (!call.arguments.some((argument) => argument.type !== "SpreadElement" && isEffectsType(context, argument))) return false
    const hfs = hfsOf(context)
    const { checker, toTs } = typed(context)
    const target = toTs(call.callee.type === "MemberExpression" ? call.callee.property : call.callee)
    const symbol = resolvedSymbol(checker, target ? checker.getSymbolAtLocation(target) : undefined)
    return (symbol?.declarations ?? []).some((declaration) => {
        const file = String(declaration.getSourceFile().fileName).replace(/\\/g, "/")
        return hfs.tierOf(file) === "platform" && ownerNameOf(hfs, file) === "effects"
    })
}

/**
 * True when the expression is handed to the effects piece as an act or a confirm read: the value of `act` or `confirm` in the call
 * object of `Effects.once`, or a function argument of a helper of the piece.
 */
const isHandedToEffects = (context: Context, expression: Node): boolean => {
    const parent = expression.parent
    if (parent?.type === "CallExpression" && parent.arguments.includes(expression as TSESTree.CallExpressionArgument)) return isEffectsHelperCall(context, parent)
    if (parent?.type !== "Property" || parent.value !== expression) return false
    const key = keyName(parent.key)
    if (key !== ACT && key !== CONFIRM) return false
    const object = parent.parent
    const call = object?.parent
    return object?.type === "ObjectExpression" && call?.type === "CallExpression" && call.arguments.includes(object) && isEffectsOnce(context, call)
}

/**
 * True when the function is an act or a confirm read the effects piece runs: handed to it directly, or bound to a `const` whose every
 * use hands it to the piece (`const act = () => ...` then `{ act }`).
 */
const isEffectsAct = (context: Context, fn: Node): boolean => {
    if (isHandedToEffects(context, fn)) return true
    const declarator = fn.parent
    if (declarator?.type !== "VariableDeclarator" || declarator.init !== fn || declarator.id.type !== "Identifier") return false
    if (declarator.parent.type !== "VariableDeclaration" || declarator.parent.kind !== "const") return false
    const uses = context.sourceCode.getDeclaredVariables(declarator).flatMap((variable) => variable.references.filter((reference) => !reference.init))
    // A use that only calls it (`return act()`, a path with no job) makes no outside call of a job by itself; the rule judges the uses that hand it on.
    const handed = uses.filter((reference) => !(reference.identifier.parent.type === "CallExpression" && reference.identifier.parent.callee === reference.identifier))
    return handed.length > 0 && handed.every((reference) => isHandedToEffects(context, reference.identifier))
}

/** True when the call is an act or a confirm read the effects piece runs: inside a function handed to `Effects.once` or to a helper of the piece. */
const insideEffectCall = (context: Context, node: Node): boolean => {
    for (let current: Node | undefined = node.parent; current; current = current.parent) {
        if ((current.type === "FunctionExpression" || current.type === "ArrowFunctionExpression") && isEffectsAct(context, current)) return true
    }
    return false
}

/** The marker a port declares its outside reads with: `OutsideReads<"member" | ...>` of `platform/effects`. */
const OUTSIDE_READS = "OutsideReads"

/** True for the phantom property of `OutsideReads`, judged by where it is declared: the interface `platform/effects` declares. */
const isOutsideReadsMarker = (hfs: HfsView, property: ts.Symbol): boolean =>
    (property.declarations ?? []).some((declaration) => {
        const holder = declaration.parent
        if (!ts.isInterfaceDeclaration(holder) || holder.name.text !== OUTSIDE_READS) return false
        const file = String(declaration.getSourceFile().fileName).replace(/\\/g, "/")
        return hfs.tierOf(file) === "platform" && ownerNameOf(hfs, file) === "effects"
    })

/**
 * The members a port declares as outside READS: the string literals of the `OutsideReads` its type extends (an interface) or
 * implements (a class). A member the port does not declare is an act, so a forgotten declaration only makes the rule stricter.
 */
const declaredReads = (hfs: HfsView, checker: ts.TypeChecker, type: ts.Type): ReadonlySet<string> => {
    const reads = new Set<string>()
    const collect = (holder: ts.Type): void => {
        for (const property of checker.getPropertiesOfType(holder)) {
            if (!isOutsideReadsMarker(hfs, property)) continue
            const members = checker.getTypeOfSymbol(property)
            for (const part of members.isUnion() ? members.types : [members]) if (part.isStringLiteral()) reads.add(part.value)
        }
    }
    collect(type)
    for (const declaration of type.getSymbol()?.declarations ?? []) {
        if (!ts.isClassDeclaration(declaration)) continue
        for (const clause of declaration.heritageClauses ?? []) for (const implemented of clause.types) collect(checker.getTypeAtLocation(implemented))
    }
    return reads
}

/** True when the call is a member its port declares as an outside read (`OutsideReads`): a read has no intent to protect. */
const isDeclaredRead = (context: Context, callee: TSESTree.MemberExpression): boolean => {
    if (callee.property.type !== "Identifier") return false
    const { checker, toTs } = typed(context)
    const receiver = toTs(callee.object)
    if (!receiver) return false
    return declaredReads(hfsOf(context), checker, checker.getTypeAtLocation(receiver)).has(callee.property.name)
}

/** An outside call of a job is made by the effects piece: its intent row before the act, its result after. */
export const jobEffectPiece: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "In a job step, and in a function that takes a `ClaimedJob`, every call on an integration port that its port does not declare an outside read (`OutsideReads` of `platform/effects`) is the `act` or the `confirm` read of an `Effects.once` call of `platform/effects`." },
        schema: [],
        messages: {
            outside: "`{{call}}` is an outside call of a job made without the effects piece. An act outside the database (a provider call, a mail, a paid model call, a write to an index) goes through `Effects.once(key, effect, { act, confirm?, ... })` of `platform/effects`: its intent row is committed before the act and its result after, so a crash between them is settled as the effect declares (`repeatable`, `confirm` or `person`) and never acted twice blind. A member that only reads the outside world has no intent to protect: its port declares it in `OutsideReads<\"member\">` of `platform/effects` (an interface extends it, a class implements it); an undeclared member is an act.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const file = context.filename
        const inStep = hfs.slotOf(file) === "be.feature.jobs.steps"
        const inDomain = hfs.tierOf(file) === "domain"
        if (!inStep && !inDomain) return {}
        return {
            CallExpression(node) {
                const callee = node.callee
                if (callee.type !== "MemberExpression" || callee.computed) return
                if (!inStep && !insideJobFunction(context, node)) return
                const origins = typeOrigins(context, callee.object)
                if (!origins.some((origin) => origin.module === null && hfs.tierOf(origin.file) === "integrations")) return
                if (isDeclaredRead(context, callee) || insideEffectCall(context, node)) return
                context.report({ node, messageId: "outside", data: { call: context.sourceCode.getText(callee) } })
            },
        }
    },
}

/** The names of the jobs the `defineJob` calls of the program declare, read once per program. */
const declaredJobNames = (context: Context, hfs: HfsView): ReadonlySet<string> => {
    const { program, checker } = typed(context)
    const known = declaredNames.get(program)
    if (known) return known
    const names = new Set<string>()
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isDefineJobCall(hfs, checker, node)) {
            const name = propertyValue(node.arguments[0], "name")
            const type = name ? checker.getTypeAtLocation(name) : undefined
            if (type?.isStringLiteral()) names.add(type.value)
        }
        ts.forEachChild(node, visit)
    }
    for (const sourceFile of program.getSourceFiles()) {
        if (!sourceFile.isDeclarationFile && hfs.slotOf(sourceFile.fileName) === "be.queues") visit(sourceFile)
    }
    declaredNames.set(program, names)
    return names
}

/** The declared names per program: one scan serves every file linted in it. */
const declaredNames = new WeakMap<ts.Program, ReadonlySet<string>>()

/** The initializer of the property `name` in an object literal argument, or undefined. */
const propertyValue = (argument: ts.Node | undefined, name: string): ts.Expression | undefined => {
    if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined
    for (const property of argument.properties) {
        if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) return property.initializer
    }
    return undefined
}

/** True when a TypeScript call is `defineJob` of `platform/jobs`, judged by the declaration the callee resolves to. */
const isDefineJobCall = (hfs: HfsView, checker: ts.TypeChecker, call: ts.CallExpression): boolean => {
    const target = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression
    let symbol = checker.getSymbolAtLocation(target)
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol)
    return symbol?.getName() === DEFINE_JOB && (symbol.declarations ?? []).some((declaration) => {
        const owner = declaration.getSourceFile().fileName
        return hfs.tierOf(owner) === "platform" && ownerNameOf(hfs, owner) === "jobs"
    })
}

/** The `defineJob` calls of an ESTree program, with the object literal they declare. */
const isDefineJobNode = (context: Context, hfs: HfsView, node: TSESTree.CallExpression): boolean => {
    const { checker, toTs } = typed(context)
    const tsNode = toTs(node)
    return Boolean(tsNode) && ts.isCallExpression(tsNode) && isDefineJobCall(hfs, checker, tsNode)
}

/** The value node of a property of an object literal, by key. */
const memberOf = (object: TSESTree.ObjectExpression, name: string): TSESTree.Property | undefined =>
    object.properties.find((property): property is TSESTree.Property => property.type === "Property" && !property.computed && keyName(property.key) === name)

/** A job's `next` names only jobs a `defineJob` declares. */
export const jobNextDeclared: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "In a `defineJob` declaration `next` is an array literal of statically readable job names, each the name of a job a `defineJob` of the program declares." },
        schema: [],
        messages: {
            shape: "`next` of a job declaration is an array literal of job names. A computed, spread or variable list hides which jobs the job may enqueue, and the queue platform refuses an enqueue its `next` does not list; write the names out.",
            literal: "This `next` entry is not a statically readable job name (a string literal or an enum member). Name the job the way its own `defineJob` does, so the chain can be read from the declarations.",
            unknown: "`next` lists the job `{{name}}`, but no `defineJob` of the program declares a job of that name. A chain is the jobs the declarations name: declare the next job, or delete the entry.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        if (hfs.slotOf(context.filename) !== "be.queues") return {}
        const { checker, toTs } = typed(context)
        return {
            CallExpression(node) {
                if (!isDefineJobNode(context, hfs, node)) return
                const [declaration] = node.arguments
                if (declaration?.type !== "ObjectExpression") return
                const next = memberOf(declaration, NEXT)
                if (!next) return
                if (next.value.type !== "ArrayExpression") {
                    context.report({ node: next.value, messageId: "shape" })
                    return
                }
                const declared = declaredJobNames(context, hfs)
                for (const entry of next.value.elements) {
                    if (!entry || entry.type === "SpreadElement") {
                        context.report({ node: entry ?? next.value, messageId: "shape" })
                        continue
                    }
                    const tsEntry = toTs(entry)
                    const type = tsEntry ? checker.getTypeAtLocation(tsEntry) : undefined
                    if (!type?.isStringLiteral()) context.report({ node: entry, messageId: "literal" })
                    else if (!declared.has(type.value)) context.report({ node: entry, messageId: "unknown", data: { name: type.value } })
                }
            },
        }
    },
}

/** True when a type is a function type whose every return is `JobProgressTopic` of `platform/jobs`. */
const returnsProgressTopic = (checker: ts.TypeChecker, hfs: HfsView, type: ts.Type): boolean => {
    const signatures = type.getCallSignatures()
    return signatures.length > 0 && signatures.every((signature) =>
        originsOfType(checker, checker.getReturnTypeOfSignature(signature)).some((origin) =>
            origin.module === null && origin.name === PROGRESS_TOPIC && hfs.tierOf(origin.file) === "platform" && ownerNameOf(hfs, origin.file) === "jobs"))
}

/** A job's progress is a view the frame publishes: its topic is built principal-first, and no domain method publishes it itself. */
export const jobProgressShape: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A `defineJob` `progress.topic` is a function whose declared return type is `JobProgressTopic` of `platform/jobs` (principal first), and a function that takes a `ClaimedJob` never calls the `RealtimeHub`: it reports through `JobProgress`." },
        schema: [],
        messages: {
            topic: "The `progress.topic` of this job does not return a `JobProgressTopic` of `platform/jobs`. A progress topic is principal first, then the chain root, so a client can only read what its principal owns: build it with a function whose declared return type is `JobProgressTopic`, never an object literal or a string.",
            hub: "`{{call}}` publishes to the realtime hub from a function that takes a `ClaimedJob`. The progress of a job is a view the jobs frame publishes after commit: report step progress through `JobProgress.report(job, done, total, labelKey)`, which stores it on the job row first.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const file = context.filename
        const inQueues = hfs.slotOf(file) === "be.queues"
        const inDomain = hfs.tierOf(file) === "domain"
        if (!inQueues && !inDomain) return {}
        const { checker, toTs } = typed(context)
        return {
            CallExpression(node) {
                if (inQueues && isDefineJobNode(context, hfs, node)) {
                    const [declaration] = node.arguments
                    if (declaration?.type !== "ObjectExpression") return
                    const progress = memberOf(declaration, PROGRESS)
                    if (progress?.value.type !== "ObjectExpression") return
                    const topic = memberOf(progress.value, TOPIC)
                    const tsTopic = topic ? toTs(topic.value) : undefined
                    if (!topic || !tsTopic || !returnsProgressTopic(checker, hfs, checker.getTypeAtLocation(tsTopic))) context.report({ node: topic ?? progress.value, messageId: "topic" })
                    return
                }
                const callee = node.callee
                if (!inDomain || callee.type !== "MemberExpression" || callee.computed) return
                if (!isRealtimeHubType(context, callee.object) || !insideJobFunction(context, node)) return
                context.report({ node, messageId: "hub", data: { call: context.sourceCode.getText(callee) } })
            },
        }
    },
}

/** A processor extends the fenced base and is named after its job; a step implements `JobStep` in `steps/`. */
export const jobShape: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "`<job>.processor.ts` of `features/jobs/<job>/transport/queue/` declares a class extending `FencedProcessor`; `steps/<step>.step.ts` declares a class implementing `JobStep`; neither role exists elsewhere." },
        schema: [],
        messages: {
            processorPlacement: "`{{name}}` is in a `.processor.ts` file outside `features/jobs/<job>/transport/queue/`. A job processor lives only in the queue transport of its job, so the jobs kind stays one place.",
            processorStem: "The processor of job `{{job}}` is `{{job}}.processor.ts`, but this file is `{{stem}}.processor.ts`.",
            notFenced: "`{{name}}` is a job processor that does not extend `FencedProcessor` of `platform/jobs`. The base class claims the job with a bumped fencing token and settles it through the guarded writes; a processor without it has no fence.",
            stepPlacement: "`{{name}}` implements `JobStep` outside `features/jobs/<job>/steps/<step>.step.ts`.",
            notStep: "`{{name}}` is in a step file but does not implement `JobStep` of `platform/jobs`.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const file = context.filename
        const found = hfs.classify(file)
        const base = baseName(file)
        const isProcessorFile = base.endsWith(".processor.ts")
        const isStepFile = base.endsWith(".step.ts")
        const inJob = found.slot === "be.feature.jobs.queue"
        const inSteps = found.slot === "be.feature.jobs.steps"
        const inPlatform = hfs.tierOf(file) === "platform" && ownerNameOf(hfs, file) === "jobs"
        const check = (node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void => {
            const name = node.id?.name ?? "this class"
            const extendsFenced = node.superClass ? isFencedProcessorType(context, node.superClass) : false
            const implementsStep = (node.implements ?? []).some((entry) => isJobStepType(context, entry))
            if (isProcessorFile && !inPlatform) {
                if (!inJob) context.report({ node: node.id ?? node, messageId: "processorPlacement", data: { name } })
                else {
                    const stem = base.slice(0, -".processor.ts".length)
                    if (found.bindings?.job !== undefined && found.bindings.job !== stem) context.report({ node: node.id ?? node, messageId: "processorStem", data: { job: found.bindings.job, stem } })
                    if (!extendsFenced) context.report({ node: node.id ?? node, messageId: "notFenced", data: { name } })
                }
            }
            if (isStepFile) {
                if (!inSteps) context.report({ node: node.id ?? node, messageId: "stepPlacement", data: { name } })
                else if (!implementsStep) context.report({ node: node.id ?? node, messageId: "notStep", data: { name } })
            } else if (implementsStep && !inPlatform) context.report({ node: node.id ?? node, messageId: "stepPlacement", data: { name } })
        }
        return { ClassDeclaration: check, ClassExpression: check }
    },
}

export const rules = {
    "job-write-owner": jobWriteOwner,
    "job-fence-required": jobFenceRequired,
    "job-effect-piece": jobEffectPiece,
    "job-shape": jobShape,
    "job-next-declared": jobNextDeclared,
    "job-progress-shape": jobProgressShape,
} satisfies Rules

/** The level these laws ask for: `error`, switched off nowhere. */
export const recommended: Recommended = {
    "starci-be/job-write-owner": "error",
    "starci-be/job-fence-required": "error",
    "starci-be/job-effect-piece": "error",
    "starci-be/job-shape": "error",
    "starci-be/job-next-declared": "error",
    "starci-be/job-progress-shape": "error",
}
