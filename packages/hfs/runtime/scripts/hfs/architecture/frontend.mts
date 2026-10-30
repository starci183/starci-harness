import path from 'node:path';
import type { ImportClause, Identifier, NamedImportBindings, NamedImports, Node, SourceFile, Statement, Symbol as TsSymbol, TypeChecker } from 'typescript';
import { isInside } from './config.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation } from './hfs-graph.mjs';
import type { ImportEdge, WorkspaceRecord } from './typescript.mjs';
import type { TypeContext } from './type-context.mjs';
import { frameworkPinnedRootFiles } from './framework-pinned.mjs';
import { reachableViolation, relativePath } from './typescript.mjs';
import { normalizedSymbolValue } from './ast-walks.mjs';
import { sourceLocation } from '../../lib/ts-ast.mjs';
import { checkWorldRenderBoundaries } from './frontend-world.mjs';
import type { ComponentTier, WorldRoots } from './frontend-world.mjs';
import { checkGrammar } from './frontend-grammar.mjs';
import { checkRoute } from './frontend-routing.mjs';
const FEATURE_TIERS = new Set(['pages', 'layouts', 'overlays']);
const COMPONENT_TIERS = new Set(['blocks', 'composites', 'branches', 'leaves', 'providers']);

/** The part of the TypeScript context the frontend checker reads. */
export interface FrontendContext {
  ts: TypeScriptApi;
  files: SourceFile[];
  edges: Map<string, ImportEdge[]>;
  checkerFor: (fileName: string) => TypeChecker;
  workspaceOf: (fileName: string) => WorkspaceRecord | null;
}

/** The absolute roots of the frontend layout, plus the source roots and the framework-pinned root file names. */
export interface FrontendRoots extends WorldRoots {
  sourceRoots: string[];
  pinnedRootFiles: Set<string>;
}

/** One finding of the frontend checks: rule, root-relative path, position and message, plus the rule's extras. */
export interface FrontendViolation {
  ruleId: string;
  path: string;
  line: number;
  column: number;
  message: string;
  [extra: string]: unknown;
}

/** The state the custom-hook scan shares. */
interface HookState {
  ts: TypeScriptApi;
  config: ArchitectureConfig;
  sourceFile: SourceFile;
  checker: TypeChecker;
  violations: FrontendViolation[];
  seen: Set<TsSymbol>;
}

/** The state the pure-component scan shares. */
interface PureState {
  ts: TypeScriptApi;
  worldHooks: Set<string>;
  reactNamespaces: Set<string>;
  violations: FrontendViolation[];
}

type ViolationFactory = typeof violation;

function absolute(root: string, relative: string): string {
  return path.resolve(root, ...relative.split('/'));
}

function absoluteRoots(root: string, relatives: string[]): string[] {
  return relatives.map(relative => absolute(root, relative)).sort((a, b) => b.length - a.length);
}

function rootFor(candidates: readonly string[], fileName: string): string | null {
  return candidates.find(root => isInside(root, fileName)) ?? null;
}

function insideAny(candidates: readonly string[], fileName: string): boolean {
  return Boolean(rootFor(candidates, fileName));
}

function tierOf(componentRoots: readonly string[], fileName: string): ComponentTier | null {
  const root = rootFor(componentRoots, fileName);
  if (!root) return null;
  const tier = relativePath(root, fileName).split('/')[0] as string;
  return COMPONENT_TIERS.has(tier) ? { tier, root } : null;
}

function violation(config: ArchitectureConfig, sourceFile: SourceFile, node: Node, ruleId: string, message: string, extra: Record<string, unknown> = {}): FrontendViolation {
  return {
    ruleId,
    path: relativePath(config.root, sourceFile.fileName),
    ...sourceLocation(sourceFile, node),
    message,
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'ts')),
  };
}

function roleEntry(relative: string): boolean {
  const parts = String(relative).replaceAll('\\', '/').split('/');
  return parts.length === 1 && /^index\.[cm]?[jt]sx?$/i.test(parts[0] as string);
}

function roleFor(roots: FrontendRoots, fileName: string): { role: string; root: string; relative: string } | null {
  for (const [role, candidates] of Object.entries(roots) as [string, string[]][]) { // the role names filtered next are the string[] members
    if (!['routes', 'features', 'components', 'hooks', 'modules'].includes(role)) continue;
    const root = rootFor(candidates, fileName);
    if (root) return { role, root, relative: relativePath(root, fileName) };
  }
  return null;
}

// The files Next.js loads only from the source root (the directory holding app/: src/ or the project
// root) are authored in knowledge/patterns/fe/folder.yaml FE-FOLDER-1 and read by ./framework-pinned.mjs.
export { FRAMEWORK_PINNED_KNOWLEDGE, frameworkPinnedRootFiles } from './framework-pinned.mjs';

/** The source root that directly holds this file when it is a framework-pinned root file, else null. */
function frameworkPinnedRoot(roots: FrontendRoots, fileName: string): string | null {
  if (!roots.pinnedRootFiles.has(path.basename(fileName))) return null;
  const directory = path.resolve(path.dirname(fileName));
  return roots.sourceRoots.find(root => path.resolve(root) === directory) ?? null;
}

function checkFrontendSourceLayout(config: ArchitectureConfig, sourceFile: SourceFile, roots: FrontendRoots): FrontendViolation[] {
  const located = roleFor(roots, sourceFile.fileName);
  if (!located && frameworkPinnedRoot(roots, sourceFile.fileName)) return [];
  if (!located) return insideAny(roots.sourceRoots, sourceFile.fileName)
    ? [{ ruleId: 'FE_SOURCE_LAYOUT_INVALID', path: relativePath(config.root, sourceFile.fileName), line: 1, column: 1,
      message: 'Production source under a Next application root must belong to app, features, components, hooks or modules, or be a framework-pinned root file Next.js loads from the source root (knowledge/patterns/fe/folder.yaml FE-FOLDER-1 frameworkPinnedRootFiles); configuration cannot hide an unclassified owner.' }]
    : [];
  if (located.role === 'routes' || located.role === 'modules') return [];
  const first = located.relative.split('/')[0] as string;
  let valid = true;
  if (located.role === 'features') valid = FEATURE_TIERS.has(first) || roleEntry(located.relative);
  if (located.role === 'components') valid = COMPONENT_TIERS.has(first) || roleEntry(located.relative);
  if (located.role === 'hooks') valid = located.relative.includes('/') || roleEntry(located.relative);
  return valid ? [] : [{ ruleId: 'FE_SOURCE_LAYOUT_INVALID', path: relativePath(config.root, sourceFile.fileName), line: 1, column: 1,
    message: ({ features: 'Frontend features contain only pages, layouts and overlays plus an optional root public entry.',
      components: 'Frontend components contain only blocks, composites, branches, leaves and providers plus an optional root public entry.',
      hooks: 'Every authored custom hook is grouped below a domain folder under hooks; only the root public entry may sit directly under hooks.' } as Record<string, string>)[located.role] as string }];
}

function declarationName(ts: TypeScriptApi, declaration: Node): Identifier | null {
  if ((ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isVariableDeclaration(declaration))
    && declaration.name && ts.isIdentifier(declaration.name)) return declaration.name;
  if ((ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration))
    && ts.isVariableDeclaration(declaration.parent) && ts.isIdentifier(declaration.parent.name)) return declaration.parent.name;
  return null;
}

const HOOK_NAME = /^use[A-Z0-9]/;

function reportCustomHook(state: HookState, symbol: TsSymbol | null | undefined, node: Node): void {
  const { ts, checker, seen, violations, config, sourceFile } = state;
  const identity = normalizedSymbolValue(ts, checker, symbol) ?? symbol;
  if (!identity || seen.has(identity) || checker.getTypeOfSymbolAtLocation(identity, node).getCallSignatures().length === 0) return;
  seen.add(identity);
  violations.push(violation(config, sourceFile, node, 'FE_CUSTOM_HOOK_LOCATION',
    'Every authored custom useX hook declaration belongs under the configured hooks root; calling built-in React hooks inside a visual is still valid.', { ts }));
}

function inspectHookDeclaration(state: HookState, declaration: Node): void {
  const name = declarationName(state.ts, declaration);
  if (!name || !HOOK_NAME.test(name.text)) return;
  const symbol = state.checker.getSymbolAtLocation(name);
  reportCustomHook(state, symbol, name);
}

function visitHookDeclarations(state: HookState, node: Node): void {
  const { ts } = state;
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) inspectHookDeclaration(state, node);
  ts.forEachChild(node, child => visitHookDeclarations(state, child));
}

function reportExportedHooks(state: HookState): void {
  const { ts, checker, sourceFile } = state;
  const module = checker.getSymbolAtLocation(sourceFile);
  for (const exposed of module ? checker.getExportsOfModule(module) : []) {
    if (!HOOK_NAME.test(exposed.name)) continue;
    const identity = normalizedSymbolValue(ts, checker, exposed);
    for (const declaration of identity?.getDeclarations?.() ?? []) {
      if (declaration.getSourceFile() !== sourceFile) continue;
      reportCustomHook(state, identity, declarationName(ts, declaration) ?? declaration);
    }
  }
}

/** True when the slot that owns this file names it as its `hooks` role (redux/hooks.ts, modules/toast/hooks.ts): the owner's own typed hooks. */
function slotHooksRole(config: ArchitectureConfig, fileName: string): boolean {
  const found = config.hfs?.classifyPath?.(relativePath(config.root, fileName));
  const role = found?.slot ? config.hfs.slot(found.slot)?.roles?.hooks : undefined;
  return typeof role === 'string' && path.basename(fileName) === role;
}

function checkCustomHookLocations(config: ArchitectureConfig, context: FrontendContext, sourceFile: SourceFile, roots: FrontendRoots): FrontendViolation[] {
  if (insideAny(roots.hooks, sourceFile.fileName) || slotHooksRole(config, sourceFile.fileName)) return [];
  const { ts } = context;
  const state: HookState = { ts, config, sourceFile, checker: context.checkerFor(sourceFile.fileName), violations: [], seen: new Set() };
  visitHookDeclarations(state, sourceFile);
  reportExportedHooks(state);
  return state.violations;
}

function importsForSource<Edge>(context: { edges: Map<string, Edge[]> }, fileName: string): Edge[] {
  return context.edges.get(path.resolve(fileName)) ?? [];
}

function inspectComponentEdge(config: ArchitectureConfig, context: FrontendContext, roots: FrontendRoots, fileName: string, pure: boolean, edge: ImportEdge, violations: FrontendViolation[]): void {
  if (!edge.runtime) return;
  const configuredHookBarrel = insideAny(roots.hooks, edge.to) && /^index\.[cm]?[jt]sx?$/i.test(path.basename(edge.to));
  const hookChain = configuredHookBarrel ? null
    : reachableViolation(context.edges, edge, target => insideAny(roots.hooks, target), { follow: candidate => candidate.reexport && candidate.runtime });
  if (hookChain) {
    violations.push({ ruleId: 'FE_COMPONENT_DEEP_HOOK_IMPORT', path: relativePath(config.root, fileName), line: edge.line, column: edge.column,
      specifier: edge.specifier, resolvedPath: relativePath(config.root, hookChain.at(-1) as string), dependencyChain: hookChain.map(item => relativePath(config.root, item)),
      message: 'Components must enter data hooks through the owning hooks barrel.' });
  }
  if (pure) inspectPureDataReachability(config, context, roots, fileName, edge, violations);
}

function inspectPureDataReachability(config: ArchitectureConfig, context: FrontendContext, roots: FrontendRoots, fileName: string, edge: ImportEdge, violations: FrontendViolation[]): void {
  const chain = reachableViolation(context.edges, edge, target => insideAny(roots.hooks, target) || insideAny(roots.transport, target),
    { follow: candidate => candidate.reexport && candidate.runtime });
  if (chain) violations.push({ ruleId: 'FE_PURE_REACHES_DATA', path: relativePath(config.root, fileName), line: edge.line, column: edge.column,
    specifier: edge.specifier, resolvedPath: relativePath(config.root, chain.at(-1) as string), dependencyChain: chain.map(item => relativePath(config.root, item)),
    message: 'Pure component.tsx cannot reach hooks or API transport through an alias, relative import, package, or barrel.' });
}

function reportWorldHookImports(config: ArchitectureConfig, sourceFile: SourceFile, named: NamedImports, state: PureState, violation: ViolationFactory): void {
  const { ts, worldHooks, violations } = state;
  for (const element of named.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    if (!element.isTypeOnly && worldHooks.has(imported)) violations.push(violation(config, sourceFile, element, 'FE_PURE_WORLD_HOOK', `Pure component.tsx imports ${imported}; its connected index.tsx owns application/world state.`, { ts }));
  }
}

function recordReactNamespaces(ts: TypeScriptApi, clause: ImportClause | undefined, named: NamedImportBindings | undefined, reactNamespaces: Set<string>): void {
  if (clause?.name) reactNamespaces.add(clause.name.text);
  if (named && ts.isNamespaceImport(named)) reactNamespaces.add(named.name.text);
}

function inspectPureImport(config: ArchitectureConfig, sourceFile: SourceFile, statement: Statement, state: PureState, violation: ViolationFactory): void {
  const { ts, reactNamespaces, violations } = state;
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) return;
  const source = statement.moduleSpecifier.text;
  const named = statement.importClause?.namedBindings;
  if (source === 'react') {
    if (named && ts.isNamedImports(named)) reportWorldHookImports(config, sourceFile, named, state, violation);
    recordReactNamespaces(ts, statement.importClause, named, reactNamespaces);
  }
  if ((source === 'next/navigation' || source === 'next-intl') && statement.importClause) {
    violations.push(violation(config, sourceFile, statement, 'FE_PURE_WORLD_IMPORT', `Pure component.tsx imports ${source}; its connected index.tsx owns router and locale context.`, { ts }));
  }
}

function inspectPureWorldHookAccess(config: ArchitectureConfig, sourceFile: SourceFile, node: Node, state: PureState, violation: ViolationFactory): void {
  const { ts, worldHooks, reactNamespaces, violations } = state;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && reactNamespaces.has(node.expression.text)
    && worldHooks.has(node.name.text)) {
    violations.push(violation(config, sourceFile, node, 'FE_PURE_WORLD_HOOK', `Pure component.tsx accesses ${node.expression.text}.${node.name.text}; its connected index.tsx owns application/world state.`, { ts }));
  }
  ts.forEachChild(node, child => inspectPureWorldHookAccess(config, sourceFile, child, state, violation));
}

function inspectPureModule(config: ArchitectureConfig, context: FrontendContext, sourceFile: SourceFile, violations: FrontendViolation[], violation: ViolationFactory): void {
  const ts = context.ts;
  const state: PureState = { ts, worldHooks: new Set(['createContext', 'useContext', 'useSyncExternalStore']), reactNamespaces: new Set(), violations };
  for (const statement of sourceFile.statements) inspectPureImport(config, sourceFile, statement, state, violation);
  inspectPureWorldHookAccess(config, sourceFile, sourceFile, state, violation);
}

function checkPureAndData(config: ArchitectureConfig, context: FrontendContext, sourceFile: SourceFile, roots: FrontendRoots): FrontendViolation[] {
  const violations: FrontendViolation[] = [];
  const fileName = path.resolve(sourceFile.fileName);
  if (!insideAny(roots.components, fileName)) return violations;
  const pure = path.basename(fileName).toLowerCase() === 'component.tsx';
  for (const edge of importsForSource(context, fileName)) inspectComponentEdge(config, context, roots, fileName, pure, edge, violations);
  if (pure) inspectPureModule(config, context, sourceFile, violations, violation);
  return violations;
}


/** Enforce route adapters, UI responsibility tiers, pure/connected, and transport boundaries. */
export function checkFrontend(config: ArchitectureConfig, context: TypeContext): ArchitectureViolation[] {
  const worldRoots: WorldRoots = {
    routes: absoluteRoots(config.root, config.frontend.routes),
    features: absoluteRoots(config.root, config.frontend.features),
    components: absoluteRoots(config.root, config.frontend.components),
    hooks: absoluteRoots(config.root, config.frontend.hooks),
    modules: absoluteRoots(config.root, config.frontend.modules),
    transport: absoluteRoots(config.root, config.frontend.transport),
  };
  const roots: FrontendRoots = { ...worldRoots, sourceRoots: [...new Set(worldRoots.routes.map(root => path.dirname(root)))], pinnedRootFiles: frameworkPinnedRootFiles() };
  const violations: ArchitectureViolation[] = checkGrammar(config, context, violation);
  for (const sourceFile of context.files) {
    if (insideAny(roots.routes, sourceFile.fileName) && path.basename(sourceFile.fileName).toLowerCase() === 'page.tsx') {
      violations.push(...checkRoute(config, context, sourceFile, roots, { violation, insideAny, importsForSource }));
    }
    violations.push(...checkFrontendSourceLayout(config, sourceFile, roots), ...checkCustomHookLocations(config, context, sourceFile, roots), ...checkPureAndData(config, context, sourceFile, roots));
  }
  violations.push(...checkWorldRenderBoundaries(config, context, roots, { insideAny, rootFor, tierOf, violation, declarationName, importsForSource }));
  return violations;
}
