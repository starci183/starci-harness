import path from 'node:path';
import type {
  CallExpression, ClassDeclaration, Declaration, Decorator, ExpressionWithTypeArguments, Modifier, Node, SourceFile,
  Statement, SyntaxKind, Symbol as TsSymbol, TypeChecker, TypeNode, TypeReferenceNode,
} from 'typescript';
import { isInside } from './config.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import { relativePath, unwrapExpression } from './typescript.mjs';
import type { TypeContext } from './type-context.mjs';
import { commonJsRequireReasons, constructedDecoratorKind, decoratorCallee, moduleExportsOf, mutableDecoratorKind, nodeDecorators, normalizedSymbol, normalizedSymbolValue, programSourcesOf, returnedExpressions, selectedNode, valueSymbol, violation } from './ast-walks.mjs';
import type { TraceOptions, Violation } from './ast-walks.mjs';
import { createBackendSourceShapeChecker } from './source-names-shape.mjs';
import type { ClassValueStatus, FrameworkBindings, GraphqlFieldInput, ObjectStatus, ShapeResult, SourceRole } from './source-names-shape.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

const SOURCE_LAYOUT_RULE_ID = 'BE_FEATURE_LAYOUT_INVALID';
const SOURCE_NAME_RULE_ID = 'BE_SOURCE_FORM';
const FRAMEWORK_EXPORTS = new Map([
  ['@nestjs/graphql', new Set(['Args', 'ArgsType', 'InputType', 'Mutation', 'ObjectType', 'Query', 'Subscription', 'registerEnumType'])],
  ['typeorm', new Set(['Entity', 'EntitySchema', 'MigrationInterface', 'ViewEntity'])],
]);
const APPLICATION_ROLES = new Set(['command', 'contracts', 'handler', 'query']);
const TRANSPORT_ROLES = new Set(['args', 'cli', 'consumer', 'controller', 'gateway', 'input', 'processor', 'request', 'resolver', 'response', 'type']);
const APPLICATION_LAYER_ROLES = new Set([...APPLICATION_ROLES, 'mapper']);
const TRANSPORT_LAYER_ROLES = new Set([...TRANSPORT_ROLES, 'enum', 'filter', 'guard', 'interceptor', 'mapper']);
// Class-bearing roles of the CLOSED suffix list of BE-CONVENTION 1.15 (class name = PascalCase of file + role). A role that is
// not in that list (adapter, exception, provider, repository, strategy, use-case) is never an allowed role here.
const CLASS_ROLE_SUFFIX = new Map([
  ['args', 'Args'], ['cli', 'Cli'], ['client', 'Client'], ['command', 'Command'], ['consumer', 'Consumer'],
  ['controller', 'Controller'], ['entity', 'Entity'], ['error', 'Error'], ['filter', 'Filter'], ['gateway', 'Gateway'],
  ['guard', 'Guard'], ['handler', 'Handler'], ['input', 'Input'], ['interceptor', 'Interceptor'], ['processor', 'Processor'], ['event', 'Event'], ['queue', 'Queue'],
  ['projection', 'Projection'], ['projection-entity', 'ProjectionEntity'], ['step', 'Step'], ['mapper', 'Mapper'], ['module', 'Module'], ['module-definition', 'Module'], ['policy', 'Policy'], ['query', 'Query'],
  ['request', 'Request'], ['resolver', 'Resolver'], ['response', 'Response'], ['service', 'Service'], ['type', 'Type'],
]);
// Transport object contracts (interfaces and object aliases) named by their file role: <Action>Input in *.input.ts,
// <Action>Request in *.request.ts, <Name>Row in *.rows.ts ... Domain values in *.contracts.ts and *.options.ts carry no suffix.
const TRANSPORT_OBJECT_SUFFIX = new Map([
  ['args', 'Args'], ['input', 'Input'], ['request', 'Request'], ['response', 'Response'], ['rows', 'Row'], ['type', 'Type'],
]);
// A class that implements an interface declared in a file with one of these roles may be named <Qualifier><InterfaceName>.
const PORT_DECLARATION_ROLES = new Set(['contracts', 'port']);
const NON_CLASS_ROLES = new Set(['constants', 'contracts', 'decorators', 'enum', 'providers', 'types']);
const KNOWN_HYPHEN_ROLES = [...CLASS_ROLE_SUFFIX.keys()].sort((a, b) => b.length - a.length);
const SPECIAL_BASENAMES = new Set(['config', 'configuration', 'constants', 'decorators', 'env', 'environment', 'index', 'main', 'types']);
const NO_PROGRAM_CHECKER = 'a TypeScript program checker could not be associated with its source';
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/i;

/** What `staticProperty` reads from an object literal: the literal string value, a dynamic or missing property. */
interface StaticProperty {
  status: 'dynamic' | 'missing' | 'literal';
  value?: string | undefined;
  node?: Node | undefined;
}

/** What the subscription naming walk reads for one source file. */
interface SubscriptionSource {
  config: ArchitectureConfig;
  context: TypeContext;
  sourceFile: SourceFile;
  checker: TypeChecker;
  framework: FrameworkBindings;
  configuredRoot: string | null;
  namingReasons: string[];
  violations: Violation[];
}

/** A node that carries a name (a declaration, a member, a parameter). */
const hasName = (node: Node): node is Node & { name: Node } => 'name' in node && Boolean(node.name);

/** The framework kind a symbol is bound to, or null. */
const kindOfSymbol = (targets: Map<TsSymbol, string>, symbol: TsSymbol | null | undefined): string | null => (symbol ? targets.get(symbol) ?? null : null);

function absoluteRoots(root: string, relatives: string[]): string[] {
  return relatives.map(relative => path.resolve(root, ...relative.split('/')));
}

function canonical(file: string): string {
  return path.resolve(file);
}

function addFrameworkTargets(config: ArchitectureConfig, context: TypeContext, checker: TypeChecker, sourceFile: SourceFile, statement: Statement, bySymbol: Map<TsSymbol, string>, reasons: string[]): void {
  const bound = moduleExportsOf(context.ts, checker, statement);
  const selected = bound ? FRAMEWORK_EXPORTS.get(bound.specifier) : undefined;
  if (!bound || !selected) return;
  if (!bound.symbol) {
    reasons.push(`${relativePath(config.root, sourceFile.fileName)} cannot resolve ${bound.specifier}`);
    return;
  }
  for (const [name, target] of bound.exports) if (selected.has(name) && target) bySymbol.set(target, name);
}

function frameworkTargets(config: ArchitectureConfig, context: TypeContext, checker: TypeChecker, localFiles: Set<string>): FrameworkBindings {
  const reasons: string[] = [];
  const bySymbol = new Map<TsSymbol, string>();
  const files = programSourcesOf(context, checker, localFiles);
  if (!files) return { bySymbol, reasons: [NO_PROGRAM_CHECKER] };
  for (const sourceFile of files) {
    for (const statement of sourceFile.statements) {
      addFrameworkTargets(config, context, checker, sourceFile, statement, bySymbol, reasons);
    }
    commonJsRequireReasons(context.ts, checker, sourceFile, (specifier) => FRAMEWORK_EXPORTS.has(specifier),
      reasons, relativePath(config.root, sourceFile.fileName), 'binding whose source role cannot be proved');
  }
  return { bySymbol, reasons };
}

function decoratorKind(ts: TypeScriptApi, checker: TypeChecker, decorator: Decorator, targets: Map<TsSymbol, string>): string | null {
  const selected = selectedNode(ts, decoratorCallee(ts, decorator));
  return selected ? kindOfSymbol(targets, valueSymbol(ts, checker, selected)) : null;
}

/* This module's trace descends `new X()` callees too; the framework map keys symbols directly. */
const TRACE_NEW: TraceOptions = { newExpression: true };

function hasModifier(ts: TypeScriptApi, node: Node, kind: SyntaxKind): boolean {
  // a TypeScript older than canHaveModifiers keeps the modifiers on the node itself
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : (node as Node & { modifiers?: readonly Modifier[] }).modifiers ?? []).some(modifier => modifier.kind === kind);
}



function sourceRole(ts: TypeScriptApi, sourceFile: SourceFile): SourceRole {
  const file = path.basename(sourceFile.fileName).replace(SOURCE_EXTENSION, '');
  const base = file.replace(/\.(?:int-)?spec$/i, '');
  const segments = base.split('.');
  if (segments.length > 1) return { base, role: segments.at(-1)?.toLowerCase() ?? null, spec: base !== file };
  const lower = base.toLowerCase();
  const known = KNOWN_HYPHEN_ROLES.find(role => lower === role || lower.endsWith(`-${role}`));
  if (known) return { base, role: known, spec: base !== file };
  const topLevel = sourceFile.statements;
  if (topLevel.some(statement => ts.isEnumDeclaration(statement))) return { base, role: 'enum', spec: base !== file };
  return { base, role: null, spec: base !== file };
}

function kebabSourceBase(base: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(base);
}

function exportedDeclarations(ts: TypeScriptApi, checker: TypeChecker, sourceFile: SourceFile): Set<Declaration> {
  const exported = new Set<Declaration>();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  for (const symbol of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
    const target = normalizedSymbolValue(ts, checker, symbol);
    for (const declaration of target?.getDeclarations?.() ?? []) if (declaration.getSourceFile() === sourceFile) exported.add(declaration);
  }
  return exported;
}

function combineClassValue(results: ClassValueStatus[]): ClassValueStatus {
  if (results.some(result => result.status === 'unavailable')) return { status: 'unavailable', names: [] };
  const classes = results.filter(result => result.status === 'class');
  if (!classes.length) return { status: 'not-class', names: [] };
  if (classes.length !== results.length) return { status: 'unavailable', names: [] };
  return { status: 'class', names: [...new Set(classes.flatMap(result => result.names))] };
}

function pushReturnedClassStatuses(ts: TypeScriptApi, checker: TypeChecker, results: ClassValueStatus[], container: Node, nextSeen: Set<TsSymbol>, depth: number): void {
  for (const returned of returnedExpressions(ts, container)) results.push(classValueStatus(ts, checker, returned, nextSeen, depth + 1));
}

function classDeclarationResults(ts: TypeScriptApi, checker: TypeChecker, expression: Node, declaration: Declaration, nextSeen: Set<TsSymbol>, depth: number): ClassValueStatus[] {
  const results: ClassValueStatus[] = [];
  if (ts.isClassDeclaration(declaration)) results.push({ status: 'class', names: declaration.name ? [declaration.name.text] : [] });
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (ts.isCallExpression(expression)
      && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
      pushReturnedClassStatuses(ts, checker, results, declaration.initializer, nextSeen, depth);
    } else results.push(classValueStatus(ts, checker, declaration.initializer, nextSeen, depth + 1));
  }
  if (ts.isCallExpression(expression)) pushReturnedClassStatuses(ts, checker, results, declaration, nextSeen, depth);
  return results;
}

function classSymbolStatus(ts: TypeScriptApi, checker: TypeChecker, expression: Node, seen: Set<TsSymbol>, depth: number): ClassValueStatus {
  const selected = selectedNode(ts, ts.isCallExpression(expression) ? expression.expression : expression);
  const symbol = selected ? normalizedSymbol(ts, checker, selected) : null;
  if (!symbol || seen.has(symbol)) return { status: 'not-class', names: [] };
  const nextSeen = new Set(seen).add(symbol);
  const results: ClassValueStatus[] = [];
  for (const declaration of symbol.getDeclarations?.() ?? []) results.push(...classDeclarationResults(ts, checker, expression, declaration, nextSeen, depth));
  return results.length ? combineClassValue(results) : { status: 'not-class', names: [] };
}

function classValueStatus(ts: TypeScriptApi, checker: TypeChecker, expression: Node | null | undefined, seen: Set<TsSymbol> = new Set(), depth = 0): ClassValueStatus {
  if (!expression) return { status: 'not-class', names: [] };
  if (depth > 10) return { status: 'unavailable', names: [] };
  const unwrapped: Node = unwrapExpression(ts, expression);
  if (ts.isClassExpression(unwrapped)) return { status: 'class', names: unwrapped.name ? [unwrapped.name.text] : [] };
  if (ts.isConditionalExpression(unwrapped)) return combineClassValue([
    classValueStatus(ts, checker, unwrapped.whenTrue, seen, depth + 1),
    classValueStatus(ts, checker, unwrapped.whenFalse, seen, depth + 1),
  ]);
  return classSymbolStatus(ts, checker, unwrapped, seen, depth);
}

function combineObjectStatus(statuses: ObjectStatus[]): ObjectStatus {
  if (statuses.includes('object')) return 'object';
  if (statuses.includes('unavailable')) return 'unavailable';
  return 'not-object';
}

function declarationObjectStatus(ts: TypeScriptApi, checker: TypeChecker, declaration: Declaration, seen: Set<TsSymbol>, depth: number): ObjectStatus {
  if (ts.isInterfaceDeclaration(declaration)) return 'object';
  if (ts.isTypeAliasDeclaration(declaration)) return objectTypeStatus(ts, checker, declaration.type, seen, depth + 1);
  if (ts.isTypeParameterDeclaration(declaration) || ts.isClassDeclaration(declaration)) return 'unavailable';
  return 'not-object';
}

function typeReferenceStatus(ts: TypeScriptApi, checker: TypeChecker, node: TypeReferenceNode, seen: Set<TsSymbol>, depth: number): ObjectStatus {
  const symbol = normalizedSymbol(ts, checker, node.typeName);
  if (!symbol || seen.has(symbol)) return 'unavailable';
  const nextSeen = new Set(seen).add(symbol);
  const declarations = symbol.getDeclarations?.() ?? [];
  if (!declarations.length) return 'unavailable';
  return combineObjectStatus(declarations.map(declaration => declarationObjectStatus(ts, checker, declaration, nextSeen, depth)));
}

function objectTypeStatus(ts: TypeScriptApi, checker: TypeChecker, node: TypeNode | undefined, seen: Set<TsSymbol> = new Set(), depth = 0): ObjectStatus {
  if (!node || depth > 12) return 'unavailable';
  if (ts.isTypeLiteralNode(node) || ts.isMappedTypeNode(node)) return 'object';
  if (ts.isParenthesizedTypeNode(node)) return objectTypeStatus(ts, checker, node.type, seen, depth + 1);
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    return combineObjectStatus(node.types.map(type => objectTypeStatus(ts, checker, type, seen, depth + 1)));
  }
  if (ts.isTypeReferenceNode(node)) return typeReferenceStatus(ts, checker, node, seen, depth);
  if (ts.isConditionalTypeNode(node) || ts.isIndexedAccessTypeNode(node) || ts.isInferTypeNode(node) || ts.isTypeQueryNode(node)) return 'unavailable';
  return 'not-object';
}

function objectContractStatus(ts: TypeScriptApi, checker: TypeChecker, node: Node): ObjectStatus {
  if (ts.isInterfaceDeclaration(node)) return 'object';
  return ts.isTypeAliasDeclaration(node) ? objectTypeStatus(ts, checker, node.type) : 'not-object';
}

function companionInterfaceAllowed(ts: TypeScriptApi, sourceFile: SourceFile, name: string): boolean {
  if (!/^I[A-Z]/.test(name)) return false;
  const companion = name.slice(1);
  return sourceFile.statements.some(statement => ts.isClassDeclaration(statement) && statement.name?.text === companion
    && nodeDecorators(ts, statement).length > 0);
}

function camelCase(value: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(value);
}

function staticProperty(ts: TypeScriptApi, object: Node, name: string): StaticProperty {
  if (!ts.isObjectLiteralExpression(object)) return { status: 'dynamic' };
  const matching = object.properties.filter(property => {
    if (!property.name) return false;
    if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) return property.name.text === name;
    return false;
  });
  if (!matching.length) return { status: 'missing' };
  const [only] = matching;
  if (matching.length !== 1 || !only || !ts.isPropertyAssignment(only)) return { status: 'dynamic', node: only };
  const initializer = unwrapExpression(ts, only.initializer);
  return ts.isStringLiteralLike(initializer)
    ? { status: 'literal', value: initializer.text, node: initializer }
    : { status: 'dynamic', node: only.initializer };
}

function graphqlField({ config, context, sourceFile, node, decorator, kind, namingReasons, violations }: GraphqlFieldInput): void {
  const call = decorator.expression;
  if (!context.ts.isCallExpression(call)) {
    namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} has a non-call @${kind} decorator`);
    return;
  }
  const options = call.arguments.find(argument => context.ts.isObjectLiteralExpression(unwrapExpression(context.ts, argument)));
  const selected: StaticProperty = options ? staticProperty(context.ts, unwrapExpression(context.ts, options), 'name') : { status: 'missing' };
  if (selected.status === 'dynamic') {
    namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} has a dynamic @${kind} field name`);
    return;
  }
  const declaredName = hasName(node) ? node.name : undefined;
  const methodName = declaredName && (context.ts.isIdentifier(declaredName) || context.ts.isStringLiteralLike(declaredName)) ? declaredName.text : null;
  const name = selected.status === 'literal' ? selected.value : methodName;
  if (selected.status === 'literal') {
    if (!methodName) namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} cannot prove the @${kind} method name`);
    else if (selected.value !== methodName) violations.push(violation(config, sourceFile, selected.node ?? node, SOURCE_NAME_RULE_ID,
      `GraphQL @${kind} field name ${selected.value} must equal its method name ${methodName}.`));
  }
  if (!name) namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} cannot prove the @${kind} field name`);
  else if (!camelCase(name)) violations.push(violation(config, sourceFile, selected.node ?? declaredName ?? node, SOURCE_NAME_RULE_ID,
    `GraphQL field name ${name} must be camelCase.`));
}

function graphqlArgument(config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, _node: Node, decorator: Decorator, namingReasons: string[], violations: Violation[]): void {
  const call = decorator.expression;
  const [argument] = context.ts.isCallExpression(call) ? call.arguments : [];
  if (!context.ts.isCallExpression(call) || !argument) {
    namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} cannot prove the @Args input name`);
    return;
  }
  const selected = unwrapExpression(context.ts, argument);
  if (!context.ts.isStringLiteralLike(selected)) {
    namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} has a dynamic @Args input name`);
  } else if (selected.text !== 'input') violations.push(violation(config, sourceFile, selected, SOURCE_NAME_RULE_ID,
    'GraphQL request arguments use the literal name input.'));
}

function graphqlEnumRegistration(config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, call: CallExpression, namingReasons: string[], violations: Violation[]): void {
  const registration = call.arguments[1];
  if (!registration) {
    namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} cannot prove the registered GraphQL enum name`);
    return;
  }
  const selected = staticProperty(context.ts, unwrapExpression(context.ts, registration), 'name');
  if (selected.status !== 'literal') namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} has a dynamic registered GraphQL enum name`);
  else if (!/^[A-Z][A-Za-z0-9]*$/.test(selected.value ?? '')) violations.push(violation(config, sourceFile, selected.node ?? call, SOURCE_NAME_RULE_ID,
    `Registered GraphQL enum name ${selected.value} must be PascalCase.`));
}

function selectedCallKind(ts: TypeScriptApi, checker: TypeChecker, call: CallExpression, targets: Map<TsSymbol, string>): string | null {
  const selected = selectedNode(ts, call.expression);
  return selected ? kindOfSymbol(targets, valueSymbol(ts, checker, selected)) : null;
}

function callsNamedHelper(ts: TypeScriptApi, checker: TypeChecker, call: CallExpression, name: string): boolean {
  const selected = selectedNode(ts, call.expression);
  const symbol = selected ? normalizedSymbol(ts, checker, selected) : null;
  return (symbol?.getDeclarations?.() ?? []).some(declaration => {
    const declarationName = hasName(declaration) ? declaration.name : undefined;
    return declarationName && (ts.isIdentifier(declarationName) || ts.isStringLiteralLike(declarationName)) && declarationName.text === name;
  });
}

function implementsFramework(ts: TypeScriptApi, checker: TypeChecker, declaration: ClassDeclaration, targets: Map<TsSymbol, string>, name: string): boolean {
  return (declaration.heritageClauses ?? []).some(clause => clause.token === ts.SyntaxKind.ImplementsKeyword
    && clause.types.some(type => kindOfSymbol(targets, valueSymbol(ts, checker, type.expression)) === name));
}

/** Names of the interfaces a class implements that are declared in a *.port.ts or *.contracts.ts file (resolved by the type checker). */
function portNamesForImplementedType(ts: TypeScriptApi, checker: TypeChecker, type: ExpressionWithTypeArguments): string[] {
  const names: string[] = [];
  const symbol = normalizedSymbol(ts, checker, type.expression);
  for (const target of symbol?.getDeclarations?.() ?? []) {
    if (!ts.isInterfaceDeclaration(target) && !ts.isTypeAliasDeclaration(target)) continue;
    const declaredRole = path.basename(target.getSourceFile().fileName).replace(SOURCE_EXTENSION, '').split('.').at(-1);
    if (declaredRole !== undefined && PORT_DECLARATION_ROLES.has(declaredRole)) names.push(target.name.text);
  }
  return names;
}

function implementedPortNames(ts: TypeScriptApi, checker: TypeChecker, declaration: ClassDeclaration): string[] {
  return (declaration.heritageClauses ?? []).filter(clause => clause.token === ts.SyntaxKind.ImplementsKeyword)
    .flatMap(clause => clause.types.flatMap(type => portNamesForImplementedType(ts, checker, type)));
}

function locatedRoot(roots: string[], fileName: string): string | null {
  return roots.find(root => isInside(root, fileName)) ?? null;
}

/** Check the adopted domain-first backend source layout without inferring semantic ownership from folder names alone. */
const checkBackendSourceShapeImpl = createBackendSourceShapeChecker({
  absoluteRoots, canonical, frameworkTargets, locatedRoot, sourceRole, kebabSourceBase, exportedDeclarations,
  classValueStatus, objectContractStatus, companionInterfaceAllowed, hasModifier, graphqlField, graphqlArgument,
  graphqlEnumRegistration, selectedCallKind, callsNamedHelper, implementsFramework, implementedPortNames, decoratorKind,
  SOURCE_LAYOUT_RULE_ID, SOURCE_NAME_RULE_ID, APPLICATION_ROLES, TRANSPORT_ROLES, APPLICATION_LAYER_ROLES,
  TRANSPORT_LAYER_ROLES, CLASS_ROLE_SUFFIX, TRANSPORT_OBJECT_SUFFIX, NON_CLASS_ROLES, SPECIAL_BASENAMES,
  TRACE_NEW,
});

function inspectSubscriptionSource({ config, context, sourceFile, checker, framework, configuredRoot, namingReasons, violations }: SubscriptionSource): void {
  const visit = (node: Node): void => {
    for (const decorator of nodeDecorators(context.ts, node)) {
      const kind = decoratorKind(context.ts, checker, decorator, framework.bySymbol);
      if (kind === 'Subscription') graphqlField({ config, context, sourceFile, node, decorator, kind, namingReasons, violations });
      else if (!kind && !configuredRoot) {
        const dynamic = mutableDecoratorKind(context.ts, checker, decorator, framework.bySymbol)
          ?? constructedDecoratorKind(context.ts, checker, decorator, framework.bySymbol, TRACE_NEW);
        if (dynamic !== null && ['Subscription', 'multiple framework', 'unproven framework'].includes(dynamic)) {
          namingReasons.push(`${relativePath(config.root, sourceFile.fileName)} uses a mutable or constructed ${dynamic} decorator identity`);
        }
      }
    }
    context.ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function checkBackendSourceShape(config: ArchitectureConfig, context: TypeContext): ShapeResult {
  const result = checkBackendSourceShapeImpl(config, context);
  const roots = absoluteRoots(config.root, [...config.backend.features, ...config.backend.modules]);
  const localFiles = new Set(context.files.map(file => canonical(file.fileName)));
  const frameworkByChecker = new Map<TypeChecker, FrameworkBindings>();
  const namingReasons: string[] = [];
  // The shared shape walk dispatches Query and Mutation; subscriptions use the same naming relation here.
  for (const sourceFile of context.files) {
    const fileName = canonical(sourceFile.fileName);
    const configuredRoot = locatedRoot(roots, fileName);
    const owner = config.hfs?.ownerOf?.(relativePath(config.root, fileName));
    const slot = owner ? config.hfs.slot(owner.slot) : null;
    if (!configuredRoot && !(slot?.tier === 'feature' && slot.profiles?.includes('be'))) continue;
    const checker = context.checkerFor(fileName);
    if (!checker) continue;
    let framework = frameworkByChecker.get(checker);
    if (!framework) {
      framework = frameworkTargets(config, context, checker, localFiles);
      frameworkByChecker.set(checker, framework);
    }
    inspectSubscriptionSource({ config, context, sourceFile, checker, framework, configuredRoot, namingReasons, violations: result.violations });
  }
  if (namingReasons.length) result.coverage.naming = {
    status: 'unavailable', reason: 'one or more backend source naming relations are not statically proved',
    details: [...new Set([...(result.coverage.naming.details ?? []), ...namingReasons])].sort(byCodeUnit),
  };
  return result;
}
export { SOURCE_LAYOUT_RULE_ID, SOURCE_NAME_RULE_ID };
