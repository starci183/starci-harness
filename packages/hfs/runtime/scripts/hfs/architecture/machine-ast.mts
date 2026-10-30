import path from 'node:path';
import type {
  Declaration, Decorator, Expression, Node, ObjectLiteralExpression, PropertyAssignment, ShorthandPropertyAssignment,
  SourceFile, StringLiteral, Symbol as TsSymbol, Type, TypeChecker,
} from 'typescript';
import { canonical } from './config.mjs';
import type { TypeScriptApi } from './config.mjs';
import type { GraphFile, HfsGraph } from './hfs-graph.mjs';
import { hasAnyFlag, sourceLocation } from '../../lib/ts-ast.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

const HELPER_DEPTH = 4;

/** The part of the checker context the reading kit uses: the compiler API and the per-file checker. */
export interface MachineContext {
  ts: TypeScriptApi;
  checkerFor: (fileName: string) => TypeChecker;
}

/** What `machineKit` is built from: the checker context and the HFS graph. */
export interface MachineInput {
  context: MachineContext;
  graph: HfsGraph;
}

/** The environment every kit operation receives as its first argument. */
export interface MachineEnv {
  ts: TypeScriptApi;
  context: MachineContext;
  graph: HfsGraph;
}

/** A name bound by an import: the imported name (`default` or `*` for those forms) and its module specifier. */
export interface ImportBinding {
  name: string;
  module: string;
}

/** The capability (owner) of a declaration: its file, owner root, slot, tier and owner directory name. */
export interface DeclarationOwner {
  rel: string;
  root: string;
  slot: string;
  tier: string | null;
  name: string;
}

/** One `{ provide: <token>, ... }` provider literal found by `providersOf`. */
export interface ProviderEntry {
  node: Node;
  useClass: Expression | null;
  checker: TypeChecker;
}

/** A property of an object literal the kit can read by name. */
export type NamedProperty = PropertyAssignment | ShorthandPropertyAssignment;

/** A location row: repository-relative path, 1-based line and column, plus the caller's extra fields (`path` is typed optional so a call site may spread the row after its own `path`). */
export interface LocatedRow {
  path?: string;
  line: number;
  column: number;
  [extra: string]: unknown;
}

/** The state one provider search shares across its helper-following recursion. */
interface ProviderSearch {
  name: string;
  moduleName: string;
  found: ProviderEntry[];
  seen: Set<Declaration>;
}

const checkerOf = (env: MachineEnv, sourceFile: SourceFile): TypeChecker => env.context.checkerFor(sourceFile.fileName);

function aliased(env: MachineEnv, checker: TypeChecker, symbol: TsSymbol | null | undefined): TsSymbol | null | undefined {
  const { ts } = env;
  const seen = new Set<TsSymbol>();
  let current = symbol;
  while (current && hasAnyFlag(current.flags, ts.SymbolFlags.Alias) && !seen.has(current)) {
    seen.add(current);
    let target: TsSymbol | undefined;
    try { target = checker.getAliasedSymbol(current); } catch { break; }
    if (!target || target === current || !(target.declarations?.length)) break;
    current = target;
  }
  return current;
}

function symbolAt(env: MachineEnv, checker: TypeChecker, node: Node | null | undefined): TsSymbol | null {
  const { ts } = env;
  if (!node) return null;
  const parent: Node | undefined = node.parent;
  if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) return checker.getShorthandAssignmentValueSymbol(parent) ?? null;
  return checker.getSymbolAtLocation(node) ?? null;
}

/** {name, module} when `target` is bound directly by an import specifier, default import or namespace import, else null. */
function ownImportBinding(env: MachineEnv, checker: TypeChecker, target: Node): ImportBinding | null {
  const { ts } = env;
  const declaration = symbolAt(env, checker, target)?.declarations?.[0];
  if (!declaration) return null;
  // The module specifier of an import declaration is always a string literal in a program that parses.
  if (ts.isImportSpecifier(declaration)) return { name: (declaration.propertyName ?? declaration.name).text, module: (declaration.parent.parent.parent.moduleSpecifier as StringLiteral).text };
  if (ts.isImportClause(declaration)) return { name: 'default', module: (declaration.parent.moduleSpecifier as StringLiteral).text };
  if (ts.isNamespaceImport(declaration)) return { name: '*', module: (declaration.parent.parent.moduleSpecifier as StringLiteral).text };
  return null;
}

/** {name, module} when `node` (identifier, or namespace.member) is bound by an import from a module specifier, else null. */
function importBinding(env: MachineEnv, checker: TypeChecker, node: Node): ImportBinding | null {
  const { ts } = env;
  if (ts.isIdentifier(node)) return ownImportBinding(env, checker, node);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const namespace = ownImportBinding(env, checker, node.expression);
    return namespace?.name === '*' ? { name: node.name.text, module: namespace.module } : null;
  }
  return null;
}

function isImportOf(env: MachineEnv, checker: TypeChecker, node: Node, name: string, moduleName: string): boolean {
  const binding = importBinding(env, checker, node);
  return binding !== null && binding.name === name && binding.module === moduleName;
}

/** The declarations `node` resolves to through aliases. */
const declarationsOf = (env: MachineEnv, checker: TypeChecker, node: Node | null | undefined): Declaration[] => aliased(env, checker, symbolAt(env, checker, node))?.declarations ?? [];

/** The repository-relative graph path of the file declaring `declaration`, or null when it is outside the program. */
const graphPath = (env: MachineEnv, declaration: Declaration): string | null => env.graph.abs(canonical(declaration.getSourceFile().fileName));

const graphFile = (env: MachineEnv, rel: string): GraphFile | null => env.graph.files.get(rel) ?? null;

/** The capability (owner) root, slot and tier of a declaration, or null. */
function ownerOfDeclaration(env: MachineEnv, declaration: Declaration): DeclarationOwner | null {
  const rel = graphPath(env, declaration);
  const file = rel ? graphFile(env, rel) : null;
  return rel && file?.owner ? { rel, root: file.owner.root, slot: file.owner.slot, tier: file.tier, name: path.posix.basename(file.owner.root) } : null;
}

/** The string a node evaluates to: a literal, or a const whose type is a string literal. */
function stringValue(env: MachineEnv, checker: TypeChecker, node: Node | null | undefined): string | null {
  const { ts } = env;
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  let type: Type;
  try { type = checker.getTypeAtLocation(node); } catch { return null; }
  if (type?.isStringLiteral?.()) return type.value;
  const declaration = declarationsOf(env, checker, ts.isPropertyAccessExpression(node) ? node.name : node)[0];
  if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return stringValue(env, checker, declaration.initializer);
  return null;
}

function walk(env: MachineEnv, node: Node, visit: (child: Node) => boolean | void): void {
  const step = (child: Node): void => {
    if (visit(child) === false) return;
    env.ts.forEachChild(child, step);
  };
  step(node);
}

const decorators = (env: MachineEnv, node: Node): readonly Decorator[] => (env.ts.canHaveDecorators?.(node as Parameters<TypeScriptApi['canHaveDecorators']>[0]) ? env.ts.getDecorators(node as Parameters<TypeScriptApi['getDecorators']>[0]) ?? [] : []);
// reason: getCombinedModifierFlags reads only the modifiers, which a VariableStatement carries as well as a Declaration.
const isExported = (env: MachineEnv, node: Node): boolean => hasAnyFlag(env.ts.getCombinedModifierFlags?.(node as Declaration), env.ts.ModifierFlags.Export);

function propertyNameText(env: MachineEnv, name: Node | null | undefined): string | null {
  if (!name) return null;
  if (env.ts.isIdentifier(name) || env.ts.isStringLiteralLike(name)) return name.text;
  return null;
}

/** The object literal properties of `literal` by static name. */
const propertyOf = (env: MachineEnv, literal: ObjectLiteralExpression, key: string): NamedProperty | undefined => literal.properties
  .find((property): property is NamedProperty => (env.ts.isPropertyAssignment(property) || env.ts.isShorthandPropertyAssignment(property)) && propertyNameText(env, property.name) === key);

const valueOfProperty = (env: MachineEnv, property: NamedProperty): Expression => (env.ts.isPropertyAssignment(property) ? property.initializer : property.name);

const at = (_env: MachineEnv, rel: string, sourceFile: SourceFile, node: Node, extra: Record<string, unknown> = {}): LocatedRow => ({ path: rel, ...sourceLocation(sourceFile, node), ...extra });

/** The app root file of an app (apps/<name>/src/app.module.ts), or null when the program does not hold it. */
const appRoot = (env: MachineEnv, name: string): GraphFile | null => graphFile(env, `apps/${name}/src/app.module.ts`);

/**
 * Whether a repository-relative file is a composition group of an app: `apps/<app>/src/compose/<area>.ts`, the module list of
 * one area that the app root spreads into its imports (slot allows `compose/<area>.ts` of every be.app.* slot).
 */
export const isComposeGroup = (rel: string): boolean => /^apps\/[^/]+\/src\/compose\/[^/]+\.ts$/.test(rel) && !/\.(?:spec|d)\.ts$/.test(rel);

/** The app root and the composition groups of an app, in path order (the root first); [] when the program holds no root. */
const appCompositionFiles = (env: MachineEnv, name: string): GraphFile[] => {
  const root = appRoot(env, name);
  if (!root) return [];
  const prefix = `apps/${name}/src/compose/`;
  const groups = [...env.graph.files.values()].filter(file => file.rel.startsWith(prefix) && isComposeGroup(file.rel));
  return [root, ...groups.sort((a, b) => byCodeUnit(a.rel, b.rel))];
};

/** The body a call or a spread identifier resolves to when it is a function or a const declared in a file of the program (not a package), else null. */
function helperBodyOf(env: MachineEnv, checker: TypeChecker, node: Node): { declaration: Declaration; body: Node } | null {
  const { ts } = env;
  const target = ts.isCallExpression(node) ? node.expression : node;
  for (const declaration of declarationsOf(env, checker, ts.isPropertyAccessExpression(target) ? target.name : target)) {
    if (!graphPath(env, declaration)) continue;
    if (ts.isFunctionDeclaration(declaration) && declaration.body) return { declaration, body: declaration.body };
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) return { declaration, body: declaration.initializer };
  }
  return null;
}

/** The provider entry of an object literal that provides `name` imported from `moduleName`, or null. */
function providerEntry(env: MachineEnv, search: ProviderSearch, checker: TypeChecker, literal: ObjectLiteralExpression, anchor: Node | null): ProviderEntry | null {
  const provide = propertyOf(env, literal, 'provide');
  if (!provide || !isImportOf(env, checker, valueOfProperty(env, provide), search.name, search.moduleName)) return null;
  const use = propertyOf(env, literal, 'useClass');
  return { node: anchor ?? literal, useClass: use ? valueOfProperty(env, use) : null, checker };
}

/** The expression that may reference a helper: the argument of a spread, or the call itself. */
function helperReferenceOf(ts: TypeScriptApi, node: Node): Expression | null {
  if (ts.isSpreadElement(node)) return node.expression;
  return ts.isCallExpression(node) ? node : null;
}

function followHelper(env: MachineEnv, search: ProviderSearch, checker: TypeChecker, node: Node, anchor: Node | null, depth: number): void {
  const reference = helperReferenceOf(env.ts, node);
  if (!reference || depth >= HELPER_DEPTH) return;
  const helper = helperBodyOf(env, checker, reference);
  if (!helper || search.seen.has(helper.declaration)) return;
  search.seen.add(helper.declaration);
  scanProviders(env, search, helper.body, anchor ?? node, depth + 1);
}

function scanProviders(env: MachineEnv, search: ProviderSearch, root: Node, anchor: Node | null, depth: number): void {
  const checker = checkerOf(env, root.getSourceFile());
  walk(env, root, node => {
    if (!env.ts.isObjectLiteralExpression(node)) {
      followHelper(env, search, checker, node, anchor, depth);
      return;
    }
    const entry = providerEntry(env, search, checker, node, anchor);
    if (entry) search.found.push(entry);
  });
}

/**
 * The `{ provide: <token>, ... }` provider literals of `file` whose token is `name` imported from `moduleName`, in source order.
 * A call or a spread of a function or a const declared in another file of the program is followed (to a depth of four), so a
 * helper that builds the `APP_GUARD` or `APP_FILTER` entries outside the app root file is read too: the entry's `node` is then the
 * call or spread inside the app root (where the entry is provided), its `useClass` and `checker` those of the helper's file.
 */
function providersOf(env: MachineEnv, file: { sourceFile: SourceFile }, name: string, moduleName: string): ProviderEntry[] {
  const search: ProviderSearch = { name, moduleName, found: [], seen: new Set() };
  scanProviders(env, search, file.sourceFile, null, 0);
  return search.found.sort((a, b) => a.node.getStart() - b.node.getStart());
}

/**
 * The small TypeScript reading kit the R33/R38/R39/R41/R45/R84/R86 machine checks share (connection-map, sql-owner,
 * register-once, error-masked, default-deny-app-guard, entrypoint-only-in-apps, error-home). Everything is decided by
 * the checker and by where a declaration lives (the HFS graph), never by a variable name: a framework symbol is
 * recognised by the package it is imported from, a capability class by the file that declares it.
 */
export function machineKit({ context, graph }: MachineInput) {
  const env: MachineEnv = { ts: context.ts, context, graph };
  const bound = <Args extends unknown[], Result>(operation: (env: MachineEnv, ...args: Args) => Result) => (...args: Args): Result => operation(env, ...args);
  return {
    ts: env.ts,
    resolver: graph.resolver,
    providersOf: bound(providersOf),
    checkerOf: bound(checkerOf),
    aliased: bound(aliased),
    symbolAt: bound(symbolAt),
    importBinding: bound(importBinding),
    isImportOf: bound(isImportOf),
    declarationsOf: bound(declarationsOf),
    graphPath: bound(graphPath),
    graphFile: bound(graphFile),
    ownerOfDeclaration: bound(ownerOfDeclaration),
    stringValue: bound(stringValue),
    walk: bound(walk),
    decorators: bound(decorators),
    isExported: bound(isExported),
    propertyNameText: bound(propertyNameText),
    propertyOf: bound(propertyOf),
    valueOfProperty: bound(valueOfProperty),
    at: bound(at),
    appRoot: bound(appRoot),
    appCompositionFiles: bound(appCompositionFiles),
  };
}

/** The reading kit `machineKit` builds. */
export type MachineKit = ReturnType<typeof machineKit>;

export const upperSnake = (name: string): string => name.replaceAll('-', '_').toUpperCase();
export const pascal = (name: string): string => name.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
