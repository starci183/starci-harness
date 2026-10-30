import path from 'node:path';
import { allowsFile } from '../allows.mjs';
import { relativePath, unwrapExpression } from './typescript.mjs';
import { accessName, sourceLocation } from '../../lib/ts-ast.mjs';
import type { BindingElement, CallExpression, ElementAccessExpression, Identifier, ImportClause, Node, PropertyAccessExpression, SourceFile, Symbol as TsSymbol, TypeChecker } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation } from './hfs-graph.mjs';

/** The part of the TypeScript context this check reads. */
export interface ApplicationEnvironmentContext {
  ts: TypeScriptApi;
  checkerFor: (fileName: string) => TypeChecker;
}

/** A node `accessName` names: a property or element access, both of which carry an `expression`. */
type AccessExpression = PropertyAccessExpression | ElementAccessExpression;
type Reporter = (node: Node) => void;

const PROCESS_MODULES = new Set(['process', 'node:process']);
const PROCESS_GLOBAL = new Set(['process']);
const GLOBAL_HOLDERS = new Set(['globalThis', 'global']);
const REFLECT_GLOBAL = new Set(['Reflect']);

function bindingName(ts: TypeScriptApi, element: BindingElement): string | null {
  const name = element.propertyName ?? element.name;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression) ? name.expression.text : null;
}

/** A global name is not a same-named local variable or parameter. */
function isGlobalName(ts: TypeScriptApi, checker: TypeChecker | undefined, node: Node, names: Set<string>): boolean {
  if (!ts.isIdentifier(node) || !names.has(node.text)) return false;
  const declarations = checker?.getSymbolAtLocation(node)?.getDeclarations() ?? [];
  return declarations.every(declaration => declaration.getSourceFile().isDeclarationFile);
}

function recordProcessBindings(ts: TypeScriptApi, clause: ImportClause | undefined, add: (name: Identifier) => void, report: Reporter): void {
  if (clause?.name) add(clause.name);
  const bindings = clause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) add(bindings.name);
  if (!bindings || !ts.isNamedImports(bindings)) return;
  for (const element of bindings.elements) {
    const name = (element.propertyName ?? element.name).text;
    if (name === 'env') report(element);
    else if (name === 'default') add(element.name);
  }
}

function processImportSymbols(ts: TypeScriptApi, checker: TypeChecker, sourceFile: SourceFile, report: Reporter): Set<TsSymbol> {
  const imports = new Set<TsSymbol>();
  const add = (name: Identifier): void => {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol) imports.add(symbol);
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || !PROCESS_MODULES.has(statement.moduleSpecifier.text)) continue;
    recordProcessBindings(ts, statement.importClause, add, report);
  }
  return imports;
}

/** Process bindings are resolved by symbol, so a nested parameter cannot masquerade as an imported process. */
function processAccess(ts: TypeScriptApi, checker: TypeChecker, sourceFile: SourceFile, report: Reporter): (node: Node) => void {
  const imports = processImportSymbols(ts, checker, sourceFile, report);
  const isProcess = (expression: Node | undefined): boolean => {
    const node = unwrapExpression(ts, expression);
    if (!node) return false;
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      return (symbol !== undefined && imports.has(symbol)) || isGlobalName(ts, checker, node, PROCESS_GLOBAL);
    }
    return accessName(ts, node) === 'process'
      && isGlobalName(ts, checker, (node as AccessExpression).expression, GLOBAL_HOLDERS); // reason: accessName names only property and element accesses
  };
  return (node: Node): void => {
    if (accessName(ts, node) === 'env' && isProcess((node as AccessExpression).expression)) report(node); // reason: accessName names only property and element accesses
    if (ts.isVariableDeclaration(node) && node.initializer && isProcess(node.initializer) && ts.isObjectBindingPattern(node.name)
      && node.name.elements.some(element => bindingName(ts, element) === 'env')) report(node);
    if (ts.isCallExpression(node) && accessName(ts, node.expression) === 'get'
      && isGlobalName(ts, checker, (node.expression as AccessExpression).expression, REFLECT_GLOBAL)
      && isProcess(node.arguments[0]) && node.arguments[1] && ts.isStringLiteralLike(node.arguments[1]) && node.arguments[1].text === 'env') report(node);
  };
}

/** The declaration, rather than the caller's name, identifies EnvSource readers and configuration helpers. */
function appEnvironmentCall(config: ArchitectureConfig, ts: TypeScriptApi, checker: TypeChecker, call: CallExpression): boolean {
  const declaration = checker.getResolvedSignature(call)?.declaration;
  if (!declaration) return false;
  const relative = relativePath(config.root, declaration.getSourceFile().fileName);
  if (ts.isMethodDeclaration(declaration) && ts.isClassDeclaration(declaration.parent) && declaration.parent.name?.text === 'EnvSource') {
    return config.hfs.tierOf(relative) === 'platform' && path.posix.basename(config.hfs.ownerOf(relative)?.root ?? '') === 'config';
  }
  if (!ts.isFunctionDeclaration(declaration) && !ts.isArrowFunction(declaration) && !ts.isFunctionExpression(declaration)) return false;
  return allowsFile(config.hfs, relative)?.entry === '<app>.env.ts'
    || (path.posix.basename(relative).endsWith('.config.ts') && config.hfs.slotOf(relative) !== null);
}

/** Composition groups and options consume parsed options; only the app's matching env role and main read them. */
export function checkApplicationEnvironment(config: ArchitectureConfig, context: ApplicationEnvironmentContext, sourceFile: SourceFile, fileName: string, violations: ArchitectureViolation[]): void {
  const role = allowsFile(config.hfs, relativePath(config.root, fileName));
  if (role?.allowed && (role.entry === 'main.ts' || role.entry === '<app>.env.ts')) return;
  const { ts } = context;
  const checker = context.checkerFor(fileName);
  const report: Reporter = node => violations.push({
    ruleId: 'BE_APP_COMPOSITION_ONLY',
    path: relativePath(config.root, fileName),
    ...sourceLocation(sourceFile, node),
    message: "Application environment reads live in main.ts or the matching <app>.env.ts. Options files and compose/<area>.ts receive the typed result of read<App>Env(env: EnvSource).",
  });
  const checkProcess = processAccess(ts, checker, sourceFile, report);
  const visit = (node: Node): void => {
    checkProcess(node);
    if (ts.isCallExpression(node) && appEnvironmentCall(config, ts, checker, node)) report(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
