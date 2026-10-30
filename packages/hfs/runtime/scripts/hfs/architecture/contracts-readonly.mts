import path from 'node:path';
import type {
  BinaryExpression, CallExpression, ClassDeclaration, ClassLikeDeclaration, ConstructorDeclaration, Decorator, Expression,
  InterfaceType, Modifier, Node, ParameterDeclaration, PropertyDeclaration, SetAccessorDeclaration, SourceFile, SyntaxKind,
  Symbol as TsSymbol, Type, TypeChecker,
} from 'typescript';
import { relativePath, unwrapExpression } from './typescript.mjs';
import { anyDescendant, nodeDecorators, normalizedSymbol, normalizedSymbolValue, valueSymbol, violation } from './ast-walks.mjs';
import type { Violation } from './ast-walks.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import { hasAnyFlag, isConstVariable, sourceLocation } from '../../lib/ts-ast.mjs';

/** The part of the TypeScript context the readonly-boundary checks read. */
export interface ReadonlyContext {
  ts: TypeScriptApi;
}

/** Whether an expression originates from `this`: yes, no, or through a mutable binding. */
type ThisOrigin = 'yes' | 'no' | 'unavailable';

/** What an assignment target is: an instance member (with its static name, when supported) or something else. */
type InstanceTarget =
  | { instance: false; name?: undefined; supported?: undefined }
  | { instance: true; name: string | null; supported: boolean };

/** One constructor statement that stores an origin-derived value on the instance. */
interface InstanceAssignment {
  node: Node;
  name: string | null;
  supported: boolean;
}

/** A node that carries a static member name. */
type NamedMember = ParameterDeclaration | PropertyDeclaration | SetAccessorDeclaration;

/** The decorator-kind reader the injected-class check is handed. */
type DecoratorKind = (ts: TypeScriptApi, checker: TypeChecker, decorator: Decorator, targets: Map<TsSymbol, string>) => string | null;

/** What the message-class walk shares. */
interface MessageState {
  config: ArchitectureConfig;
  context: ReadonlyContext;
  checker: TypeChecker;
  declaration: ClassLikeDeclaration;
  localFiles: ReadonlySet<string>;
  visited: Set<string>;
  violations: Violation[];
  reasons: string[];
  sourceFile?: SourceFile;
}

/** A message state positioned on one class (its source file known). */
type MessageClassState = MessageState & { sourceFile: SourceFile };

/** What the injected-class walk shares. */
interface InjectedState {
  config: ArchitectureConfig;
  context: ReadonlyContext;
  checker: TypeChecker;
  declaration: ClassLikeDeclaration;
  classKind: string | null | undefined;
  properties: Map<string, PropertyDeclaration>;
  targets: Map<TsSymbol, string>;
  decoratorKind: DecoratorKind;
  framework: { targets: Map<TsSymbol, string>; decoratorKind: DecoratorKind };
  localFiles: ReadonlySet<string>;
  violations: Violation[];
  reasons: string[];
  visited: Set<string>;
  sourceFile?: SourceFile;
}

/** An injected state positioned on one class (its source file known). */
type InjectedClassState = InjectedState & { sourceFile: SourceFile };

/** The input `checkInjectedClass` takes (`visited` is its own recursion state). */
export interface InjectedClassInput {
  config: ArchitectureConfig;
  context: ReadonlyContext;
  checker: TypeChecker;
  declaration: ClassLikeDeclaration;
  classKind: string | null | undefined;
  targets: Map<TsSymbol, string>;
  decoratorKind: DecoratorKind;
  localFiles: ReadonlySet<string>;
  violations: Violation[];
  reasons: string[];
  visited?: Set<string>;
}

export const READONLY_BOUNDARY_RULE_ID = 'BE_READONLY_BOUNDARY';

export function canonical(file: string): string {
  return path.resolve(file);
}

export function modifiers(ts: TypeScriptApi, node: Node): readonly Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : (node as Node & { modifiers?: readonly Modifier[] }).modifiers ?? [];
}

export function hasModifier(ts: TypeScriptApi, node: Node, kind: SyntaxKind): boolean {
  return modifiers(ts, node).some(modifier => modifier.kind === kind);
}

export function isPublicMember(ts: TypeScriptApi, node: Node): boolean {
  return !hasModifier(ts, node, ts.SyntaxKind.PrivateKeyword) && !hasModifier(ts, node, ts.SyntaxKind.ProtectedKeyword);
}

function readonlyMember(ts: TypeScriptApi, node: Node): boolean {
  return hasModifier(ts, node, ts.SyntaxKind.ReadonlyKeyword);
}

function propertyName(ts: TypeScriptApi, node: NamedMember): string | null {
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isPrivateIdentifier(name)) return name.text;
  return null;
}

function thisOriginStatus(ts: TypeScriptApi, checker: TypeChecker, input: Node | null | undefined, seen: Set<TsSymbol> = new Set(), depth = 0): ThisOrigin {
  if (!input || depth > 8) return 'no';
  const expression: Node = unwrapExpression(ts, input);
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'yes';
  const symbol = normalizedSymbol(ts, checker, expression);
  if (!symbol || seen.has(symbol)) return 'no';
  const declarations = symbol.getDeclarations?.() ?? [];
  const [only] = declarations;
  if (declarations.length !== 1 || !only || !ts.isVariableDeclaration(only) || !only.initializer) return 'no';
  const origin = thisOriginStatus(ts, checker, only.initializer, new Set(seen).add(symbol), depth + 1);
  if (origin === 'no') return 'no';
  return isConstVariable(ts, only) ? origin : 'unavailable';
}

function instanceAssignmentTarget(ts: TypeScriptApi, checker: TypeChecker, input: Node): InstanceTarget {
  const expression: Node = unwrapExpression(ts, input);
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) return { instance: false };
  const owner = thisOriginStatus(ts, checker, expression.expression);
  if (owner === 'no') return { instance: false };
  if (owner === 'unavailable') return { instance: true, name: null, supported: false };
  if (ts.isPropertyAccessExpression(expression)) return { instance: true, name: expression.name.text, supported: true };
  if (ts.isStringLiteralLike(expression.argumentExpression)) return { instance: true, name: expression.argumentExpression.text, supported: true };
  return { instance: true, name: null, supported: false };
}

function expressionOrigin(ts: TypeScriptApi, checker: TypeChecker, input: Node | null | undefined, seen: Set<TsSymbol> = new Set(), depth = 0): TsSymbol | null | undefined {
  if (!input || depth > 8) return null;
  const expression: Node = unwrapExpression(ts, input);
  const shorthand = ts.isShorthandPropertyAssignment(expression) ? checker.getShorthandAssignmentValueSymbol?.(expression) : null;
  const symbol = normalizedSymbolValue(ts, checker, shorthand) ?? normalizedSymbol(ts, checker, expression);
  if (!symbol || seen.has(symbol)) return symbol;
  const declarations = symbol.getDeclarations?.() ?? [];
  const [only] = declarations;
  if (declarations.length === 1 && only && ts.isVariableDeclaration(only) && only.initializer
    && isConstVariable(ts, only)) {
    return expressionOrigin(ts, checker, only.initializer, new Set(seen).add(symbol), depth + 1);
  }
  return symbol;
}

const expressionReferencesOrigin = (ts: TypeScriptApi, checker: TypeChecker, expression: Node, expected: TsSymbol | null | undefined): boolean =>
  anyDescendant(ts, expression, node => expressionOrigin(ts, checker, node) === expected);

function isSafePrimitiveProjection(ts: TypeScriptApi, checker: TypeChecker, input: Node, expected: TsSymbol | null | undefined): boolean {
  const expression: Node = unwrapExpression(ts, input);
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) return false;
  if (expressionOrigin(ts, checker, expression.expression) !== expected) return false;
  const type = checker.getTypeAtLocation(expression);
  const primitive = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike
    | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined
    | ts.TypeFlags.Void | ts.TypeFlags.Never;
  return hasAnyFlag(type.flags, primitive) && !hasAnyFlag(type.flags, ts.TypeFlags.Any | ts.TypeFlags.Unknown);
}

function assignmentPatternHasInstanceTarget(ts: TypeScriptApi, checker: TypeChecker, expression: Node): boolean {
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    const target = instanceAssignmentTarget(ts, checker, node);
    if (target.instance) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function globalLibraryIdentifier(ts: TypeScriptApi, checker: TypeChecker, node: Node, expected: string): boolean {
  if (!ts.isIdentifier(node) || node.text !== expected) return false;
  const symbol = normalizedSymbol(ts, checker, node);
  const declarations = symbol?.getDeclarations?.() ?? [];
  return declarations.length > 0 && declarations.every(declaration => declaration.getSourceFile().isDeclarationFile
    && /(?:^|[/\\])lib\.[^/\\]+\.d\.ts$/i.test(declaration.getSourceFile().fileName));
}

function instanceMutationCall(ts: TypeScriptApi, checker: TypeChecker, node: Node): { node: CallExpression; values: Expression[] } | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const owner = node.expression.expression;
  const method = node.expression.name.text;
  const known = (method === 'assign' || method === 'defineProperty') && globalLibraryIdentifier(ts, checker, owner, 'Object')
    || method === 'set' && globalLibraryIdentifier(ts, checker, owner, 'Reflect');
  if (!known || thisOriginStatus(ts, checker, node.arguments[0]) === 'no') return null;
  return { node, values: node.arguments.slice(method === 'assign' ? 1 : 2) };
}

const isFunctionBoundary = (ts: TypeScriptApi, node: Node): boolean => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

/** The instance assignment a `<left> = <origin-derived>` expression performs, or null when its target is no instance member. */
function instanceAssignment(ts: TypeScriptApi, checker: TypeChecker, node: BinaryExpression): InstanceAssignment | null {
  const target = instanceAssignmentTarget(ts, checker, node.left);
  if (target.instance) {
    return { node, name: target.name, supported: target.supported && node.operatorToken.kind === ts.SyntaxKind.EqualsToken };
  }
  return assignmentPatternHasInstanceTarget(ts, checker, node.left) ? { node, name: null, supported: false } : null;
}

/** The assignment or mutation call at `node` that stores the constructor parameter on the instance, or null. */
function constructorFinding(ts: TypeScriptApi, checker: TypeChecker, node: Node, parameterSymbol: TsSymbol | null | undefined): InstanceAssignment | null {
  if (ts.isBinaryExpression(node) && expressionReferencesOrigin(ts, checker, node.right, parameterSymbol)
    && !isSafePrimitiveProjection(ts, checker, node.right, parameterSymbol)) {
    return instanceAssignment(ts, checker, node);
  }
  const mutation = instanceMutationCall(ts, checker, node);
  return mutation?.values.some(argument => expressionReferencesOrigin(ts, checker, argument, parameterSymbol))
    ? { node, name: null, supported: false }
    : null;
}

function constructorAssignments(ts: TypeScriptApi, checker: TypeChecker, constructor: ConstructorDeclaration, parameter: ParameterDeclaration): InstanceAssignment[] {
  if (!constructor.body) return [];
  const parameterSymbol = normalizedSymbol(ts, checker, parameter.name);
  const assignments: InstanceAssignment[] = [];
  const visit = (node: Node): void => {
    if (node !== constructor.body && isFunctionBoundary(ts, node)) return;
    const finding = constructorFinding(ts, checker, node, parameterSymbol);
    if (finding) assignments.push(finding);
    else ts.forEachChild(node, visit);
  };
  visit(constructor.body);
  return assignments;
}

function checkReadonlyProperty(config: ArchitectureConfig, context: ReadonlyContext, sourceFile: SourceFile, node: ParameterDeclaration | PropertyDeclaration, label: string, violations: Violation[]): void {
  if (!readonlyMember(context.ts, node)) violations.push(violation(config, sourceFile, node.name ?? node, READONLY_BOUNDARY_RULE_ID,
    `${label} must be readonly; execution state must not mutate an injected dependency or received message.`));
}

function classValuesForSymbol(ts: TypeScriptApi, symbol: TsSymbol | null | undefined, localFiles: ReadonlySet<string>): ClassLikeDeclaration[] {
  return (symbol?.getDeclarations?.() ?? []).flatMap((declaration): ClassLikeDeclaration[] => {
    if (ts.isClassDeclaration(declaration)) return [declaration];
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrapExpression(ts, declaration.initializer);
      if (ts.isClassExpression(initializer)) return [initializer];
    }
    return [];
  }).filter(declaration => localFiles.has(canonical(declaration.getSourceFile().fileName)));
}

export function messageClass(config: ArchitectureConfig, context: ReadonlyContext, checker: TypeChecker, decorator: Decorator, localFiles: ReadonlySet<string>, reasons: string[]): ClassLikeDeclaration | null {
  const expression = decorator.expression;
  const messageArgument = context.ts.isCallExpression(expression) ? expression.arguments[0] : undefined;
  if (!messageArgument) {
    reasons.push(`${relativePath(config.root, decorator.getSourceFile().fileName)} has a handler decorator without a static message class`);
    return null;
  }
  const symbol = valueSymbol(context.ts, checker, messageArgument);
  const declarations = classValuesForSymbol(context.ts, symbol, localFiles);
  if (declarations.length !== 1) {
    reasons.push(`${relativePath(config.root, decorator.getSourceFile().fileName)} cannot resolve one local message class from its handler decorator`);
    return null;
  }
  return declarations[0] ?? null;
}

function inspectMessageConstructor(state: MessageClassState, constructor: ConstructorDeclaration): void {
  const { config, context, checker, sourceFile, violations, reasons } = state;
  const ts = context.ts;
  for (const parameter of constructor.parameters) {
    if (modifiers(ts, parameter).some(modifier => [ts.SyntaxKind.PublicKeyword,
      ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind))) {
      checkReadonlyProperty(config, context, sourceFile, parameter, `Message field ${propertyName(ts, parameter) ?? '(computed)'}`, violations);
    }
  }
  if (!constructor.body) return;
  const inspectAssign = (node: Node): void => {
    if (node !== constructor.body && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
    if (instanceMutationCall(ts, checker, node)) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)} constructs message fields through an unsupported instance mutation`);
    } else if (ts.isBinaryExpression(node) && assignmentPatternHasInstanceTarget(ts, checker, node.left)
      && !instanceAssignmentTarget(ts, checker, node.left).supported) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)} constructs message fields through an unsupported instance assignment`);
    } else ts.forEachChild(node, inspectAssign);
  };
  inspectAssign(constructor.body);
}

function inspectMessageMembers(state: MessageState): void {
  const { config, context, declaration, violations, reasons } = state;
  const ts = context.ts;
  const sourceFile = declaration.getSourceFile();
  const classState: MessageClassState = { ...state, sourceFile };
  for (const member of declaration.members) {
    if (ts.isPropertyDeclaration(member) && !hasModifier(ts, member, ts.SyntaxKind.StaticKeyword)) {
      checkReadonlyProperty(config, context, sourceFile, member, `Message field ${propertyName(ts, member) ?? '(computed)'}`, violations);
    }
    if (ts.isSetAccessorDeclaration(member)) violations.push(violation(config, sourceFile, member.name, READONLY_BOUNDARY_RULE_ID,
      `Message field ${propertyName(ts, member) ?? '(computed)'} cannot expose a setter.`));
    if (ts.isIndexSignatureDeclaration(member)) reasons.push(`${relativePath(config.root, sourceFile.fileName)} has a message index signature whose mutation boundary cannot be proved`);
    if (ts.isConstructorDeclaration(member)) inspectMessageConstructor(classState, member);
  }
}

function classCarriesState(ts: TypeScriptApi, declaration: ClassLikeDeclaration): boolean {
  return declaration.members.some(member => (ts.isPropertyDeclaration(member) && !hasModifier(ts, member, ts.SyntaxKind.StaticKeyword))
    || ts.isSetAccessorDeclaration(member) || ts.isIndexSignatureDeclaration(member)
    || (ts.isConstructorDeclaration(member) && member.parameters.length > 0));
}

function classInstanceType(ts: TypeScriptApi, checker: TypeChecker, declaration: ClassLikeDeclaration): Type {
  const symbol = declaration.name ? normalizedSymbol(ts, checker, declaration.name) : null;
  if (symbol && ts.isClassDeclaration(declaration)) return checker.getDeclaredTypeOfSymbol(symbol);
  const value = checker.getTypeAtLocation(declaration);
  const constructor = checker.getSignaturesOfType(value, ts.SignatureKind.Construct)[0];
  return constructor ? checker.getReturnTypeOfSignature(constructor) : value;
}

function inspectMessageBases(state: MessageClassState): void {
  const { config, context, checker, declaration, localFiles, sourceFile, reasons } = state;
  const ts = context.ts;
  const type = classInstanceType(ts, checker, declaration);
  // reason: a class symbol's declared type is an interface type; the construct-signature fallback is read the same way.
  for (const base of type && checker.getBaseTypes ? checker.getBaseTypes(type as InterfaceType) : []) {
    const declarations = (base.symbol?.getDeclarations?.() ?? []).filter((item): item is ClassDeclaration => ts.isClassDeclaration(item)) ?? [];
    const [base0] = declarations;
    if (declarations.length !== 1 || !base0) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)} inherits message fields from a class outside the checked production program`);
    } else if (localFiles.has(canonical(base0.getSourceFile().fileName))) {
      visitMessageClass({ ...state, declaration: base0, sourceFile: base0.getSourceFile() });
    } else if (classCarriesState(ts, base0)) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)} inherits message state from a class outside the checked production program`);
    }
  }
}

function visitMessageClass(state: MessageState): void {
  const { declaration, visited } = state;
  const key = `${canonical(declaration.getSourceFile().fileName)}:${declaration.pos}`;
  if (visited.has(key)) return;
  visited.add(key);
  const classState: MessageClassState = { ...state, sourceFile: declaration.getSourceFile() };
  inspectMessageMembers(classState);
  inspectMessageBases(classState);
}

export function checkMessageReadonly(config: ArchitectureConfig, context: ReadonlyContext, checker: TypeChecker, declaration: ClassLikeDeclaration, localFiles: ReadonlySet<string>, violations: Violation[], reasons: string[]): void {
  visitMessageClass({ config, context, checker, declaration, localFiles, visited: new Set(), violations, reasons });
}

function inspectInjectedParameter(state: InjectedClassState, member: ConstructorDeclaration, parameter: ParameterDeclaration): void {
  const { config, context, checker, sourceFile, classKind, properties, framework, violations, reasons } = state;
  const ts = context.ts;
  const explicitInject = nodeDecorators(ts, parameter).some(decorator => framework.decoratorKind(ts, checker, decorator, framework.targets) === 'Inject');
  if (!classKind && !explicitInject) return;
  const parameterProperty = modifiers(ts, parameter).some(modifier => [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword,
    ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind));
  if (parameterProperty) {
    checkReadonlyProperty(config, context, sourceFile, parameter, `Injected dependency ${propertyName(ts, parameter) ?? '(computed)'}`, violations);
    return;
  }
  for (const assignment of constructorAssignments(ts, checker, member, parameter)) {
    if (!assignment.supported || !assignment.name) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)}:${sourceLocation(sourceFile, assignment.node).line} stores an injected dependency through an unsupported instance assignment`);
      continue;
    }
    const property = properties.get(assignment.name);
    if (!property) reasons.push(`${relativePath(config.root, sourceFile.fileName)} assigns injected dependency ${assignment.name} without a declared field`);
    else checkReadonlyProperty(config, context, sourceFile, property, `Injected dependency ${assignment.name}`, violations);
  }
}

function inspectInjectedConstructor(state: InjectedClassState, member: ConstructorDeclaration): void {
  for (const parameter of member.parameters) {
    inspectInjectedParameter(state, member, parameter);
  }
}

function inspectInjectedMembers(state: InjectedState): void {
  const { config, context, checker, declaration, framework, violations } = state;
  const ts = context.ts;
  const sourceFile = declaration.getSourceFile();
  const classState: InjectedClassState = { ...state, sourceFile };
  for (const member of declaration.members) {
    if (ts.isPropertyDeclaration(member)) {
      const injected = nodeDecorators(ts, member).some(decorator => framework.decoratorKind(ts, checker, decorator, framework.targets) === 'Inject');
      if (injected) checkReadonlyProperty(config, context, sourceFile, member, `Injected property ${propertyName(ts, member) ?? '(computed)'}`, violations);
      continue;
    }
    if (!ts.isConstructorDeclaration(member)) continue;
    inspectInjectedConstructor(classState, member);
  }
}

function inspectInjectedBases(state: InjectedState): void {
  const { config, context, checker, declaration, localFiles, reasons } = state;
  const ts = context.ts;
  const sourceFile = declaration.getSourceFile();
  const type = classInstanceType(ts, checker, declaration);
  // reason: a class symbol's declared type is an interface type; the construct-signature fallback is read the same way.
  for (const base of type && checker.getBaseTypes ? checker.getBaseTypes(type as InterfaceType) : []) {
    const declarations = (base.symbol?.getDeclarations?.() ?? []).filter((item): item is ClassDeclaration => ts.isClassDeclaration(item)) ?? [];
    const [base0] = declarations;
    if (declarations.length !== 1 || !base0) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)} inherits an injected constructor from a class outside the checked production program`);
    } else if (localFiles.has(canonical(base0.getSourceFile().fileName))) {
      checkInjectedClass({ ...state, declaration: base0 });
    } else if (classCarriesState(ts, base0)) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)} inherits an injected constructor from a class outside the checked production program`);
    }
  }
}

export function checkInjectedClass({ config, context, checker, declaration, classKind, targets, decoratorKind, localFiles, violations, reasons, visited = new Set() }: InjectedClassInput): void {
  const ts = context.ts;
  const classKey = `${canonical(declaration.getSourceFile().fileName)}:${declaration.pos}`;
  if (visited.has(classKey)) return;
  visited.add(classKey);
  const properties = new Map(declaration.members.filter((member): member is PropertyDeclaration => ts.isPropertyDeclaration(member))
    .map((member): [string | null, PropertyDeclaration] => [propertyName(ts, member), member])
    .filter((entry): entry is [string, PropertyDeclaration] => Boolean(entry[0])));
  const state: InjectedState = { config, context, checker, declaration, classKind, properties, targets, decoratorKind,
    framework: { targets, decoratorKind }, localFiles, violations, reasons, visited };
  inspectInjectedMembers(state);
  if (classKind) inspectInjectedBases(state);
}
