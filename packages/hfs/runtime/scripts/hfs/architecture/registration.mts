import path from 'node:path';
import type { ClassDeclaration, Decorator, Expression, Node, ObjectLiteralElementLike, SourceFile, Statement, Symbol as TsSymbol, TypeChecker } from 'typescript';
import { canonical } from './config.mjs';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import { referencedExports, relativePath, unwrapExpression } from './typescript.mjs';
import type { TypeContext } from './type-context.mjs';
import { commonJsRequireReasons, decoratorCallee, moduleExportsOf, mutableDecoratorKind, nodeDecorators, programSourcesOf, selectedNode, valueSymbol } from './ast-walks.mjs';
import type { Violation } from './ast-walks.mjs';
import { sourceLocation } from '../../lib/ts-ast.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

const REGISTRATION_RULE_IDS = ['BE_MODULE_HANDLER_REGISTRATION', 'BE_MODULE_PROVIDER_REREGISTRATION'];
const FRAMEWORK = new Map([
  ['Module', '@nestjs/common'],
  ['CommandHandler', '@nestjs/cqrs'],
  ['QueryHandler', '@nestjs/cqrs'],
]);

/** The Nest framework symbols the program binds by decorator name, and why any binding could not be resolved. */
interface FrameworkTargets {
  targets: Map<string, TsSymbol>;
  reasons: string[];
}

/** The tokens a module's metadata field lists (class key -> the nodes that list it), and whether any entry could not be read. */
interface TokenEntries {
  tokens: Map<string, Node[]>;
  unknown: boolean;
}

/** One `@Module` class of the program. */
interface ModuleRecord {
  key: string | null;
  name: string;
  path: string;
  line: number;
  column: number;
  providers: Map<string, Node[]>;
  exports: Map<string, Node[]>;
  unknown: boolean;
}

/** One CQRS handler class of the program. */
interface HandlerRecord {
  key: string | null;
  name: string;
  kind: string;
  path: string;
  line: number;
  column: number;
}

/** A decorator of a class and the framework decorator it resolves to. */
interface DecoratorKind {
  decorator: Decorator;
  kind: string | null;
}

/** What the discovery walk collects. */
interface Found {
  modules: ModuleRecord[];
  handlers: HandlerRecord[];
  reasons: string[];
}

/** What the inspection of one source file reads. */
interface RegistrationSite {
  config: ArchitectureConfig;
  context: TypeContext;
  sourceFile: SourceFile;
  checker: TypeChecker;
  localFiles: Set<string>;
  framework: FrameworkTargets;
}

/** One registration of a provider token in a module's metadata. */
interface ProviderRegistration {
  module: ModuleRecord;
  node: Node;
}

/** What `checkModuleRegistration` returns. */
export interface ModuleRegistrationResult {
  violations: Violation[];
  coverage: { status: string; [detail: string]: unknown };
}

function frameworkDecorator(ts: TypeScriptApi, checker: TypeChecker, decorator: Decorator, targets: Map<string, TsSymbol>): string | null {
  const selected = selectedNode(ts, decoratorCallee(ts, decorator));
  if (!selected) return null;
  const symbol = valueSymbol(ts, checker, selected);
  for (const [name, target] of targets) if (symbol === target) return name;
  return null;
}

/* This module's framework map keys decorator names, not symbols - invert it (first name wins, as the old
 * `for...of` scan did) for the shared symbol-keyed lookup. */
const mutableFrameworkAlias = (ts: TypeScriptApi, checker: TypeChecker, decorator: Decorator, targets: Map<string, TsSymbol>): string | null => {
  const bySymbol = new Map<TsSymbol, string>();
  for (const [name, symbol] of targets) if (!bySymbol.has(symbol)) bySymbol.set(symbol, name);
  return mutableDecoratorKind(ts, checker, decorator, bySymbol);
};

function collectFrameworkStatement(config: ArchitectureConfig, context: TypeContext, checker: TypeChecker, sourceFile: SourceFile, statement: Statement, targets: Map<string, TsSymbol>, reasons: string[]): void {
  const bound = moduleExportsOf(context.ts, checker, statement);
  if (!bound || ![...FRAMEWORK.values()].includes(bound.specifier)) return;
  const expected = new Set([...FRAMEWORK].filter(([, packageName]) => packageName === bound.specifier).map(([name]) => name));
  const selected = referencedExports(context.ts, statement, expected);
  if (!selected.length) return;
  if (!bound.symbol) {
    reasons.push(`${relativePath(config.root, sourceFile.fileName)} cannot resolve ${bound.specifier}`);
    return;
  }
  for (const name of selected) {
    const target = bound.exports.get(name);
    if (!target) {
      reasons.push(`${relativePath(config.root, sourceFile.fileName)} cannot resolve ${name} from ${bound.specifier}`);
      continue;
    }
    targets.set(name, target);
  }
}

function frameworkTargets(config: ArchitectureConfig, context: TypeContext, checker: TypeChecker, localFiles: Set<string>): FrameworkTargets {
  const targets = new Map<string, TsSymbol>();
  const reasons: string[] = [];
  const files = programSourcesOf(context, checker, localFiles);
  if (!files) return { targets, reasons: ['a TypeScript program checker could not be associated with its source'] };
  for (const sourceFile of files) {
    for (const statement of sourceFile.statements) collectFrameworkStatement(config, context, checker, sourceFile, statement, targets, reasons);
    commonJsRequireReasons(context.ts, checker, sourceFile, (specifier) => [...FRAMEWORK.values()].includes(specifier),
      reasons, relativePath(config.root, sourceFile.fileName), 'whose decorator identity cannot be proved', 'Nest framework binding');
  }
  return { targets, reasons };
}

function classToken(ts: TypeScriptApi, checker: TypeChecker, node: Node, localFiles: Set<string>): { key: string | null; external: boolean } {
  const symbol = valueSymbol(ts, checker, node);
  const declarations = (symbol?.getDeclarations?.() ?? []).filter((declaration): declaration is ClassDeclaration => ts.isClassDeclaration(declaration)) ?? [];
  const local = declarations.filter(declaration => localFiles.has(canonical(declaration.getSourceFile().fileName)));
  const keys = [...new Set(local.map(declaration => `${canonical(declaration.getSourceFile().fileName)}#${declaration.getStart(declaration.getSourceFile())}`))];
  return { key: keys.length === 1 ? keys[0] ?? null : null, external: declarations.length > 0 && local.length === 0 };
}

function localClassKey(ts: TypeScriptApi, checker: TypeChecker, node: Node, localFiles: Set<string>): string | null {
  return classToken(ts, checker, node, localFiles).key;
}

function propertyName(ts: TypeScriptApi, property: ObjectLiteralElementLike): string | null {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) return property.name.text;
  return null;
}

function inspectTokenElement(ts: TypeScriptApi, checker: TypeChecker, element: Expression, localFiles: Set<string>, field: string, tokens: Map<string, Node[]>): boolean {
  if (ts.isSpreadElement(element)) return true;
  let key: string | null;
  let node: Expression = element;
  if (ts.isObjectLiteralExpression(element)) {
    if (element.properties.some(property => ts.isSpreadAssignment(property))) return true;
    const providers = element.properties.filter(property => propertyName(ts, property) === 'provide');
    const [provider] = providers;
    if (providers.length !== 1 || !provider || !ts.isPropertyAssignment(provider)) return true;
    node = provider.initializer;
    key = localClassKey(ts, checker, node, localFiles);
  } else {
    const token = classToken(ts, checker, element, localFiles);
    key = token.key;
    if (!key) return field === 'providers' && !token.external;
  }
  if (key) {
    let nodes = tokens.get(key);
    if (!nodes) {
      nodes = [];
      tokens.set(key, nodes);
    }
    nodes.push(node);
  }
  return false;
}

function tokenEntries(ts: TypeScriptApi, checker: TypeChecker, initializer: Expression, localFiles: Set<string>, field: string): TokenEntries {
  const array = unwrapExpression(ts, initializer);
  if (!ts.isArrayLiteralExpression(array)) return { tokens: new Map(), unknown: true };
  const tokens = new Map<string, Node[]>();
  let unknown = false;
  for (const element of array.elements) {
    if (inspectTokenElement(ts, checker, element, localFiles, field, tokens)) unknown = true;
  }
  return { tokens, unknown };
}

function metadataTokens(ts: TypeScriptApi, checker: TypeChecker, metadata: Expression, field: string, localFiles: Set<string>): TokenEntries {
  const object = unwrapExpression(ts, metadata);
  if (!ts.isObjectLiteralExpression(object)) return { tokens: new Map(), unknown: true };
  if (object.properties.some(property => ts.isSpreadAssignment(property))) return { tokens: new Map(), unknown: true };
  const matches = object.properties.filter(property => propertyName(ts, property) === field);
  if (!matches.length) return { tokens: new Map(), unknown: false };
  const [match] = matches;
  if (matches.length !== 1 || !match || !ts.isPropertyAssignment(match)) return { tokens: new Map(), unknown: true };
  return tokenEntries(ts, checker, match.initializer, localFiles, field);
}

function moduleRecord(config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, declaration: ClassDeclaration, decorator: Decorator, checker: TypeChecker, localFiles: Set<string>): ModuleRecord {
  const call = decorator.expression;
  const location = declaration.name ?? declaration;
  const base: ModuleRecord = {
    key: declaration.name ? localClassKey(context.ts, checker, declaration.name, localFiles) : null,
    name: declaration.name?.text ?? '(anonymous)',
    path: relativePath(config.root, sourceFile.fileName),
    ...sourceLocation(sourceFile, location),
    providers: new Map(),
    exports: new Map(),
    unknown: false,
  };
  const [metadata] = context.ts.isCallExpression(call) ? call.arguments : [];
  if (!context.ts.isCallExpression(call) || call.arguments.length !== 1 || !metadata || !base.key) return { ...base, unknown: true };
  const providers = metadataTokens(context.ts, checker, metadata, 'providers', localFiles);
  const exports = metadataTokens(context.ts, checker, metadata, 'exports', localFiles);
  return { ...base, providers: providers.tokens, exports: exports.tokens, unknown: providers.unknown || exports.unknown };
}

function registrationFinding(module: ModuleRecord, node: Node, ruleId: string, message: string, extra: Record<string, unknown> = {}): Violation {
  return { ruleId, path: module.path, ...sourceLocation(node.getSourceFile(), node), module: module.name, message, ...extra };
}

const modulesByFileOf = (config: ArchitectureConfig, modules: ModuleRecord[]): Map<string, ModuleRecord[]> => {
  const byFile = new Map<string, ModuleRecord[]>();
  for (const module of modules) {
    const file = canonical(path.resolve(config.root, ...module.path.split('/')));
    let list = byFile.get(file);
    if (!list) {
      list = [];
      byFile.set(file, list);
    }
    list.push(module);
  }
  return byFile;
};

/** The modules whose file the runtime import edges reach from `rootFile`, in first-visit order; each is added to `bound`. */
const reachableModules = (context: TypeContext, byFile: Map<string, ModuleRecord[]>, rootFile: string, bound: Set<ModuleRecord>): ModuleRecord[] => {
  const queue = [rootFile];
  const seen = new Set<string>();
  const reachable: ModuleRecord[] = [];
  for (const file of queue) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const module of byFile.get(file) ?? []) {
      reachable.push(module);
      bound.add(module);
    }
    for (const edge of context.edges.get(file) ?? []) if (edge.runtime && !seen.has(edge.to)) queue.push(edge.to);
  }
  return reachable;
};

/** A module belongs to an app only when its runtime source is reachable from that app's composition root. */
function applicationGraphs(config: ArchitectureConfig, context: TypeContext, modules: ModuleRecord[]): ModuleRecord[][] {
  const roots = modules.filter(module => /^apps\/[^/]+\/src\/app\.module\.ts$/.test(module.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  // Small architecture fixtures without app composition retain the original single-graph relation.
  if (!roots.length) return [modules];
  const byFile = modulesByFileOf(config, modules);
  const bound = new Set<ModuleRecord>();
  const graphs = roots.map(root => reachableModules(context, byFile, canonical(path.resolve(config.root, ...root.path.split('/'))), bound));
  // A module outside every proven app graph can still contain a duplicate in its own metadata.
  return [...graphs, ...modules.filter(module => !bound.has(module)).map(module => [module])];
}

function decoratorKinds(ts: TypeScriptApi, checker: TypeChecker, node: ClassDeclaration, framework: FrameworkTargets): DecoratorKind[] {
  return nodeDecorators(ts, node).map(decorator => ({ decorator, kind: frameworkDecorator(ts, checker, decorator, framework.targets) }));
}

function recordMutableDecoratorReasons(config: ArchitectureConfig, ts: TypeScriptApi, checker: TypeChecker, sourceFile: SourceFile, kinds: DecoratorKind[], framework: FrameworkTargets, reasons: string[]): void {
  for (const { decorator, kind } of kinds) {
    const dynamic = kind ? null : mutableFrameworkAlias(ts, checker, decorator, framework.targets);
    if (dynamic) reasons.push(`${relativePath(config.root, sourceFile.fileName)} uses mutable ${dynamic} decorator identity`);
  }
}

function recordModuleDecorator(site: RegistrationSite, node: ClassDeclaration, kinds: DecoratorKind[], found: Found): void {
  const { config, context, sourceFile, checker, localFiles } = site;
  const { modules, reasons } = found;
  const moduleDecorators = kinds.filter(item => item.kind === 'Module');
  const [moduleDecorator] = moduleDecorators;
  if (moduleDecorators.length === 1 && moduleDecorator) modules.push(moduleRecord(config, context, sourceFile, node, moduleDecorator.decorator, checker, localFiles));
  else if (moduleDecorators.length > 1) reasons.push(`${relativePath(config.root, sourceFile.fileName)} has multiple resolved @Module decorators`);
}

function recordHandlerDecorator(site: RegistrationSite, node: ClassDeclaration, kinds: DecoratorKind[], found: Found): void {
  const { config, context, sourceFile, checker, localFiles } = site;
  const { handlers, reasons } = found;
  const { ts } = context;
  const handlerDecorators = kinds.filter((item): item is DecoratorKind & { kind: string } => item.kind === 'CommandHandler' || item.kind === 'QueryHandler');
  const [handlerDecorator] = handlerDecorators;
  if (handlerDecorators.length === 1 && handlerDecorator) handlers.push({
    key: node.name ? localClassKey(ts, checker, node.name, localFiles) : null,
    name: node.name?.text ?? '(anonymous)',
    kind: handlerDecorator.kind,
    path: relativePath(config.root, sourceFile.fileName),
    ...sourceLocation(sourceFile, node.name ?? node),
  });
  else if (handlerDecorators.length > 1) reasons.push(`${relativePath(config.root, sourceFile.fileName)} has multiple resolved CQRS handler decorators`);
}

function inspectRegistrationClass(site: RegistrationSite, node: Node, found: Found): void {
  const { config, context, sourceFile, checker, framework } = site;
  const { ts } = context;
  if (!ts.isClassDeclaration(node)) return;
  const kinds = decoratorKinds(ts, checker, node, framework);
  recordMutableDecoratorReasons(config, ts, checker, sourceFile, kinds, framework, found.reasons);
  recordModuleDecorator(site, node, kinds, found);
  recordHandlerDecorator(site, node, kinds, found);
}

function discoverRegistrations(config: ArchitectureConfig, context: TypeContext, localFiles: Set<string>): Found {
  const modules: ModuleRecord[] = [];
  const handlers: HandlerRecord[] = [];
  const reasons: string[] = [];
  const found: Found = { modules, handlers, reasons };
  const frameworkByChecker = new Map<TypeChecker, FrameworkTargets>();
  for (const sourceFile of context.files) {
    const checker = context.checkerFor(sourceFile.fileName);
    if (!checker) continue;
    let framework = frameworkByChecker.get(checker);
    if (!framework) {
      framework = frameworkTargets(config, context, checker, localFiles);
      frameworkByChecker.set(checker, framework);
    }
    reasons.push(...framework.reasons);
    const site: RegistrationSite = { config, context, sourceFile, checker, localFiles, framework };
    const visit = (node: Node): void => {
      inspectRegistrationClass(site, node, found);
      context.ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { modules, handlers, reasons };
}

function providerOwnersOf(modules: ModuleRecord[]): Map<string, ModuleRecord[]> {
  const providerOwners = new Map<string, ModuleRecord[]>();
  for (const module of modules) {
    for (const key of module.providers.keys()) {
      if (!module.exports.has(key)) continue;
      let owners = providerOwners.get(key);
      if (!owners) {
        owners = [];
        providerOwners.set(key, owners);
      }
      owners.push(module);
    }
  }
  return providerOwners;
}

const byModulePath = (a: ProviderRegistration, b: ProviderRegistration): number => a.module.path.localeCompare(b.module.path) || a.node.getStart() - b.node.getStart();

/** The registrations of `key` in a graph that follow the first one of its owner module: the owner registers it once, every other is a duplicate. */
const duplicateRegistrations = (graph: ModuleRecord[], key: string, owner: ModuleRecord): ProviderRegistration[] => {
  const registrations = graph.flatMap(module => (module.providers.get(key) ?? []).map((node): ProviderRegistration => ({ module, node })))
    .sort(byModulePath);
  let keptOwnerRegistration = false;
  return registrations.filter(registration => {
    if (registration.module !== owner || keptOwnerRegistration) return true;
    keptOwnerRegistration = true;
    return false;
  });
};

function reregistrationViolations(config: ArchitectureConfig, context: TypeContext, modules: ModuleRecord[], providerOwners: Map<string, ModuleRecord[]>): Violation[] {
  const violations: Violation[] = [];
  const reportedRegistrations = new Set<string>();
  const report = (key: string, owner: ModuleRecord, duplicate: ProviderRegistration): void => {
    const identity = `${key}\0${duplicate.module.path}\0${duplicate.node.getStart()}`;
    if (reportedRegistrations.has(identity)) return;
    reportedRegistrations.add(identity);
    violations.push(registrationFinding(duplicate.module, duplicate.node,
      'BE_MODULE_PROVIDER_REREGISTRATION',
      `Class-token provider exported by ${owner.name} is registered again by ${duplicate.module.name} in one application graph; import the owning module and preserve one class-token registration.`,
      { ownerModule: owner.name, ownerPath: owner.path }));
  };
  for (const graph of applicationGraphs(config, context, modules)) for (const [key] of providerOwners) {
    const owners = graph.filter(module => module.providers.has(key) && module.exports.has(key))
      .sort((a, b) => a.path.localeCompare(b.path));
    const [owner] = owners;
    if (!owner) continue;
    for (const duplicate of duplicateRegistrations(graph, key, owner)) report(key, owner, duplicate);
  }
  return violations;
}

function handlerRegistrationViolations(modules: ModuleRecord[], handlers: HandlerRecord[], selected: ArchitectureConfig['backend']['moduleRegistration']): Violation[] {
  const violations: Violation[] = [];
  for (const handler of handlers.filter(item => item.key && selected.handlerDecorators.includes(item.kind))) {
    const registrations = modules.flatMap(module => (module.providers.get(handler.key ?? '') ?? []).map((node): ProviderRegistration => ({ module, node })));
    if (registrations.length !== 1) violations.push({
      ruleId: 'BE_MODULE_HANDLER_REGISTRATION', path: handler.path, line: handler.line, column: handler.column,
      handler: handler.name, decorator: handler.kind,
      message: registrations.length === 0
        ? `${handler.kind} ${handler.name} is not registered as a direct class-token provider in a resolved Nest module.`
        : `${handler.kind} ${handler.name} has multiple direct module registrations; one owner must preserve its handler identity.`,
      modules: registrations.map(registration => ({ name: registration.module.name, path: registration.module.path,
        ...sourceLocation(registration.node.getSourceFile(), registration.node) })),
    });
  }
  return violations;
}

/** Prove only static exported class-token identity and selected CQRS handler registration. */
export function checkModuleRegistration(config: ArchitectureConfig, context: TypeContext): ModuleRegistrationResult {
  const selected = config.backend.moduleRegistration;
  if (!selected) return { violations: [], coverage: { status: 'unavailable', reason: 'hfs.json does not select Nest module-registration identity checks' } };
  const localFiles = new Set(context.files.map(file => canonical(file.fileName)));
  const { modules, handlers, reasons } = discoverRegistrations(config, context, localFiles);
  for (const module of modules) if (module.unknown) reasons.push(`${module.path} has dynamic or unresolvable @Module providers/exports metadata`);
  for (const handler of handlers) {
    if (!handler.key) reasons.push(`${handler.path} handler class identity is not resolvable`);
    if (!selected.handlerDecorators.includes(handler.kind)) reasons.push(`${handler.path} uses unselected ${handler.kind}`);
  }
  const providerOwners = providerOwnersOf(modules);
  const violations = reregistrationViolations(config, context, modules, providerOwners);
  violations.push(...handlerRegistrationViolations(modules, handlers, selected));
  const coverage = reasons.length
    ? { status: 'unavailable', reason: 'one or more Nest module-registration relations are not statically provable', details: [...new Set(reasons)].sort(byCodeUnit) }
    : { status: 'checked', modules: modules.length, exportedClassTokenProviders: providerOwners.size, handlers: handlers.length,
      selectedHandlerDecorators: selected.handlerDecorators };
  return { violations, coverage };
}

export { REGISTRATION_RULE_IDS };
