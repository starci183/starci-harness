import path from 'node:path';
import type {
  CallExpression, Declaration, ElementAccessExpression, Expression, FunctionLikeDeclaration, Identifier, MethodDeclaration,
  NamedImports, Node, PropertyAccessExpression, SourceFile, Statement, Symbol as TsSymbol, TypeChecker,
} from 'typescript';
import { normalizedSymbolValue, returnedExpressions as sharedReturnedExpressions } from './ast-walks.mjs';
import type { Violation } from './ast-walks.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import { reachableViolation, relativePath, unwrapExpression } from './typescript.mjs';
import type { ImportEdge } from './typescript.mjs';
import type { TypeContext } from './type-context.mjs';
import { WorldRenderAnalysis } from './frontend-world-render.mjs';
const WORLD_NAVIGATION_CALLS = new Set(['useParams', 'usePathname', 'useRouter', 'useSearchParams', 'useSelectedLayoutSegment', 'useSelectedLayoutSegments']);
const WORLD_INTL_CALLS = new Set(['useLocale', 'useMessages', 'useNow', 'useTimeZone', 'useTranslations']);
const WORLD_SWR_CALLS = new Set(['default', 'useSWR', 'useSWRConfig', 'useSWRImmutable', 'useSWRMutation']);
const LOWER_COMPONENT_TIERS = new Set(['composites', 'branches', 'leaves']);

/** The absolute root directories of each frontend area the world analysis judges. */
export interface WorldRoots {
  routes: string[];
  features: string[];
  components: string[];
  hooks: string[];
  modules: string[];
  transport: string[];
}

/** One import edge the TypeScript context recorded (absolute `to`). */
export type WorldEdge = ImportEdge;

/** The TypeScript context the world analysis reads. */
export type WorldContext = TypeContext;

/** The component tier of a file and the component root it sits under. */
export interface ComponentTier {
  tier: string;
  root: string;
}

/** The frontend checker's own helpers, handed to the analysis. */
export interface WorldHelpers {
  insideAny(candidates: readonly string[], fileName: string): boolean;
  rootFor(candidates: readonly string[], fileName: string): string | null;
  tierOf(componentRoots: readonly string[], fileName: string): ComponentTier | null;
  violation(config: ArchitectureConfig, sourceFile: SourceFile, node: Node, ruleId: string, message: string, extra?: Record<string, unknown>): Violation;
  declarationName(ts: TypeScriptApi, declaration: Node): Identifier | null;
  importsForSource(context: WorldContext, fileName: string): WorldEdge[];
}

/** A function-like declaration the analysis follows to a render or a world read. */
export type WorldFunction = FunctionLikeDeclaration;

/** What one source file imports from the product world: its checker, world symbols and world namespace imports. */
interface WorldImportInfo {
  checker: TypeChecker;
  symbols: Set<TsSymbol>;
  namespaces: Map<TsSymbol, { specifier: string; worldEdge: boolean | undefined }>;
}

function selectedSymbol(ts: TypeScriptApi, checker: TypeChecker, expression: Node): TsSymbol | null {
  const selected: Node | null | undefined = unwrapExpression(ts, expression);
  if (!selected) return null;
  if (ts.isIdentifier(selected)) return checker.getSymbolAtLocation(selected) ?? null;
  if (ts.isPropertyAccessExpression(selected)) return checker.getSymbolAtLocation(selected.name) ?? null;
  if (ts.isElementAccessExpression(selected) && ts.isStringLiteralLike(selected.argumentExpression)) {
    return checker.getSymbolAtLocation(selected.argumentExpression)
      ?? checker.getTypeAtLocation(selected.expression).getProperty(selected.argumentExpression.text)
      ?? null;
  }
  return null;
}

/* The wider boundary set: `ts.isFunctionLike` (includes call signatures' declarations) rather than the
 * four default callable kinds. */
const returnedExpressions = (ts: TypeScriptApi, declaration: Node) => sharedReturnedExpressions(ts, declaration, { functionLike: ts.isFunctionLike });

function knownWorldImport(specifier: string, imported: string): boolean {
  if (specifier === 'next-intl') return WORLD_INTL_CALLS.has(imported);
  if (specifier === 'next/navigation' || /(?:^|\/)i18n\/navigation$/.test(specifier)) return WORLD_NAVIGATION_CALLS.has(imported);
  if (specifier === 'swr' || specifier === 'swr/immutable' || specifier === 'swr/mutation') return WORLD_SWR_CALLS.has(imported);
  if (specifier === 'next-auth/react') return imported === 'useSession';
  return false;
}

class WorldAnalysis {
  readonly config: ArchitectureConfig;
  readonly context: WorldContext;
  readonly roots: WorldRoots;
  readonly ts: TypeScriptApi;
  // The checker's helpers are copied onto the instance by `Object.assign` in the constructor.
  declare readonly insideAny: WorldHelpers['insideAny'];
  declare readonly rootFor: WorldHelpers['rootFor'];
  declare readonly tierOf: WorldHelpers['tierOf'];
  declare readonly violation: WorldHelpers['violation'];
  declare readonly declarationName: WorldHelpers['declarationName'];
  declare readonly importsForSource: WorldHelpers['importsForSource'];
  readonly violations: Violation[];
  readonly sourceSet: Set<string>;
  readonly worldInfoCache: Map<string, WorldImportInfo>;
  readonly functionWorldCache: Map<WorldFunction, boolean>;
  readonly renderOutputCache: Map<Node, boolean>;
  readonly intrinsicUiHookCache: Map<string, boolean>;
  readonly renderer: WorldRenderAnalysis;

  constructor(config: ArchitectureConfig, context: WorldContext, roots: WorldRoots, helpers: WorldHelpers) {
    this.config = config;
    this.context = context;
    this.roots = roots;
    this.ts = context.ts;
    Object.assign(this, helpers);
    this.violations = [];
    this.sourceSet = new Set(context.files.map(source => path.resolve(source.fileName)));
    this.worldInfoCache = new Map();
    this.functionWorldCache = new Map();
    this.renderOutputCache = new Map();
    this.intrinsicUiHookCache = new Map();
    this.renderer = new WorldRenderAnalysis(this, { selectedSymbol, returnedExpressions });
  }

  /** The checker of a program source file (every file the analysis visits belongs to a loaded program). */
  checkerFor(fileName: string): TypeChecker {
    const checker = this.context.checkerFor(fileName);
    if (!checker) throw new Error(`No type checker holds ${fileName}.`);
    return checker;
  }

  forbiddenIntrinsicEdge(edge: WorldEdge, nextVisiting: Set<string>): boolean {
    const forbidden = reachableViolation(this.context.edges, edge, (target: string) => this.insideAny(this.roots.transport, target)
      || this.insideAny(this.roots.modules, target) || this.insideAny(this.roots.features, target) || this.insideAny(this.roots.routes, target)
      // insideAny held, so the hooks root exists.
      || (this.insideAny(this.roots.hooks, target) && relativePath(this.rootFor(this.roots.hooks, target) as string, target).split('/')[0] !== 'ui'),
    { follow: (candidate: WorldEdge) => candidate.runtime });
    return Boolean(forbidden || (this.insideAny(this.roots.hooks, edge.to) && !this.intrinsicUiHookFile(edge.to, nextVisiting)));
  }

  forbiddenWorldImport(statement: Statement): boolean {
    if (!this.ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly
      || !this.ts.isStringLiteralLike(statement.moduleSpecifier)) return false;
    const specifier = statement.moduleSpecifier.text;
    const bindings: string[] = [];
    if (statement.importClause.name) bindings.push('default');
    const named = statement.importClause.namedBindings;
    if (named && this.ts.isNamespaceImport(named)
      && ['next/navigation', 'next-intl', 'swr', 'swr/immutable', 'swr/mutation', 'next-auth/react'].includes(specifier)) return true;
    if (named && this.ts.isNamedImports(named)) {
      for (const element of named.elements) if (!element.isTypeOnly) bindings.push(element.propertyName?.text ?? element.name.text);
    }
    return bindings.some(imported => knownWorldImport(specifier, imported));
  }

  containsUnshadowedFetch(sourceFile: SourceFile, checker: TypeChecker): boolean {
    let found = false;
    const visit = (node: Node): void => {
      if (!found && this.ts.isCallExpression(node) && this.ts.isIdentifier(node.expression) && node.expression.text === 'fetch'
        && (checker.getSymbolAtLocation(node.expression)?.getDeclarations() ?? []).every(declaration => declaration.getSourceFile().isDeclarationFile)) found = true;
      if (!found) this.ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  }

  intrinsicUiHookFile(fileName: string, visiting: Set<string> = new Set()): boolean {
    const resolved = path.resolve(fileName);
    const cached = this.intrinsicUiHookCache.get(resolved);
    if (cached !== undefined) return cached;
    const hookRoot = this.rootFor(this.roots.hooks, resolved);
    if (!hookRoot || relativePath(hookRoot, resolved).split('/')[0] !== 'ui' || visiting.has(resolved)) return false;
    const sourceFile = this.context.files.find(source => path.resolve(source.fileName) === resolved);
    if (!sourceFile) return false;
    this.intrinsicUiHookCache.set(resolved, false);
    const nextVisiting = new Set(visiting).add(resolved);
    const checker = this.checkerFor(resolved);
    const edges = this.importsForSource(this.context, resolved);
    let intrinsic = true;
    for (const edge of edges.filter(candidate => candidate.runtime)) {
      if (this.forbiddenIntrinsicEdge(edge, nextVisiting)) {
        intrinsic = false;
        break;
      }
    }
    for (const statement of sourceFile.statements) {
      if (!intrinsic) break;
      if (this.forbiddenWorldImport(statement)) { intrinsic = false; break; }
    }
    if (intrinsic && this.containsUnshadowedFetch(sourceFile, checker)) intrinsic = false;
    this.intrinsicUiHookCache.set(resolved, intrinsic);
    return intrinsic;
  }

  intrinsicUiHookSymbol(symbol: TsSymbol | null | undefined, checker: TypeChecker): boolean {
    const identity = normalizedSymbolValue(this.ts, checker, symbol);
    const declarations = identity?.getDeclarations?.() ?? [];
    return declarations.length > 0 && declarations.every(declaration => this.intrinsicUiHookFile(declaration.getSourceFile().fileName));
  }

  worldEdgeOf(edge: WorldEdge | undefined): boolean | undefined {
    return edge && Boolean(reachableViolation(this.context.edges, edge,
      (target: string) => this.insideAny(this.roots.hooks, target) || this.insideAny(this.roots.transport, target),
      { follow: (candidate: WorldEdge) => candidate.reexport && candidate.runtime }));
  }

  collectNamedWorldImports(checker: TypeChecker, named: NamedImports, specifier: string, worldEdge: boolean | undefined, symbols: Set<TsSymbol>): void {
    for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol && (worldEdge || knownWorldImport(specifier, imported))) symbols.add(symbol);
    }
  }

  inspectWorldImportStatement(sourceFile: SourceFile, checker: TypeChecker, byStart: Map<number, WorldEdge>, symbols: Set<TsSymbol>,
    namespaces: WorldImportInfo['namespaces'], statement: Statement): void {
    if (!this.ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly
      || !this.ts.isStringLiteralLike(statement.moduleSpecifier)) return;
    const specifier = statement.moduleSpecifier.text;
    const worldEdge = this.worldEdgeOf(byStart.get(statement.moduleSpecifier.getStart(sourceFile)));
    const clause = statement.importClause;
    if (clause.name) {
      const symbol = checker.getSymbolAtLocation(clause.name);
      if (symbol && (worldEdge || knownWorldImport(specifier, 'default'))) symbols.add(symbol);
    }
    const named = clause.namedBindings;
    if (named && this.ts.isNamedImports(named)) this.collectNamedWorldImports(checker, named, specifier, worldEdge, symbols);
    if (named && this.ts.isNamespaceImport(named)) {
      const symbol = checker.getSymbolAtLocation(named.name);
      if (symbol) namespaces.set(symbol, { specifier, worldEdge });
    }
  }

  importInfo(sourceFile: SourceFile): WorldImportInfo {
    const key = path.resolve(sourceFile.fileName);
    const cached = this.worldInfoCache.get(key);
    if (cached) return cached;
    const checker = this.checkerFor(sourceFile.fileName);
    const edges = this.importsForSource(this.context, sourceFile.fileName);
    const byStart = new Map(edges.map((edge): [number, WorldEdge] => [edge.node.getStart(sourceFile), edge]));
    const symbols = new Set<TsSymbol>();
    const namespaces: WorldImportInfo['namespaces'] = new Map();
    for (const statement of sourceFile.statements) this.inspectWorldImportStatement(sourceFile, checker, byStart, symbols, namespaces, statement);
    const value = { checker, symbols, namespaces };
    this.worldInfoCache.set(key, value);
    return value;
  }

  collectExpressionFunctions(declaration: Declaration, checker: TypeChecker, seen: Set<TsSymbol>, functions: WorldFunction[]): void {
    if (this.ts.isFunctionDeclaration(declaration) || this.ts.isMethodDeclaration(declaration)) functions.push(declaration);
    else if (this.ts.isVariableDeclaration(declaration) && declaration.initializer) {
      functions.push(...this.expressionFunctions(declaration.initializer, checker, seen));
    } else if (this.ts.isClassDeclaration(declaration)) {
      functions.push(...declaration.members.filter((member): member is MethodDeclaration => this.ts.isMethodDeclaration(member)
        && !!member.name && (this.ts.isIdentifier(member.name) || this.ts.isStringLiteralLike(member.name)) && member.name.text === 'render'));
    }
  }

  isComponentWrapperCall(call: CallExpression): boolean {
    const selected: Node = unwrapExpression(this.ts, call.expression);
    const name = (this.ts.isIdentifier(selected) && selected.text) || (this.ts.isPropertyAccessExpression(selected) && selected.name.text) || null;
    return name !== null && ['forwardRef', 'memo'].includes(name);
  }

  expressionFunctions(input: Node | null | undefined, checker: TypeChecker, seen: Set<TsSymbol> = new Set()): WorldFunction[] {
    const expression: Node | null | undefined = unwrapExpression(this.ts, input);
    if (!expression) return [];
    if (this.ts.isArrowFunction(expression) || this.ts.isFunctionExpression(expression) || this.ts.isMethodDeclaration(expression)
      || this.ts.isFunctionDeclaration(expression)) return [expression];
    if (this.ts.isConditionalExpression(expression)) {
      return [...this.expressionFunctions(expression.whenTrue, checker, seen), ...this.expressionFunctions(expression.whenFalse, checker, seen)];
    }
    if (this.ts.isCallExpression(expression) && this.isComponentWrapperCall(expression) && expression.arguments[0]) {
      return this.expressionFunctions(expression.arguments[0], checker, seen);
    }
    const symbol = normalizedSymbolValue(this.ts, checker, selectedSymbol(this.ts, checker, expression));
    if (!symbol || seen.has(symbol)) return [];
    const nextSeen = new Set(seen).add(symbol);
    const functions: WorldFunction[] = [];
    for (const declaration of symbol.getDeclarations?.() ?? []) this.collectExpressionFunctions(declaration, checker, nextSeen, functions);
    return [...new Set(functions.filter(fn => fn.body))];
  }

  symbolIsWorld(raw: TsSymbol | null | undefined, sourceFile: SourceFile, propertyName: string | null = null): boolean {
    if (!raw) return false;
    const info = this.importInfo(sourceFile);
    if (this.intrinsicUiHookSymbol(raw, info.checker)) return false;
    if (info.symbols.has(raw)) return true;
    for (const [namespace, declaration] of info.namespaces) if (namespace === raw) {
      return declaration.worldEdge || knownWorldImport(declaration.specifier, propertyName ?? '');
    }
    const identity = normalizedSymbolValue(this.ts, info.checker, raw);
    return (identity?.getDeclarations?.() ?? []).some(declaration => {
      const fileName = declaration.getSourceFile().fileName;
      return this.insideAny(this.roots.hooks, fileName) || this.insideAny(this.roots.transport, fileName);
    });
  }

  namespaceIsWorld(raw: TsSymbol | undefined, sourceFile: SourceFile, propertyName: string | null): boolean {
    const info = this.importInfo(sourceFile);
    const declaration = raw ? info.namespaces.get(raw) : undefined;
    return Boolean(declaration && (declaration.worldEdge || knownWorldImport(declaration.specifier, propertyName ?? '')));
  }

  worldMemberCallee(expression: PropertyAccessExpression | ElementAccessExpression, checker: TypeChecker, sourceFile: SourceFile): boolean {
    let property: string | null = null;
    if (this.ts.isPropertyAccessExpression(expression)) property = expression.name.text;
    else if (this.ts.isStringLiteralLike(expression.argumentExpression)) property = expression.argumentExpression.text;
    const namespace = checker.getSymbolAtLocation(expression.expression);
    if (this.intrinsicUiHookSymbol(selectedSymbol(this.ts, checker, expression), checker)) return false;
    if (this.namespaceIsWorld(namespace, sourceFile, property)) return true;
    return this.symbolIsWorld(selectedSymbol(this.ts, checker, expression), sourceFile);
  }

  worldVariableInitializer(symbol: TsSymbol, checker: TypeChecker, nextSeen: Set<TsSymbol>): boolean {
    for (const declaration of symbol.getDeclarations?.() ?? []) {
      if (this.ts.isVariableDeclaration(declaration) && declaration.initializer
        && this.calleeIsWorld(declaration.initializer, checker, declaration.getSourceFile(), nextSeen)) return true;
    }
    return false;
  }

  calleeIsWorld(input: Node, checker: TypeChecker, sourceFile: SourceFile, seen: Set<TsSymbol> = new Set()): boolean {
    const expression: Node = unwrapExpression(this.ts, input);
    if (this.ts.isIdentifier(expression) && this.symbolIsWorld(checker.getSymbolAtLocation(expression), sourceFile)) return true;
    if (this.ts.isPropertyAccessExpression(expression) || this.ts.isElementAccessExpression(expression))
      if (this.worldMemberCallee(expression, checker, sourceFile)) return true;
    const symbol = normalizedSymbolValue(this.ts, checker, selectedSymbol(this.ts, checker, expression));
    if (!symbol || seen.has(symbol)) return false;
    const nextSeen = new Set(seen).add(symbol);
    if (this.worldVariableInitializer(symbol, checker, nextSeen)) return true;
    return this.expressionFunctions(expression, checker).some(fn => this.functionUsesWorld(fn, checker, nextSeen));
  }

  callIsWorld(call: CallExpression, checker: TypeChecker, sourceFile: SourceFile, seen?: Set<TsSymbol>): boolean { return this.calleeIsWorld(call.expression, checker, sourceFile, seen); }

  functionUsesWorld(fn: WorldFunction, checker: TypeChecker, seen: Set<TsSymbol> = new Set()): boolean {
    const cached = this.functionWorldCache.get(fn);
    if (cached !== undefined) return cached;
    this.functionWorldCache.set(fn, false);
    let found = false;
    const sourceFile = fn.getSourceFile();
    const visit = (node: Node): void => {
      if (found) return;
      if (this.ts.isCallExpression(node) && this.callIsWorld(node, checker, sourceFile, seen)) { found = true; return; }
      this.ts.forEachChild(node, visit);
    };
    visit(fn.body ?? fn);
    this.functionWorldCache.set(fn, found);
    return found;
  }

  collectFunctionNodes(node: Node, functions: WorldFunction[]): void {
    if (this.ts.isFunctionDeclaration(node) || this.ts.isMethodDeclaration(node) || this.ts.isArrowFunction(node) || this.ts.isFunctionExpression(node)) functions.push(node);
    this.ts.forEachChild(node, child => this.collectFunctionNodes(child, functions));
  }

  inspectBlockProductHooks(sourceFile: SourceFile, checker: TypeChecker, tier: ComponentTier | null, functions: WorldFunction[]): void {
    for (const fn of functions) {
      const name = this.declarationName(this.ts, fn);
      if (tier?.tier === 'blocks' && name && /^use[A-Z0-9]/.test(name.text) && this.functionUsesWorld(fn, checker)) {
        this.violations.push(this.violation(this.config, sourceFile, name, 'FE_BLOCK_PRODUCT_HOOK_DEFINITION',
          'A block may call a product hook from hooks but cannot define product-world or data lifecycle under the block.', { ts: this.ts }));
      }
    }
  }

  inspectWorldOwner(sourceFile: SourceFile, checker: TypeChecker, tier: ComponentTier | null, fn: WorldFunction): void {
    if (!this.renderer.functionHasRender(fn, checker) || !this.functionUsesWorld(fn, checker)) return;
    const returned = returnedExpressions(this.ts, fn);
    if (!returned.length || returned.some(expression => !this.renderer.renderBoundary(expression, checker, new Set(), true))) {
      this.violations.push(this.violation(this.config, sourceFile, fn, 'FE_WORLD_OWNER_RENDER_BOUNDARY',
        'A visual owner that reads product/world state must hand every render path to a statically resolved pure render function or component; intrinsic-only interaction does not select this rule.', { ts: this.ts }));
    }
    if (tier && LOWER_COMPONENT_TIERS.has(tier.tier)) {
      this.violations.push(this.violation(this.config, sourceFile, fn, 'FE_COMPONENT_WORLD_OWNERSHIP',
        `${tier.tier} may own intrinsic browser interaction but cannot own product-world, navigation, locale, session or data lifecycle.`, { ts: this.ts }));
    }
    if (tier?.tier === 'blocks') this.inspectConnectedBlock(sourceFile, checker, fn, returned);
  }

  inspectConnectedBlock(sourceFile: SourceFile, checker: TypeChecker, fn: WorldFunction, returned: Expression[]): void {
    const expected = path.resolve(path.dirname(sourceFile.fileName), 'component.tsx');
    const index = path.basename(sourceFile.fileName).toLowerCase() === 'index.tsx';
    if (!index || !this.sourceSet.has(expected) || !returned.length
      || returned.some(expression => !this.renderer.renderBoundary(expression, checker, new Set(), true, expected))) {
      this.violations.push(this.violation(this.config, sourceFile, fn, 'FE_CONNECTED_BLOCK_RENDER_PAIR',
        'A connected blocks/index.tsx must hand every nonempty render path to a resolved pure export from its sibling component.tsx; pure blocks and lower tiers need no twin.', { ts: this.ts }));
    }
  }

  inspectWorldOwners(sourceFile: SourceFile, checker: TypeChecker, tier: ComponentTier | null, functions: WorldFunction[]): void {
    for (const fn of functions) this.inspectWorldOwner(sourceFile, checker, tier, fn);
  }

  inspectSourceFile(sourceFile: SourceFile): void {
    if ((!this.insideAny(this.roots.components, sourceFile.fileName) && !this.insideAny(this.roots.features, sourceFile.fileName))
      || !/\.[cm]?tsx$/i.test(sourceFile.fileName)) return;
    const checker = this.checkerFor(sourceFile.fileName);
    const tier = this.tierOf(this.roots.components, sourceFile.fileName);
    const functions: WorldFunction[] = [];
    this.collectFunctionNodes(sourceFile, functions);
    this.inspectBlockProductHooks(sourceFile, checker, tier, functions);
    this.inspectWorldOwners(sourceFile, checker, tier, functions);
  }

  check(): Violation[] {
    for (const sourceFile of this.context.files) this.inspectSourceFile(sourceFile);
    return this.violations;
  }
}

export type { WorldAnalysis };

export function checkWorldRenderBoundaries(config: ArchitectureConfig, context: WorldContext, roots: WorldRoots, helpers: WorldHelpers): Violation[] {
  return new WorldAnalysis(config, context, roots, helpers).check();
}
