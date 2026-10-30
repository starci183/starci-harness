/** The app emitter consumes the API app's declared operation table without importing it from app.module.ts. */
import path from 'node:path';
import { hasAnyFlag } from '../../lib/ts-ast.mjs';
import type { Node, SourceFile, Symbol as TsSymbol, TypeChecker } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { HfsGraph } from './hfs-graph.mjs';

/** The part of the TypeScript context this check reads. */
export interface OperationContext {
  ts: TypeScriptApi;
  checkerFor?: (fileName: string) => TypeChecker | undefined;
}

/** A node that may carry a variable initializer, a name with text, or both (a loosely typed declaration). */
interface LooseDeclaration extends Node {
  initializer?: Node;
  name?: { text?: string };
}

const actualSymbol = (ts: TypeScriptApi, checker: TypeChecker, symbol: TsSymbol | undefined): TsSymbol | undefined => symbol && hasAnyFlag(symbol.flags, ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;

/** Follow declaration aliases while retaining the actual expression rather than an asserted type. */
const initializerOf = (ts: TypeScriptApi, checker: TypeChecker, node: Node | undefined, seen = new Set<Node>()): Node | null => {
  if (!node || seen.has(node)) return null;
  seen.add(node);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return initializerOf(ts, checker, node.expression, seen);
  if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return node;
  const declaration = actualSymbol(ts, checker, checker.getSymbolAtLocation(node))?.valueDeclaration as LooseDeclaration | undefined; // reason: a value declaration may or may not be a variable declaration; `initializer` is read only when present
  return declaration?.initializer ? initializerOf(ts, checker, declaration.initializer, seen) : node;
};

/** A same-named local function cannot declare the platform operation contract. */
const isOperationDefiner = (ts: TypeScriptApi, checker: TypeChecker, graph: HfsGraph, config: ArchitectureConfig, expression: Node, seen = new Set<TsSymbol>()): boolean => {
  const symbol = actualSymbol(ts, checker, checker.getSymbolAtLocation(expression));
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  return (symbol.declarations ?? []).some((declaration: LooseDeclaration) => {
    const relative = path.relative(config.root, declaration.getSourceFile().fileName).split(path.sep).join('/');
    const owner = graph.resolver.ownerOf(relative);
    if (declaration.name?.text === 'defineOperations' && owner?.slot === 'be.platform' && path.posix.basename(owner.root) === 'operations') return true;
    const alias = declaration.initializer;
    return Boolean(alias && (ts.isIdentifier(alias) || ts.isPropertyAccessExpression(alias)) && isOperationDefiner(ts, checker, graph, config, alias, seen));
  });
};

/** True only for an exported, nonempty registration by the canon platform capability. */
const declaresOperations = (context: OperationContext, graph: HfsGraph, config: ArchitectureConfig, sourceFile: SourceFile): boolean => {
  const { ts } = context;
  const checker = context.checkerFor?.(sourceFile.fileName);
  const moduleSymbol = checker?.getSymbolAtLocation(sourceFile);
  if (!checker || !moduleSymbol) return false;
  const exported = checker.getExportsOfModule(moduleSymbol).find(symbol => symbol.getName() === 'OPERATIONS');
  const declaration = actualSymbol(ts, checker, exported)?.valueDeclaration as LooseDeclaration | undefined; // reason: see initializerOf
  const registration = initializerOf(ts, checker, declaration?.initializer);
  if (!registration || !ts.isCallExpression(registration) || !isOperationDefiner(ts, checker, graph, config, registration.expression)) return false;
  const entries = initializerOf(ts, checker, registration.arguments[0]);
  return entries !== null && ts.isObjectLiteralExpression(entries) && checker.getPropertiesOfType(checker.getTypeAtLocation(entries)).length > 0;
};

/** Only the emitter's exact entry of a declared API app is a contract root; workers and arbitrary app files remain judged. */
export function operationContractRoots(context: OperationContext, graph: HfsGraph, config: ArchitectureConfig): string[] {
  return (config.apps ?? []).filter(app => app.kind === 'api').flatMap(app => {
    const relative = `apps/${app.name}/src/operations.ts`;
    const node = graph.files.get(relative);
    return node?.tier === 'app' && node.slot === 'be.app.api' && declaresOperations(context, graph, config, node.sourceFile) ? [relative] : [];
  });
}
