import path from 'node:path';
import type {
  ArrayBindingElement, ArrowFunction, BindingElement, BindingName, CallExpression, ExportDeclaration, FunctionDeclaration, FunctionExpression, ImportDeclaration,
  MethodDeclaration, Node, SourceFile, Statement, StringLiteralLike, Symbol as TsSymbol, TypeChecker,
} from 'typescript';
import { canonical, isInside } from './config.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation } from './hfs-graph.mjs';
import type { KeyEntry, NextDataKeyDeps } from './next-data-key.mjs';
import { parseContract, installedSWR } from './next-data-contract.mjs';
import { relativePath, unwrapExpression } from './typescript.mjs';
import { anyDescendant, normalizedSymbol, normalizedSymbolValue, valueSymbol as sharedValueSymbol } from './ast-walks.mjs';
import { sourceLocation } from '../../lib/ts-ast.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { createNextDataKeyInspector } from './next-data-key.mjs';
import { functionNode, constInitializer, inferredSymbol } from './next-data-symbols.mjs';
import { inferredFetcher, inferredIdentities, inferredKeyBindings } from './next-data-inference.mjs';
export const SWR_KEY_RULE_ID = 'FE_SWR_KEY_IDENTITY';
export const SWR_MUTATION_RULE_ID = 'FE_SWR_MUTATION_RESOURCE_IDENTITY';
export const SWR_DATA_RULE_IDS = [SWR_KEY_RULE_ID, SWR_MUTATION_RULE_ID];

/** The part of the TypeScript context the data-lifecycle check reads. */
export interface DataContext {
  ts: TypeScriptApi;
  files: SourceFile[];
  checkerFor: (fileName: string) => TypeChecker;
}

/** What the data-lifecycle check returns. */
export interface DataLifecycleResult {
  violations: ArchitectureViolation[];
  coverage: { status: string; [detail: string]: unknown };
}

/** One declared request identity of a lifecycle entry. */
interface DeclaredIdentity {
  id: string;
  binding: string;
  resource: boolean;
  gatesRequest: boolean;
}

/** A lifecycle entry of the declared contract (package.json starci.codePatterns.next.dataLifecycle). */
export interface LifecycleEntry extends KeyEntry {
  resultBinding?: string;
  identities: DeclaredIdentity[];
}

/** The parsed dataLifecycle contract. */
interface DataContract {
  swr: { major: number };
  hooks: LifecycleEntry[];
}

/** The installed swr package. */
interface InstalledSwr {
  name: string;
  version: string;
  major: number;
  root: string;
}

type HookNode = FunctionDeclaration | ArrowFunction | FunctionExpression;
type OwnerFunction = HookNode | MethodDeclaration;
type ModuleStatement = (ImportDeclaration | ExportDeclaration) & { moduleSpecifier: StringLiteralLike };

/** One SWR call found in the program. */
interface DiscoveredCall {
  kind: string;
  node: CallExpression;
  source: SourceFile;
  checker: TypeChecker;
  owner: OwnerFunction | null;
  bindings: string[];
}

/** An exported hook resolved to its local implementation. */
interface ResolvedHook {
  source: SourceFile;
  checker: TypeChecker;
  fn: HookNode;
}

/** What the official-target scan shares. */
interface OfficialScope {
  config: ArchitectureConfig;
  context: DataContext;
  installed: InstalledSwr;
  reasons: string[];
}

/** What the lifecycle inspection shares. */
interface LifecycleScope {
  config: ArchitectureConfig;
  context: DataContext;
  violations: ArchitectureViolation[];
  reasons: string[];
}

const SWR_SPECIFIERS = new Set(['swr', 'swr/immutable', 'swr/mutation']);

/* null when the expression selects no name at all (the shared default traces the unselected node itself). */
const valueSymbol = (ts: TypeScriptApi, checker: TypeChecker, expression: Node, seen: Set<TsSymbol> = new Set()): TsSymbol | null | undefined =>
  sharedValueSymbol(ts, checker, expression, seen, { unselected: 'null' });

function declarationsInside(symbol: TsSymbol | null | undefined, root: string): boolean {
  const declarations = symbol?.getDeclarations?.() ?? [];
  return declarations.length > 0 && declarations.every(declaration => isInside(root, canonical(declaration.getSourceFile().fileName)));
}

function selectedImportBindings(ts: TypeScriptApi, statement: Statement, selected: Map<string, string>): number {
  if (!ts.isImportDeclaration(statement) || !statement.importClause) return 0;
  const clause = statement.importClause;
  let count = clause.name && selected.has('default') ? 1 : 0;
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) count += 1;
  if (bindings && ts.isNamedImports(bindings)) count += bindings.elements
    .filter(element => selected.has(element.propertyName?.text ?? element.name.text)).length;
  return count;
}

function addOfficialExports(official: OfficialScope, checker: TypeChecker, statement: ModuleStatement, selected: Map<string, string>, targets: Map<TsSymbol, string>): boolean {
  const { config, context, installed, reasons } = official;
  const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
  if (!moduleSymbol) {
    reasons.push(`${relativePath(config.root, statement.getSourceFile().fileName)} cannot resolve ${statement.moduleSpecifier.text} through the target TypeScript program`);
    return false;
  }
  const exports = new Map(checker.getExportsOfModule(moduleSymbol).map((symbol): [string, TsSymbol | null | undefined] => [symbol.getName(), normalizedSymbolValue(context.ts, checker, symbol)]));
  for (const [name, kind] of selected) {
    const target = exports.get(name);
    if (!target) continue;
    if (!declarationsInside(target, installed.root)) {
      reasons.push(`${relativePath(config.root, statement.getSourceFile().fileName)} resolves ${statement.moduleSpecifier.text}#${name} outside installed swr ${installed.version}`);
      continue;
    }
    targets.set(target, kind);
  }
  return true;
}

function addOfficialStatement(official: OfficialScope, wanted: Map<string, Map<string, string>>, checker: TypeChecker, statement: Statement, targets: Map<TsSymbol, string>): number {
  const ts = official.context.ts;
  if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return 0;
  if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) return 0;
  const selected = wanted.get(statement.moduleSpecifier.text);
  if (!selected) return 0;
  if (!addOfficialExports(official, checker, statement as ModuleStatement, selected, targets)) return 0;
  return selectedImportBindings(ts, statement, selected);
}

function officialTargets(config: ArchitectureConfig, context: DataContext, installed: InstalledSwr, reasons: string[]): { targets: Map<TsSymbol, string>; selectedBindings: number } {
  const wanted = new Map([
    ['swr', new Map([['default', 'query'], ['mutate', 'global-mutate'], ['useSWRConfig', 'config']])],
    ['swr/immutable', new Map([['default', 'query']])],
    ['swr/mutation', new Map([['default', 'mutation'], ['useSWRMutation', 'mutation']])],
  ]);
  const targets = new Map<TsSymbol, string>();
  const official: OfficialScope = { config, context, installed, reasons };
  let selectedBindings = 0;
  for (const source of context.files) {
    const checker = context.checkerFor(source.fileName);
    for (const statement of source.statements) selectedBindings += addOfficialStatement(official, wanted, checker, statement, targets);
  }
  return { targets, selectedBindings };
}

function callKind(ts: TypeScriptApi, checker: TypeChecker, call: CallExpression, targets: Map<TsSymbol, string>, configMutates: Set<TsSymbol | null | undefined> = new Set()): string | null {
  const symbol = valueSymbol(ts, checker, call.expression);
  return configMutates.has(symbol) ? 'global-mutate' : (symbol ? targets.get(symbol) : undefined) ?? null;
}

function bindingNames(ts: TypeScriptApi, name: BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) return (name.elements as readonly ArrayBindingElement[]).flatMap(element => {
    if (!element || ts.isOmittedExpression(element)) return [];
    return bindingNames(ts, element.name);
  });
  return [];
}

function resultBindings(ts: TypeScriptApi, call: CallExpression): string[] {
  let current: Node = call;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent)
    || ts.isTypeAssertionExpression(current.parent) || ts.isNonNullExpression(current.parent)
    || (ts.isSatisfiesExpression?.(current.parent) ?? false)
    || ((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent)) && current.parent.expression === current))) {
    current = current.parent;
  }
  return current.parent && ts.isVariableDeclaration(current.parent) && current.parent.initializer === current
    ? bindingNames(ts, current.parent.name) : [];
}

function nearestFunction(ts: TypeScriptApi, node: Node): OwnerFunction | null {
  for (let current: Node | undefined = node.parent; current; current = current.parent) if (ts.isFunctionDeclaration(current)
    || ts.isFunctionExpression(current) || ts.isArrowFunction(current) || ts.isMethodDeclaration(current)) return current;
  return null;
}

function configElementProperty(ts: TypeScriptApi, element: BindingElement): string | null {
  return element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text
    : (ts.isIdentifier(element.name) && element.name.text) || null;
}

function addConfigMutateSymbols(ts: TypeScriptApi, checker: TypeChecker, node: Node, targets: Map<TsSymbol, string>, symbols: Set<TsSymbol | null | undefined>): void {
  if (!(ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer
    && ts.isCallExpression(unwrapExpression(ts, node.initializer))
    && callKind(ts, checker, unwrapExpression(ts, node.initializer), targets) === 'config')) return;
  for (const element of node.name.elements) {
    if (configElementProperty(ts, element) === 'mutate' && ts.isIdentifier(element.name)) symbols.add(normalizedSymbol(ts, checker, element.name));
  }
}

function configMutateSymbols(_config: ArchitectureConfig, context: DataContext, targets: Map<TsSymbol, string>): Set<TsSymbol | null | undefined> {
  const { ts } = context;
  const symbols = new Set<TsSymbol | null | undefined>();
  for (const source of context.files) {
    const checker = context.checkerFor(source.fileName);
    const visit = (node: Node): void => {
      addConfigMutateSymbols(ts, checker, node, targets, symbols);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return symbols;
}

function discoverCalls(config: ArchitectureConfig, context: DataContext, targets: Map<TsSymbol, string>): DiscoveredCall[] {
  const configMutates = configMutateSymbols(config, context, targets);
  const calls: DiscoveredCall[] = [];
  for (const source of context.files) {
    const checker = context.checkerFor(source.fileName);
    const visit = (node: Node): void => {
      if (context.ts.isCallExpression(node)) {
        const kind = callKind(context.ts, checker, node, targets, configMutates);
        if (kind && kind !== 'config') calls.push({ kind, node, source, checker, owner: nearestFunction(context.ts, node), bindings: resultBindings(context.ts, node) });
      }
      context.ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

function exportedHook(config: ArchitectureConfig, context: DataContext, entry: LifecycleEntry, reasons: string[]): ResolvedHook | null {
  const source = context.files.find(candidate => canonical(candidate.fileName) === canonical(path.join(config.root, ...entry.path.split('/'))));
  if (!source) {
    reasons.push(`${entry.path} is outside the canonical production TypeScript program`);
    return null;
  }
  const checker = context.checkerFor(source.fileName);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol).find(symbol => symbol.getName() === entry.export) : null;
  const symbol = normalizedSymbolValue(context.ts, checker, exported);
  const declarations = (symbol?.getDeclarations?.() ?? []).filter(declaration => canonical(declaration.getSourceFile().fileName) === canonical(source.fileName));
  const functions = declarations.map(declaration => functionNode(context.ts, declaration)).filter((fn): fn is HookNode => fn !== null);
  if (functions.length !== 1) {
    reasons.push(`${entry.path}#${entry.export} does not resolve to one local exported hook implementation`);
    return null;
  }
  return { source, checker, fn: functions[0] as HookNode };
}

function addBindingName(ts: TypeScriptApi, checker: TypeChecker, found: Map<string, Set<TsSymbol>>, name: BindingName): void {
  if (ts.isIdentifier(name)) {
    const symbol = normalizedSymbol(ts, checker, name);
    if (!symbol) return;
    if (!found.has(name.text)) found.set(name.text, new Set());
    found.get(name.text)?.add(symbol);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const element of name.elements as readonly ArrayBindingElement[]) {
    if (element && !ts.isOmittedExpression(element)) addBindingName(ts, checker, found, element.name);
  }
}

function bindingSymbols(ts: TypeScriptApi, checker: TypeChecker, fn: HookNode): Map<string, Set<TsSymbol>> {
  const found = new Map<string, Set<TsSymbol>>();
  for (const parameter of fn.parameters) addBindingName(ts, checker, found, parameter.name);
  const visit = (node: Node): void => {
    if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node))) return;
    if (ts.isVariableDeclaration(node)) addBindingName(ts, checker, found, node.name);
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

function resolvedIdentities(ts: TypeScriptApi, checker: TypeChecker, fn: HookNode, entry: LifecycleEntry, reasons: string[]) {
  const symbols = bindingSymbols(ts, checker, fn);
  const identities: (DeclaredIdentity & { parts: string[]; symbol: TsSymbol | undefined })[] = [];
  for (const identity of entry.identities) {
    const parts = identity.binding.split('.');
    const candidates = symbols.get(parts[0] as string) ?? new Set<TsSymbol>();
    if (candidates.size !== 1) {
      reasons.push(`${entry.path}#${entry.export} cannot resolve one local binding for identity ${identity.id} (${identity.binding})`);
      continue;
    }
    identities.push({ ...identity, parts, symbol: [...candidates][0] });
  }
  return identities.length === entry.identities.length ? identities : null;
}

function violation(config: ArchitectureConfig, call: { source: SourceFile; node: Node }, ruleId: string, message: string, extra: Record<string, unknown> = {}): ArchitectureViolation {
  return { ruleId, path: relativePath(config.root, call.source.fileName), ...sourceLocation(call.source, call.node), message, ...extra };
}

const keyInspectorDependencies: NextDataKeyDeps = { anyDescendant, normalizedSymbol, unwrapExpression, constInitializer, sourceLocation, violation,
  SWR_KEY_RULE_ID, SWR_MUTATION_RULE_ID };
const inspectKey = createNextDataKeyInspector(keyInspectorDependencies);

const inspectInferredKey = createNextDataKeyInspector({ ...keyInspectorDependencies, normalizedSymbol: inferredSymbol });

function isUnshadowedCommonJsRequire(ts: TypeScriptApi, checker: TypeChecker, expression: Node, seen: Set<TsSymbol> = new Set(), depth = 0): boolean {
  expression = unwrapExpression(ts, expression);
  if (!ts.isIdentifier(expression) || depth > 10) return false;
  const symbol = checker.getSymbolAtLocation(expression);
  const declarations = symbol?.getDeclarations?.() ?? [];
  if (expression.text === 'require' && (!symbol
    || declarations.every(declaration => declaration.getSourceFile().isDeclarationFile))) return true;
  const normalized = symbolOfRequireAlias(ts, checker, expression);
  if (!normalized || seen.has(normalized)) return false;
  const initializer = constInitializer(ts, normalized);
  return initializer ? isUnshadowedCommonJsRequire(ts, checker, initializer, new Set(seen).add(normalized), depth + 1) : false;
}

function symbolOfRequireAlias(ts: TypeScriptApi, checker: TypeChecker, expression: Node): TsSymbol | null | undefined {
  const symbol = checker.getSymbolAtLocation(expression);
  return normalizedSymbolValue(ts, checker, symbol);
}

function isSwrModuleDeclaration(ts: TypeScriptApi, node: Node) {
  return (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
    && ts.isStringLiteralLike(node.moduleSpecifier) && SWR_SPECIFIERS.has(node.moduleSpecifier.text);
}

/** The kind of unsupported SWR binding the node declares, else null. */
function unsupportedSwrBinding(ts: TypeScriptApi, checker: TypeChecker, node: Node): string | null {
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)
    && SWR_SPECIFIERS.has(node.moduleReference.expression.text)) return 'import-equals binding';
  if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0] as Node)
    && SWR_SPECIFIERS.has((node.arguments[0] as StringLiteralLike).text)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic import binding';
    if (isUnshadowedCommonJsRequire(ts, checker, node.expression)) return 'CommonJS require binding';
  }
  return null;
}

function swrReferences(config: ArchitectureConfig, context: DataContext): { found: boolean; unsupported: string[] } {
  const { ts } = context;
  let found = false;
  const unsupported: string[] = [];
  for (const source of context.files) {
    const checker = context.checkerFor(source.fileName);
    const visit = (node: Node): void => {
      if (isSwrModuleDeclaration(ts, node)) found = true;
      const kind = unsupportedSwrBinding(ts, checker, node);
      if (kind) {
        found = true;
        unsupported.push(`${relativePath(config.root, source.fileName)}:${sourceLocation(source, node).line} uses unsupported ${kind} for SWR`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { found, unsupported };
}

function unavailableDataLifecycle(ruleIds: string[], details: string[]): DataLifecycleResult {
  return { violations: [], coverage: { status: 'unavailable', ruleIds, details } };
}

function lifecycleCallSets(config: ArchitectureConfig, context: DataContext, installed: InstalledSwr, reasons: string[]): { lifecycleCalls: DiscoveredCall[] } {
  const official = officialTargets(config, context, installed, reasons);
  const calls = discoverCalls(config, context, official.targets);
  const lifecycleCalls = calls.filter(call => call.kind === 'query' || call.kind === 'mutation');
  const globalMutates = calls.filter(call => call.kind === 'global-mutate');
  if (official.selectedBindings && lifecycleCalls.length === 0) reasons.push('selected SWR hook imports have no statically resolved lifecycle call');
  for (const call of globalMutates) reasons.push(`${relativePath(config.root, call.source.fileName)}:${sourceLocation(call.source, call.node).line} uses global mutate; resource matching or filter semantics are not statically declared`);
  return { lifecycleCalls };
}

function hookEntries(config: ArchitectureConfig, context: DataContext, contract: DataContract, reasons: string[]): { hookCache: Map<string, ResolvedHook | null>; entriesByHook: Map<string, LifecycleEntry[]> } {
  const hookCache = new Map<string, ResolvedHook | null>();
  const entriesByHook = new Map<string, LifecycleEntry[]>();
  for (const entry of contract.hooks) {
    const key = `${entry.path}\0${entry.export}`;
    if (!entriesByHook.has(key)) entriesByHook.set(key, []);
    entriesByHook.get(key)?.push(entry);
    if (!hookCache.has(key)) hookCache.set(key, exportedHook(config, context, entry, reasons));
  }
  return { hookCache, entriesByHook };
}

function inspectLifecycleEntry(scope: LifecycleScope, entry: LifecycleEntry, hookCalls: { entries: LifecycleEntry[]; owned: DiscoveredCall[]; hook: ResolvedHook }, mapped: Map<DiscoveredCall, number>): void {
  const { config, context, violations, reasons } = scope;
  const { entries, owned, hook } = hookCalls;
  let candidates: DiscoveredCall[];
  if (entry.resultBinding !== undefined) candidates = owned.filter(call => call.bindings.includes(entry.resultBinding as string));
  else candidates = owned.length === 1 && entries.length === 1 ? owned : [];
  if (candidates.length !== 1) {
    reasons.push(`${entry.path}#${entry.export} lifecycle ${entry.id} must select exactly one SWR call${owned.length > 1 ? ' with resultBinding' : ''}`);
    return;
  }
  const call = candidates[0] as DiscoveredCall;
  mapped.set(call, (mapped.get(call) ?? 0) + 1);
  if (call.kind !== entry.kind) {
    reasons.push(`${entry.path}#${entry.export} lifecycle ${entry.id} declares ${entry.kind} but resolves ${call.kind}`);
    return;
  }
  const identities = resolvedIdentities(context.ts, hook.checker, hook.fn, entry, reasons);
  if (identities) inspectKey(config, context, entry, call, identities, violations, reasons);
}

function inspectHookLifecycle(config: ArchitectureConfig, context: DataContext, lifecycleCalls: DiscoveredCall[], hookCache: Map<string, ResolvedHook | null>, entriesByHook: Map<string, LifecycleEntry[]>, violations: ArchitectureViolation[], reasons: string[]): Map<DiscoveredCall, number> {
  const mapped = new Map<DiscoveredCall, number>();
  const scope: LifecycleScope = { config, context, violations, reasons };
  for (const [key, entries] of entriesByHook) {
    const hook = hookCache.get(key);
    if (!hook) continue;
    const owned = lifecycleCalls.filter(call => call.owner === hook.fn);
    if (!owned.length) {
      reasons.push(`${(entries[0] as LifecycleEntry).path}#${(entries[0] as LifecycleEntry).export} contains no statically resolved SWR lifecycle call`);
      continue;
    }
    for (const entry of entries) inspectLifecycleEntry(scope, entry, { entries, owned, hook }, mapped);
    for (const call of owned) if ((mapped.get(call) ?? 0) !== 1) {
      reasons.push(`${relativePath(config.root, call.source.fileName)}:${sourceLocation(call.source, call.node).line} SWR call is not matched by exactly one declared lifecycle`);
    }
  }
  return mapped;
}

function addUndeclaredLifecycleReasons(config: ArchitectureConfig, lifecycleCalls: DiscoveredCall[], hookCache: Map<string, ResolvedHook | null>, reasons: string[]): void {
  const declaredFunctions = new Set<Node | null>([...hookCache.values()].filter((item): item is ResolvedHook => item !== null).map(item => item.fn));
  for (const call of lifecycleCalls) if (!declaredFunctions.has(call.owner)) {
    reasons.push(`${relativePath(config.root, call.source.fileName)}:${sourceLocation(call.source, call.node).line} SWR call is outside every declared lifecycle hook`);
  }
}

function lifecycleCoverage(ruleIds: string[], contract: { hooks: unknown[] }, installed: InstalledSwr, calls: number, details: string[]): DataLifecycleResult['coverage'] {
  return details.length ? { status: 'unavailable', ruleIds, hooks: contract.hooks.length, calls,
    swr: { name: installed.name, version: installed.version, major: installed.major }, details }
    : { status: 'checked', ruleIds, hooks: contract.hooks.length, calls,
      swr: { name: installed.name, version: installed.version, major: installed.major } };
}

function inspectDefaultLifecycle(config: ArchitectureConfig, context: DataContext, installed: InstalledSwr, lifecycleCalls: DiscoveredCall[], violations: ArchitectureViolation[], reasons: string[]): DataLifecycleResult {
  for (const call of lifecycleCalls) {
    const fetcher = inferredFetcher(context.ts, call.checker, call.node.arguments[1]);
    if (!fetcher) {
      reasons.push(`${relativePath(config.root, call.source.fileName)}:${sourceLocation(call.source, call.node).line} fetcher inputs cannot be inferred; dataLifecycle is required to declare identities`);
      continue;
    }
    const entry = { id: `swr:${relativePath(config.root, call.source.fileName)}:${sourceLocation(call.source, call.node).line}`,
      path: relativePath(config.root, call.source.fileName), export: (call.owner?.name as { text?: string } | undefined)?.text ?? '<inferred hook>', kind: call.kind };
    const identities = inferredIdentities(context, call, fetcher, reasons);
    const selected = new Set(identities.map(identity => identity.id));
    const findings: ArchitectureViolation[] = [];
    inspectInferredKey(config, context, entry, call, [...identities, ...inferredKeyBindings(context, call, reasons)], findings, reasons);
    violations.push(...findings.filter(finding => finding.identity === undefined || selected.has(finding.identity as string)));
  }
  const details = [...new Set(reasons)].sort(byCodeUnit);
  return { violations, coverage: lifecycleCoverage([...SWR_DATA_RULE_IDS], { hooks: lifecycleCalls }, installed, lifecycleCalls.length, details) };
}

/** Check declared lifecycles, or infer captured request identities when production SWR has no declaration. */
export function checkFrontendDataLifecycle(config: ArchitectureConfig, context: DataContext): DataLifecycleResult {
  const ruleIds = [...SWR_DATA_RULE_IDS];
  const references = swrReferences(config, context);
  let contract: DataContract | null;
  try { contract = parseContract(config); } catch (error) {
    return unavailableDataLifecycle(ruleIds, [String((error as { message?: unknown }).message ?? error)]);
  }
  if (!contract && !references.found) return { violations: [], coverage: { status: 'not-applicable', ruleIds } };
  const reasons: string[] = [];
  const violations: ArchitectureViolation[] = [];
  reasons.push(...references.unsupported);
  if (!contract && references.unsupported.length) reasons.push('package.json#starci.codePatterns.next.dataLifecycle is required for unsupported SWR bindings');
  let installed: InstalledSwr;
  try { installed = installedSWR(config.packageRoot ?? config.root); } catch (error) {
    return { violations, coverage: { status: 'unavailable', ruleIds, details: [String((error as { message?: unknown }).message ?? error)] } };
  }
  if (contract && installed.major !== contract.swr.major) reasons.push(`installed swr ${installed.version} does not match declared major ${contract.swr.major}`);
  const { lifecycleCalls } = lifecycleCallSets(config, context, installed, reasons);
  if (!contract) return inspectDefaultLifecycle(config, context, installed, lifecycleCalls, violations, reasons);
  const { hookCache, entriesByHook } = hookEntries(config, context, contract, reasons);
  inspectHookLifecycle(config, context, lifecycleCalls, hookCache, entriesByHook, violations, reasons);
  addUndeclaredLifecycleReasons(config, lifecycleCalls, hookCache, reasons);
  const details = [...new Set(reasons)].sort(byCodeUnit);
  return { violations, coverage: lifecycleCoverage(ruleIds, contract, installed, lifecycleCalls.length, details) };
}
