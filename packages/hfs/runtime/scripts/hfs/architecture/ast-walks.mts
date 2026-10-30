// ast-walks.mjs - AST walks the architecture checkers share (moved out of typescript.mjs, which keeps the program loading and module resolution).
import type {
  Declaration, Decorator, Expression, Identifier, Node, PrivateIdentifier, Program, SourceFile,
  StringLiteralLike, Symbol as TsSymbol, TypeChecker,
} from 'typescript';
import { canonical, isInside } from './config.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation } from './hfs-graph.mjs';
import { hasAnyFlag, isConstVariable, sourceLocation } from '../../lib/ts-ast.mjs';
import { UNPROVEN_FRAMEWORK, isUnshadowedCommonJsRequire, relativePath, unwrapExpression } from './typescript.mjs';

/** One finding row: rule id, root-relative path, node position and message, plus rule extras. */
export type Violation = ArchitectureViolation;

/** The compiler programs a checker context owns (what `programSourcesOf` searches). */
export interface ProgramContext {
  programs: Program[];
}

/** What `tracedFrameworkKinds` hands a `directOf` callback for one selected node. */
export interface DirectOfInput {
  symbol: TsSymbol;
  selected: Node;
  targets: Map<TsSymbol, string>;
}

/** Maps a selected node's symbol to a framework kind, or null. */
export type DirectOf = (ts: TypeScriptApi, checker: TypeChecker, input: DirectOfInput) => string | null | undefined;

/** Maps a shorthand-property's value symbol to a framework kind, or null. */
export type ShorthandOf = (ts: TypeScriptApi, checker: TypeChecker, target: TsSymbol | null | undefined, targets: Map<TsSymbol, string>) => string | null | undefined;

/** The options `tracedFrameworkKinds` takes (`seen` and `depth` are its own recursion state). */
export interface TraceOptions {
  seen?: Set<TsSymbol>;
  depth?: number;
  directOf?: DirectOf | null;
  shorthandOf?: ShorthandOf | null;
  newExpression?: boolean;
}

/** The module a statement statically binds (see `moduleExportsOf`). */
export interface ModuleExports {
  specifierNode: StringLiteralLike;
  specifier: string;
  symbol: TsSymbol | null;
  exports: Map<string, TsSymbol | null>;
}

/** `expression` unwrapped by the caller's own predicate set (a predicate absent on an older ts reads as never). */
export function unwrapEach(_ts: TypeScriptApi, expression: Node | null | undefined,
  predicates: readonly (((node: Node) => boolean) | null | undefined)[]): Node | null | undefined {
  let current = expression;
  // The predicates the caller passes select wrapper nodes, which all carry an `expression` child.
  while (current && predicates.some((predicate) => predicate?.(current as Node))) current = (current as Node & { expression: Node }).expression;
  return current;
}

/** `value` with every TS alias hop resolved (a re-exported import reads as its target symbol). */
export function normalizedSymbolValue(ts: TypeScriptApi, checker: TypeChecker, value: TsSymbol | null | undefined = null): TsSymbol | null | undefined {
  let symbol = value;
  const seen = new Set<TsSymbol>();
  while (symbol && hasAnyFlag(symbol.flags, ts.SymbolFlags.Alias) && !seen.has(symbol)) {
    seen.add(symbol);
    const target = checker.getAliasedSymbol(symbol);
    if (!target || target === symbol) break;
    symbol = target;
  }
  return symbol;
}

/** The symbol `node` names, aliases resolved. */
export function normalizedSymbol(ts: TypeScriptApi, checker: TypeChecker, node: Node): TsSymbol | null | undefined {
  return normalizedSymbolValue(ts, checker, checker?.getSymbolAtLocation(node) ?? null);
}

/** The identifier or member-name node an expression selects through unwrapExpression, or null. */
export function selectedNode(ts: TypeScriptApi, expression: Node): Identifier | PrivateIdentifier | StringLiteralLike | null {
  const unwrapped: Node = unwrapExpression(ts, expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped;
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name;
  if (ts.isElementAccessExpression(unwrapped) && ts.isStringLiteralLike(unwrapped.argumentExpression)) return unwrapped.argumentExpression;
  return null;
}

/**
 * The symbol `node` ultimately evaluates to: its own symbol, followed through a single `const` variable
 * initializer (and so on). `unselected: 'null'` answers null when `node` selects no name at all.
 */
export function valueSymbol(ts: TypeScriptApi, checker: TypeChecker, node: Node, seen: Set<TsSymbol> = new Set(),
  { unselected = 'node' }: { unselected?: 'node' | 'null' } = {}): TsSymbol | null | undefined {
  const selected = selectedNode(ts, node);
  if (!selected && unselected === 'null') return null;
  const symbol = normalizedSymbol(ts, checker, selected ?? node);
  if (!symbol || seen.has(symbol)) return symbol;
  seen.add(symbol);
  const declarations = symbol.getDeclarations?.() ?? [];
  const [only] = declarations;
  if (declarations.length === 1 && only && ts.isVariableDeclaration(only) && only.initializer
    && isConstVariable(ts, only)) {
    return valueSymbol(ts, checker, only.initializer, seen, { unselected });
  }
  return symbol;
}

/**
 * The expressions `declaration` returns: its body when it is an expression-bodied arrow/function, else every
 * `return`'s argument without descending into nested functions. `functionLike` overrides which node kinds bound
 * that descent (default the four callable declaration kinds; pass `ts.isFunctionLike` for the wider set).
 */
export function returnedExpressions(ts: TypeScriptApi, declaration: Node,
  { functionLike = null }: { functionLike?: ((node: Node) => boolean) | null } = {}): Expression[] {
  const boundary = functionLike ?? ((node: Node) => ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
    || ts.isArrowFunction(node) || ts.isFunctionExpression(node));
  if ((ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) && !ts.isBlock(declaration.body)) return [declaration.body];
  // A node the boundary predicate accepts is a function-like, which carries a `body`.
  const body = boundary(declaration) ? (declaration as Node & { body?: Node }).body : null;
  if (!body || !ts.isBlock(body)) return [];
  const returned: Expression[] = [];
  const visit = (node: Node): void => {
    if (node !== body && boundary(node)) return;
    if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
    else ts.forEachChild(node, visit);
  };
  visit(body);
  return returned;
}

/** A node's decorators across TS versions (ts.getDecorators, else the legacy `decorators` property). */
export function nodeDecorators(ts: TypeScriptApi, node: Node): readonly Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : (node as Node & { decorators?: readonly Decorator[] }).decorators ?? [];
}

/** One finding row: rule id, root-relative path, node position and message, plus rule extras. */
export function violation(config: ArchitectureConfig, sourceFile: SourceFile, node: Node, ruleId: string, message: string,
  extra: Record<string, unknown> = {}): Violation {
  return { ruleId, path: relativePath(config.root, sourceFile.fileName), ...sourceLocation(sourceFile, node), message, ...extra };
}

/** Whether `match` holds for `node` or a descendant (the walk stops at the first match). */
export function anyDescendant(ts: TypeScriptApi, node: Node, match: (node: Node) => boolean): boolean {
  let found = false;
  const visit = (current: Node): void => {
    if (found) return;
    if (match(current)) { found = true; return; }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * The framework kinds `expression` can produce: `directOf(ts, checker, {symbol, selected, targets})` maps a
 * selected node's symbols to a kind (default `targets.get(symbol)`); `shorthandOf` (when set) also resolves
 * shorthand-property declarations and descends property assignments; `newExpression` descends `new X()` callees.
 */
const addKinds = (target: Set<string>, source: Iterable<string>): void => { for (const kind of source) target.add(kind); };

const kindsFromReturns = (ts: TypeScriptApi, checker: TypeChecker, declaration: Node, targets: Map<TsSymbol, string>, options: TraceOptions): Set<string> => {
  const kinds = new Set<string>();
  for (const returned of returnedExpressions(ts, declaration)) addKinds(kinds, tracedFrameworkKinds(ts, checker, returned, targets, options));
  return kinds;
};

const kindsFromDeclaration = (ts: TypeScriptApi, checker: TypeChecker, declaration: Declaration, targets: Map<TsSymbol, string>,
  options: TraceOptions, shorthandOf: ShorthandOf | null | undefined): Set<string> => {
  const kinds = new Set<string>();
  if (ts.isVariableDeclaration(declaration) && declaration.initializer)
    addKinds(kinds, tracedFrameworkKinds(ts, checker, declaration.initializer, targets, options));
  if (shorthandOf && ts.isShorthandPropertyAssignment(declaration)) {
    const target = normalizedSymbolValue(ts, checker, checker.getShorthandAssignmentValueSymbol?.(declaration));
    const kind = shorthandOf(ts, checker, target, targets);
    if (kind) kinds.add(kind);
  }
  if (shorthandOf && ts.isPropertyAssignment(declaration))
    addKinds(kinds, tracedFrameworkKinds(ts, checker, declaration.initializer, targets, options));
  addKinds(kinds, kindsFromReturns(ts, checker, declaration, targets, options));
  return kinds;
};

const kindsFromSymbol = (ts: TypeScriptApi, checker: TypeChecker, symbol: TsSymbol, targets: Map<TsSymbol, string>, seen: Set<TsSymbol>,
  options: TraceOptions): Set<string> => {
  const nextSeen = new Set(seen).add(symbol);
  const declarationOptions = { ...options, seen: nextSeen };
  const kinds = new Set<string>();
  for (const declaration of symbol.getDeclarations?.() ?? [])
    addKinds(kinds, kindsFromDeclaration(ts, checker, declaration, targets, declarationOptions, options.shorthandOf));
  return kinds;
};

const defaultDirectOf: DirectOf = (_ts, _checker, { symbol, targets }) => targets.get(symbol) ?? null;

export function tracedFrameworkKinds(ts: TypeScriptApi, checker: TypeChecker, expression: Node | null | undefined, targets: Map<TsSymbol, string>,
  { seen = new Set(), depth = 0, directOf = null, shorthandOf = null, newExpression = false }: TraceOptions = {}): Set<string> {
  if (!expression) return new Set();
  if (depth > 10) return new Set([UNPROVEN_FRAMEWORK]);
  const unwrapped: Node = unwrapExpression(ts, expression);
  const selected = selectedNode(ts, unwrapped);
  const symbol = selected ? normalizedSymbol(ts, checker, selected) : null;
  const direct = symbol && selected ? (directOf ?? defaultDirectOf)(ts, checker, { symbol, selected, targets }) : null;
  if (direct) return new Set([direct]);
  const options = { depth: depth + 1, directOf, shorthandOf, newExpression };
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) return kindsFromReturns(ts, checker, unwrapped, targets, { ...options, seen });
  if (ts.isCallExpression(unwrapped)) {
    const kinds = tracedFrameworkKinds(ts, checker, unwrapped.expression, targets, { ...options, seen });
    if (kinds.size) return kinds;
  }
  if (newExpression && ts.isNewExpression(unwrapped))
    return tracedFrameworkKinds(ts, checker, unwrapped.expression, targets, { ...options, seen });
  if (!symbol || seen.has(symbol)) return new Set();
  return kindsFromSymbol(ts, checker, symbol, targets, seen, options);
}

/** 'unproven framework' | 'multiple framework' | the one kind | null, for a decorator whose expression constructs. */
export function constructedDecoratorKind(ts: TypeScriptApi, checker: TypeChecker, decorator: Decorator, targets: Map<TsSymbol, string>,
  traceOpts: TraceOptions = {}): string | null {
  const callee = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
  const kinds = tracedFrameworkKinds(ts, checker, callee, targets, traceOpts);
  if (kinds.has(UNPROVEN_FRAMEWORK)) return 'unproven framework';
  if (kinds.size === 1) return [...kinds][0] ?? null;
  return kinds.size ? 'multiple framework' : null;
}

/** The target a decorator resolves to through a `let`/`var` alias's single initializer, or null. */
export function mutableDecoratorKind(ts: TypeScriptApi, checker: TypeChecker, decorator: Decorator, targets: Map<TsSymbol, string>): string | null {
  const callee = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
  const selected = selectedNode(ts, callee);
  const symbol = selected ? normalizedSymbol(ts, checker, selected) : null;
  const declarations = symbol?.getDeclarations?.() ?? [];
  const [only] = declarations;
  if (declarations.length !== 1 || !only || !ts.isVariableDeclaration(only) || !only.initializer
    || isConstVariable(ts, only)) return null;
  const resolved = valueSymbol(ts, checker, only.initializer);
  return (resolved ? targets.get(resolved) : undefined) ?? null;
}

/** The callee expression of a decorator (the called expression of `@x(...)`, else the expression itself). */
export function decoratorCallee(ts: TypeScriptApi, decorator: Decorator): Expression {
  return ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
}

/**
 * The module `statement` (import, export-from or import-equals) statically binds: its specifier text, the
 * module's symbol and its exported symbols by name (aliases resolved); `symbol` is null when the module does
 * not resolve. Null when the statement names no static specifier.
 */
export function moduleExportsOf(ts: TypeScriptApi, checker: TypeChecker, statement: Node): ModuleExports | null {
  let moduleSpecifier: StringLiteralLike | null = null;
  if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
    && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) moduleSpecifier = statement.moduleSpecifier;
  let importEquals: StringLiteralLike | null = null;
  if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)
    && statement.moduleReference.expression && ts.isStringLiteralLike(statement.moduleReference.expression)) importEquals = statement.moduleReference.expression;
  const specifierNode = moduleSpecifier ?? importEquals;
  if (!specifierNode) return null;
  const specifier = specifierNode.text;
  const symbol = checker.getSymbolAtLocation(specifierNode) ?? null;
  const exports = new Map((symbol ? checker.getExportsOfModule(symbol) : [])
    .map((item): [string, TsSymbol | null] => [item.getName(), normalizedSymbolValue(ts, checker, item) ?? null]));
  return { specifierNode, specifier, symbol, exports };
}

/**
 * The program source files a framework-target scan of `checker` judges: every file in `localFiles`, plus (when
 * `root` is given) declaration files inside the root but outside node_modules. Null when no program of the
 * context owns the checker.
 */
export function programSourcesOf(context: ProgramContext, checker: TypeChecker, localFiles: ReadonlySet<string>,
  { root = null }: { root?: string | null } = {}): SourceFile[] | null {
  const program = context.programs.find(candidate => candidate.getTypeChecker() === checker) ?? null;
  if (!program) return null;
  return program.getSourceFiles().filter(sourceFile => localFiles.has(canonical(sourceFile.fileName))
    || (root && sourceFile.isDeclarationFile && isInside(root, sourceFile.fileName)
      && !sourceFile.fileName.replaceAll('\\', '/').includes('/node_modules/')));
}

/**
 * The CommonJS require() caveat every framework scan reports: each `require('<specifier>')` `accepted` pushes
 * `${filePath} uses a CommonJS <label ?? specifier> <detail>` (the import-shape reasoning cannot prove that binding).
 */
export function commonJsRequireReasons(ts: TypeScriptApi, checker: TypeChecker, sourceFile: SourceFile, accepted: (specifier: string) => boolean,
  reasons: string[], filePath: string, detail: string, labelArgument?: string | null): void {
  const label: string | null = labelArgument ?? null;
  const visit = (node: Node): void => {
    if (ts.isCallExpression(node) && isUnshadowedCommonJsRequire(ts, checker, node.expression) && node.arguments.length === 1) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument) && accepted(argument.text)) {
        reasons.push(`${filePath} uses a CommonJS ${label ?? argument.text} ${detail}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
