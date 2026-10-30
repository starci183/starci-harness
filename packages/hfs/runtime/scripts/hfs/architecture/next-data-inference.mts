// Infer lexical request identities for SWR hooks without a declared lifecycle contract.
import type { ArrowFunction, CallExpression, ElementAccessExpression, Expression, FunctionDeclaration, FunctionExpression, Identifier, Node, PropertyAccessExpression, PropertyAssignment, ShorthandPropertyAssignment, SourceFile, StringLiteralLike, Symbol as TsSymbol, TypeChecker } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import { unwrapExpression } from './typescript.mjs';
import { anyDescendant, normalizedSymbol } from './ast-walks.mjs';
import { sourceLocation } from '../../lib/ts-ast.mjs';
import { functionNode, constInitializer, inferredSymbol } from './next-data-symbols.mjs';

/** A request input read lexically: its symbol, the name parts reaching it and whether it is imported. */
export interface IdentityAccess {
  symbol: TsSymbol | null | undefined;
  parts: string[];
  imported: boolean;
}

/** One inferred request identity of an SWR call. */
export interface InferredIdentity extends IdentityAccess {
  id: string;
  binding: string;
  gatesRequest: boolean;
  resource: boolean;
}

/** The SWR call being inferred: where it is, its checker and whether it is a mutation. */
export interface InferenceCall {
  source: SourceFile;
  node: CallExpression;
  checker: TypeChecker;
  kind: string;
}

/** The fetcher function, or the key expression, whose lexical inputs are inferred. */
type Region = Node & { body?: Node };
type Seen = Set<TsSymbol>;
type Visit = (node: Node, seen?: Seen) => void;
export type SelectedMember = PropertyAccessExpression | (ElementAccessExpression & { argumentExpression: StringLiteralLike });

interface InferenceScope {
  ts: TypeScriptApi;
  call: InferenceCall;
  region: Region;
  reasons: string[];
  identities: Map<string, InferredIdentity>;
}

export function inferredFetcher(ts: TypeScriptApi, checker: TypeChecker, input: Node | null | undefined, seen: Seen = new Set()): FunctionDeclaration | ArrowFunction | FunctionExpression | null {
  if (!input) return null;
  const expression: Node = unwrapExpression(ts, input);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  const symbol = normalizedSymbol(ts, checker, expression);
  if (!symbol || seen.has(symbol)) return null;
  for (const declaration of symbol.getDeclarations?.() ?? []) {
    const fn = functionNode(ts, declaration);
    if (fn) return fn;
  }
  const initializer = constInitializer(ts, symbol);
  return initializer ? inferredFetcher(ts, checker, initializer, new Set(seen).add(symbol)) : null;
}

function importedIdentityReference(ts: TypeScriptApi, checker: TypeChecker, expression: Node): boolean {
  const reference = ts.isShorthandPropertyAssignment(expression.parent)
    ? checker.getShorthandAssignmentValueSymbol(expression.parent) : checker.getSymbolAtLocation(expression);
  return (reference?.getDeclarations?.() ?? []).some(declaration => ts.isImportSpecifier(declaration)
    || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isImportEqualsDeclaration(declaration));
}

function identifierIdentityAccess(ts: TypeScriptApi, checker: TypeChecker, expression: Identifier, seen: Seen): IdentityAccess {
  const imported = importedIdentityReference(ts, checker, expression);
  const symbol = inferredSymbol(ts, checker, expression);
  const initializer = symbol && !seen.has(symbol) ? constInitializer(ts, symbol) : null;
  if (initializer && symbol) {
    const alias = identityAccess(ts, checker, initializer, new Set(seen).add(symbol));
    if (alias) return { ...alias, imported: imported || alias.imported };
  }
  return { symbol, parts: [expression.text], imported };
}

function isSelectedMember(ts: TypeScriptApi, expression: Node): expression is SelectedMember {
  return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
    && ts.isStringLiteralLike(expression.argumentExpression);
}

function selectedMemberKey(ts: TypeScriptApi, expression: SelectedMember): string {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : expression.argumentExpression.text;
}

function identityAccess(ts: TypeScriptApi, checker: TypeChecker, input: Node, seen: Seen = new Set()): IdentityAccess | null {
  const expression: Node = unwrapExpression(ts, input);
  if (ts.isIdentifier(expression)) return identifierIdentityAccess(ts, checker, expression, seen);
  if (isSelectedMember(ts, expression)) {
    const base = identityAccess(ts, checker, expression.expression, seen);
    return base ? { ...base, parts: [...base.parts, selectedMemberKey(ts, expression)] } : null;
  }
  return null;
}

function containerWritten(ts: TypeScriptApi, checker: TypeChecker, symbol: TsSymbol, source: Node): boolean {
  const incrementOperators: readonly number[] = [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken];
  const rootSymbol = (input: Node): TsSymbol | null | undefined => {
    let expression: Node = unwrapExpression(ts, input);
    while (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) expression = unwrapExpression(ts, expression.expression);
    return ts.isIdentifier(expression) ? inferredSymbol(ts, checker, expression) : null;
  };
  return anyDescendant(ts, source, (node: Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return rootSymbol(node.left) === symbol;
    if (ts.isDeleteExpression(node)) return rootSymbol(node.expression) === symbol;
    if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)
      && incrementOperators.includes(node.operator)) return rootSymbol(node.operand) === symbol;
    return false;
  });
}

function selectedRequestAlias(ts: TypeScriptApi, checker: TypeChecker, expression: Node, seen: Seen): { symbol: TsSymbol; value: Expression } | null {
  const symbol = inferredSymbol(ts, checker, expression);
  const initializer = symbol && !seen.has(symbol) ? constInitializer(ts, symbol) : null;
  if (!initializer || !symbol) return null;
  const value: Expression = unwrapExpression(ts, initializer);
  if (ts.isObjectLiteralExpression(value) && (initializer.getSourceFile() !== expression.getSourceFile()
    || containerWritten(ts, checker, symbol, expression.getSourceFile()))) return null;
  if (ts.isObjectLiteralExpression(value) || ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)
    || ts.isElementAccessExpression(value)) return { symbol, value };
  return null;
}

function selectedRequestProperty(ts: TypeScriptApi, object: Node, key: string): PropertyAssignment | ShorthandPropertyAssignment | null {
  if (!ts.isObjectLiteralExpression(object) || !object.properties.every((property): property is PropertyAssignment | ShorthandPropertyAssignment => ts.isPropertyAssignment(property)
    || ts.isShorthandPropertyAssignment(property))) return null;
  return [...object.properties].reverse().find(candidate => (ts.isIdentifier(candidate.name)
    || ts.isStringLiteralLike(candidate.name)) && candidate.name.text === key) ?? null;
}

function selectedRequestValue(ts: TypeScriptApi, checker: TypeChecker, input: Node, seen: Seen = new Set()): Node {
  const expression: Node = unwrapExpression(ts, input);
  if (ts.isIdentifier(expression)) {
    const alias = selectedRequestAlias(ts, checker, expression, seen);
    return alias ? selectedRequestValue(ts, checker, alias.value, new Set(seen).add(alias.symbol)) : expression;
  }
  if (!isSelectedMember(ts, expression)) return expression;
  const object = selectedRequestValue(ts, checker, expression.expression, seen);
  const property = selectedRequestProperty(ts, object, selectedMemberKey(ts, expression));
  if (!property) return expression;
  const value = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
  return selectedRequestValue(ts, checker, value, seen);
}

function capturedInput(ts: TypeScriptApi, access: IdentityAccess, region: Node): boolean {
  const declarations = access.symbol?.getDeclarations?.() ?? [];
  return declarations.some(declaration => {
    if (declaration.getSourceFile() === region.getSourceFile() && declaration.pos >= region.pos && declaration.end <= region.end) return false;
    if (declaration.getSourceFile().isDeclarationFile && !access.imported) return false;
    return access.imported || ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isBindingElement(declaration);
  });
}

function capturedIdentityAlias(ts: TypeScriptApi, access: IdentityAccess, seen: Seen): Node | null {
  // Follow transparent aliases and request objects, so {id} and an alias of id carry the same identity.
  if (access.parts.length !== 1 || (access.symbol ? seen.has(access.symbol) : false)) return null;
  const initializer = constInitializer(ts, access.symbol);
  if (!initializer) return null;
  const value = unwrapExpression(ts, initializer);
  return ts.isCallExpression(value) || ts.isAwaitExpression(value) || ts.isNewExpression(value) ? null : value;
}

function recordInferredIdentity(scope: InferenceScope, access: IdentityAccess | null, seen: Seen, visit: Visit): boolean {
  const { ts, call, region, reasons, identities } = scope;
  if (access?.imported && !(access.symbol?.getDeclarations?.() ?? []).length) {
    reasons.push(`${call.source.fileName}:${sourceLocation(call.source, call.node).line} imported SWR request input ${access.parts.join('.')} cannot be resolved; dataLifecycle is required to declare identities`);
    return true;
  }
  if (!access || !capturedInput(ts, access, region)) return false;
  const alias = capturedIdentityAlias(ts, access, seen);
  if (alias && access.symbol) visit(alias, new Set(seen).add(access.symbol));
  else {
    const binding = access.parts.join('.');
    identities.set(binding, { id: binding, binding, ...access, gatesRequest: false, resource: call.kind === 'mutation' });
  }
  return true;
}

function visitRequestChildren(ts: TypeScriptApi, node: Node, seen: Seen, visit: Visit): void {
  if (ts.isPropertyAssignment(node)) { visit(node.initializer, seen); return; }
  // A method name is not a request input; its receiver and arguments can be.
  if (ts.isCallExpression(node)) {
    const callee = unwrapExpression(ts, node.expression);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) visit(callee.expression, seen);
    for (const argument of node.arguments) visit(argument, seen);
    return;
  }
  if (ts.isVariableDeclaration(node)) {
    if (node.initializer) visit(node.initializer, seen);
    return;
  }
  ts.forEachChild(node, (child: Node) => { visit(child, seen); });
}

/** Infer lexical request inputs; parameters declared inside the fetcher are supplied by SWR. */
export function inferredIdentities(context: { ts: TypeScriptApi }, call: InferenceCall, region: Region, reasons: string[]): InferredIdentity[] {
  const { ts } = context;
  const identities = new Map<string, InferredIdentity>();
  const scope: InferenceScope = { ts, call, region, reasons, identities };
  const visit: Visit = (node, seen = new Set()) => {
    const selectedValue = selectedRequestValue(ts, call.checker, node);
    if (selectedValue !== node && selectedValue !== unwrapExpression(ts, node)) { visit(selectedValue, seen); return; }
    if (recordInferredIdentity(scope, identityAccess(ts, call.checker, node), seen, visit)) return;
    visitRequestChildren(ts, node, seen, visit);
  };
  visit(region.body ?? region);
  return [...identities.values()];
}

export function inferredKeyBindings(context: { ts: TypeScriptApi }, call: InferenceCall, reasons: string[]): InferredIdentity[] {
  const key = call.node.arguments[0];
  // A key or its null guard can contain bindings that are not captured request inputs.
  return key ? inferredIdentities(context, call, key, reasons).map(identity => ({ ...identity, id: `key:${identity.id}`, resource: false })) : [];
}
