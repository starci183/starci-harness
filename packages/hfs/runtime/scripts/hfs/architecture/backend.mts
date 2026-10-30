import path from 'node:path';
import { isInside } from './config.mjs';
import { allowsFile, slotAdmitsFile } from '../allows.mjs';
import { reachableViolation, relativePath } from './typescript.mjs';
import { checkApplicationEnvironment } from './backend-app-files.mjs';
import { accessName, sourceLocation } from '../../lib/ts-ast.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import type { BindingElement, Decorator, ExportDeclaration, Identifier, NamedExports, Node, SourceFile, Statement, StringLiteralLike, TypeChecker } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation } from './hfs-graph.mjs';
import type { TypeContext } from './type-context.mjs';
import type { ImportEdge } from './typescript.mjs';

/** An application source file: the app root it sits in and its path below that app's src/. */
interface AppSource {
  appRoot: string;
  relative: string;
}

/** A node with the text that names what was found there. */
interface NodeDetail {
  node: Node;
  detail: string;
}

/** Transport framework surface found in a source file: where, which module and what. */
interface TransportEvidence extends NodeDetail {
  specifier: string;
}

/** The names a re-export chain still selects from a module: null means every name. */
type Selected = Set<string> | null;

/** An import binding of a source file: the module and the name imported from it (null for a namespace). */
interface ImportedBinding {
  specifier: string;
  imported: string | null;
}

/** One module reached along a re-export chain with the names still selected. */
interface ReexportQueueItem {
  file: string;
  selected: Selected;
  chain: string[];
}

/** The backend source roots one run judges. */
interface BackendRoots {
  moduleRoots: string[];
  featureRoots: string[];
  nonAppRoots: string[];
}

type AliasTest = (node: Node) => boolean;

const FORBIDDEN_APP_ROLE = /(?:^|\.)(?:service|provider|providers|resolver|controller|handler|repository|entity|use-case|command|query|listener|consumer|processor)\.[cm]?[jt]sx?$/i;
const FORBIDDEN_DECLARATION = /(?:Service|Provider|Resolver|Controller|Handler|Repository|Entity|UseCase|Command|Query|Listener|Consumer|Processor)$/;
const FORBIDDEN_DECORATORS = new Set(['Controller', 'Resolver', 'Injectable', 'Processor', 'WebSocketGateway']);
const TRANSPORT_PACKAGES = new RegExp(`^(?:${[
  '@nestjs/(?:graphql|microservices|platform-[^/]+|websockets)(?:/|$)',
  '@apollo/',
  'apollo-server(?:/|$)',
  'express(?:/|$)',
  'fastify(?:/|$)',
  'graphql(?:/|$)',
  'class-validator(?:/|$)',
  'class-transformer(?:/|$)',
].join('|')})`);
const NEST_COMMON_TRANSPORT = new Set(['Controller', 'Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'Body', 'Param', 'Query', 'Req', 'Request', 'Res', 'Response', 'Headers', 'Header', 'HttpCode', 'Redirect', 'Render', 'Sse', 'UploadedFile', 'UploadedFiles', 'UseGuards', 'UseInterceptors', 'UsePipes']);

function absolute(root: string, relative: string): string {
  return path.resolve(root, ...relative.split('/'));
}

function roots(root: string, relatives: string[]): string[] {
  return relatives.map(relative => absolute(root, relative));
}

function insideAny(candidates: string[], fileName: string): boolean {
  return candidates.some(root => isInside(root, fileName));
}

function insideFeatureLayer(featureRoots: string[], fileName: string, layer: string): boolean {
  return featureRoots.some(root => isInside(root, fileName)
    && relativePath(root, fileName).split('/').some(segment => segment.toLowerCase() === layer));
}

function appSource(config: ArchitectureConfig, fileName: string, excludedRoots: string[] = []): AppSource | null {
  if (excludedRoots.some(excluded => isInside(excluded, fileName))) return null;
  for (const appRoot of roots(config.root, config.backend.apps)) {
    if (!isInside(appRoot, fileName)) continue;
    const parts = relativePath(appRoot, fileName).split('/');
    const sourceIndex = parts.indexOf('src');
    if (sourceIndex >= 0) return { appRoot, relative: parts.slice(sourceIndex + 1).join('/') };
    // An app root may name its src/ directly (apps/<app>/src), but the repository src/ itself is
    // never an app root: HFS composition lives under apps/<app> only.
    const appRootRelative = relativePath(config.root, appRoot).split('/');
    if (path.basename(appRoot).toLowerCase() === 'src' && appRootRelative[0] === 'apps' && appRootRelative.length > 1) {
      return { appRoot, relative: parts.join('/') };
    }
    return null;
  }
  return null;
}

function decoratorName(ts: TypeScriptApi, decorator: Decorator): string | null {
  const expression = decorator.expression;
  const called = ts.isCallExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(called)) return called.text;
  return ts.isPropertyAccessExpression(called) ? called.name.text : null;
}

function roleEvidence(ts: TypeScriptApi, sourceFile: SourceFile): NodeDetail | null {
  let found: NodeDetail | null = null;
  const visit = (node: Node): void => {
    if (found) return;
    // reason: compilers before TypeScript 4.8 expose decorators as node.decorators, which the current typings no longer declare
    const legacyDecorators = (node as { decorators?: readonly Decorator[] }).decorators;
    const decorators = ts.canHaveDecorators?.(node) ? ts.getDecorators(node) ?? [] : legacyDecorators ?? [];
    const forbidden = decorators.find(item => FORBIDDEN_DECORATORS.has(decoratorName(ts, item) ?? ''));
    if (forbidden) {
      found = { node: forbidden, detail: `@${decoratorName(ts, forbidden)}` };
      return;
    }
    if ((ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && FORBIDDEN_DECLARATION.test(node.name.text)) {
      found = { node: node.name, detail: node.name.text };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// The destructured binding elements naming a transport export (or a computed binding, which cannot be
// proved to exclude one): `const { Controller, [x]: y } = ...`. `rest` elements are always opaque.
function destructuredTransportBindings(ts: TypeScriptApi, elements: readonly BindingElement[], detail: string): NodeDetail[] {
  return elements.flatMap((element): NodeDetail[] => {
    let selected: string | null = null;
    if (!element.dotDotDotToken) {
      const imported = element.propertyName ?? element.name;
      if (ts.isIdentifier(imported) || ts.isStringLiteralLike(imported)) selected = imported.text;
    }
    return selected === null || NEST_COMMON_TRANSPORT.has(selected) ? [{ node: element, detail: selected ?? detail }] : [];
  });
}

const namespaceMemberUsages = (ts: TypeScriptApi, node: Node, isAlias: AliasTest): NodeDetail[] => {
  if (ts.isPropertyAccessExpression(node) && isAlias(node.expression)
    && NEST_COMMON_TRANSPORT.has(node.name.text)) return [{ node: node.name, detail: node.name.text }];
  if (ts.isElementAccessExpression(node) && isAlias(node.expression)) {
    const selected = ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
    if (selected === null || NEST_COMMON_TRANSPORT.has(selected)) return [{ node: node.argumentExpression, detail: selected ?? 'computed @nestjs/common namespace access' }];
  }
  return [];
};

const namespaceEscapeUsages = (ts: TypeScriptApi, node: Node, isAlias: AliasTest): NodeDetail[] => {
  if (!ts.isVariableDeclaration(node) || !node.initializer || !isAlias(node.initializer)) return [];
  if (!ts.isObjectBindingPattern(node.name)) return [{ node: node.name, detail: 'escaped @nestjs/common namespace access' }];
  return destructuredTransportBindings(ts, node.name.elements, 'computed @nestjs/common namespace destructuring');
};

function namespaceTransportUsages(ts: TypeScriptApi, sourceFile: SourceFile, checker: TypeChecker | null, binding: Identifier): NodeDetail[] {
  const usages: NodeDetail[] = [];
  const alias = binding.text;
  const bindingSymbol = checker?.getSymbolAtLocation(binding);
  const isAlias: AliasTest = node => ts.isIdentifier(node) && node.text === alias
    && (!bindingSymbol || checker?.getSymbolAtLocation(node) === bindingSymbol);
  const visit = (node: Node): void => {
    usages.push(...namespaceMemberUsages(ts, node, isAlias), ...namespaceEscapeUsages(ts, node, isAlias));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return usages;
}

function importSpecifierOf(ts: TypeScriptApi, statement: Statement): StringLiteralLike | null {
  const importEqualsSpecifier = ts.isImportEqualsDeclaration(statement)
    && ts.isExternalModuleReference(statement.moduleReference)
    && statement.moduleReference.expression
    && ts.isStringLiteralLike(statement.moduleReference.expression)
    ? statement.moduleReference.expression
    : null;
  let importSpecifier: StringLiteralLike | null = importEqualsSpecifier;
  if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) importSpecifier = statement.moduleSpecifier;
  return importSpecifier;
}

function addCommonImportEvidence(ts: TypeScriptApi, statement: Statement, importSpecifier: StringLiteralLike, sourceFile: SourceFile, checker: TypeChecker | null, found: TransportEvidence[]): void {
  if (ts.isImportEqualsDeclaration(statement)) {
    found.push(...namespaceTransportUsages(ts, sourceFile, checker, statement.name).map(item => ({ ...item, specifier: importSpecifier.text })));
    return;
  }
  if (!ts.isImportDeclaration(statement) || !statement.importClause) return;
  const bindings = statement.importClause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    found.push(...namespaceTransportUsages(ts, sourceFile, checker, bindings.name).map(item => ({ ...item, specifier: importSpecifier.text })));
    return;
  }
  if (!bindings || !ts.isNamedImports(bindings)) return;
  for (const element of bindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    if (NEST_COMMON_TRANSPORT.has(imported)) found.push({ node: element, specifier: importSpecifier.text, detail: imported });
  }
}

function importTransportEvidence(ts: TypeScriptApi, sourceFile: SourceFile, checker: TypeChecker | null, found: TransportEvidence[]): void {
  for (const statement of sourceFile.statements) {
    const importSpecifier = importSpecifierOf(ts, statement);
    if (!importSpecifier) continue;
    const specifier = importSpecifier.text;
    if (TRANSPORT_PACKAGES.test(specifier)) {
      found.push({ node: importSpecifier, specifier, detail: specifier });
      continue;
    }
    if (specifier === '@nestjs/common') addCommonImportEvidence(ts, statement, importSpecifier, sourceFile, checker, found);
  }
}

function requiredSpecifier(ts: TypeScriptApi, call: Node): string | null {
  const first = ts.isCallExpression(call) ? call.arguments[0] : undefined;
  return ts.isCallExpression(call)
    && ts.isIdentifier(call.expression) && call.expression.text === 'require'
    && call.arguments.length === 1 && first && ts.isStringLiteralLike(first)
    ? first.text
    : null;
}

function requiredMemberEvidence(ts: TypeScriptApi, node: Node, found: TransportEvidence[]): void {
  if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) || !ts.isCallExpression(node.expression)) return;
  const specifier = requiredSpecifier(ts, node.expression);
  const selected = accessName(ts, node);
  const member = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
  if (specifier && TRANSPORT_PACKAGES.test(specifier)) {
    found.push({ node: member, specifier, detail: `${selected ?? 'computed member'} from ${specifier}` });
  } else if (specifier === '@nestjs/common' && (selected === null || NEST_COMMON_TRANSPORT.has(selected))) {
    found.push({ node: member, specifier, detail: selected ?? 'computed @nestjs/common require access' });
  }
}

function requiredVariableEvidence(ts: TypeScriptApi, node: Node, sourceFile: SourceFile, checker: TypeChecker | null, found: TransportEvidence[]): void {
  if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isCallExpression(node.initializer)) return;
  const specifier = requiredSpecifier(ts, node.initializer);
  const argument = node.initializer.arguments[0];
  if (!specifier || !argument) return;
  if (TRANSPORT_PACKAGES.test(specifier)) {
    found.push({ node: argument, specifier, detail: specifier });
  } else if (specifier === '@nestjs/common') {
    if (ts.isIdentifier(node.name)) {
      found.push(...namespaceTransportUsages(ts, sourceFile, checker, node.name).map(item => ({ ...item, specifier })));
    } else if (ts.isObjectBindingPattern(node.name)) {
      found.push(...destructuredTransportBindings(ts, node.name.elements, 'computed @nestjs/common require destructuring').map(item => ({ ...item, specifier })));
    }
  }
}

function requiredTransportEvidence(ts: TypeScriptApi, node: Node, sourceFile: SourceFile, checker: TypeChecker | null, found: TransportEvidence[]): void {
  requiredMemberEvidence(ts, node, found);
  requiredVariableEvidence(ts, node, sourceFile, checker, found);
  ts.forEachChild(node, child => requiredTransportEvidence(ts, child, sourceFile, checker, found));
}

function transportFrameworkEvidence(ts: TypeScriptApi, sourceFile: SourceFile, checker: TypeChecker | null): TransportEvidence[] {
  const found: TransportEvidence[] = [];
  importTransportEvidence(ts, sourceFile, checker, found);
  requiredTransportEvidence(ts, sourceFile, sourceFile, checker, found);
  return found;
}

function importedSurface(ts: TypeScriptApi, declaration: Node): Set<string> | null {
  if (!ts.isImportDeclaration(declaration)) return null;
  const clause = declaration.importClause;
  if (!clause) return null;
  const names = new Set(clause.name ? ['default'] : []);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) return null;
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) names.add(element.propertyName?.text ?? element.name.text);
  }
  return names;
}

function selectedReexportSurface(ts: TypeScriptApi, declaration: Node, selected: Selected): Selected | undefined {
  if (!ts.isExportDeclaration(declaration)) return undefined;
  if (!declaration.exportClause) return selected;
  if (ts.isNamespaceExport(declaration.exportClause)) {
    return selected === null || selected.has(declaration.exportClause.name.text) ? null : undefined;
  }
  if (!ts.isNamedExports(declaration.exportClause)) return undefined;
  const next = new Set<string>();
  for (const element of declaration.exportClause.elements) {
    if (selected === null || selected.has(element.name.text)) next.add(element.propertyName?.text ?? element.name.text);
  }
  return next.size ? next : undefined;
}

function importedTransportBindings(ts: TypeScriptApi, sourceFile: SourceFile): Map<string, ImportedBinding> {
  const imported = new Map<string, ImportedBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier) || !statement.importClause) continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) imported.set(element.name.text, { specifier, imported: element.propertyName?.text ?? element.name.text });
    } else if (bindings && ts.isNamespaceImport(bindings)) imported.set(bindings.name.text, { specifier, imported: null });
  }
  return imported;
}

const unnamedReexport = (statement: ExportDeclaration, specifier: string, selected: Selected): TransportEvidence | null => {
  if (specifier !== '@nestjs/common' || selected === null || [...selected].some(name => NEST_COMMON_TRANSPORT.has(name))) {
    return { node: statement.moduleSpecifier ?? statement, specifier, detail: selected === null ? `unbounded ${specifier} re-export` : `re-exported ${[...selected].join(', ')}` };
  }
  return null;
};

const namedReexport = (clause: NamedExports, specifier: string, selected: Selected): TransportEvidence | null => {
  for (const element of clause.elements) {
    if (selected !== null && !selected.has(element.name.text)) continue;
    const original = element.propertyName?.text ?? element.name.text;
    if (specifier !== '@nestjs/common' || NEST_COMMON_TRANSPORT.has(original)) return { node: element, specifier, detail: `${element.name.text} re-exported from ${specifier}` };
  }
  return null;
};

function directTransportReexport(ts: TypeScriptApi, statement: ExportDeclaration, specifier: string, selected: Selected): TransportEvidence | null {
  const clause = statement.exportClause;
  if (!clause) return unnamedReexport(statement, specifier, selected);
  if (ts.isNamespaceExport(clause)) {
    return selected === null || selected.has(clause.name.text) ? { node: clause.name, specifier, detail: `namespace re-export from ${specifier}` } : null;
  }
  return ts.isNamedExports(clause) ? namedReexport(clause, specifier, selected) : null;
}

/** True for an import binding of a transport package, or of a transport symbol of @nestjs/common. */
const isTransportBinding = (binding: ImportedBinding): boolean => (binding.specifier === '@nestjs/common'
  ? binding.imported !== null && NEST_COMMON_TRANSPORT.has(binding.imported)
  : TRANSPORT_PACKAGES.test(binding.specifier));

function localTransportReexport(ts: TypeScriptApi, statement: ExportDeclaration, selected: Selected, imported: Map<string, ImportedBinding>): TransportEvidence | null {
  const clause = statement.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return null;
  for (const element of clause.elements) {
    if (selected !== null && !selected.has(element.name.text)) continue;
    const binding = imported.get(element.propertyName?.text ?? element.name.text);
    if (!binding || !isTransportBinding(binding)) continue;
    return { node: element, specifier: binding.specifier, detail: `${element.name.text} re-exported from ${binding.specifier}` };
  }
  return null;
}

const statementTransportReexport = (ts: TypeScriptApi, statement: ExportDeclaration, selected: Selected, imported: Map<string, ImportedBinding>): TransportEvidence | null => {
  const specifier = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
  if (specifier && (specifier === '@nestjs/common' || TRANSPORT_PACKAGES.test(specifier))) return directTransportReexport(ts, statement, specifier, selected);
  return specifier ? null : localTransportReexport(ts, statement, selected, imported);
};

function externalTransportReexport(ts: TypeScriptApi, sourceFile: SourceFile, selected: Selected): TransportEvidence | null {
  const imported = importedTransportBindings(ts, sourceFile);
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const evidence = statementTransportReexport(ts, statement, selected, imported);
    if (evidence) return evidence;
  }
  return null;
}

function reexportQueueKey(current: ReexportQueueItem): string {
  return `${current.file}\0${current.selected === null ? '*' : [...current.selected].sort(byCodeUnit).join(',')}`;
}

function addReexportEdges(ts: TypeScriptApi, context: TypeContext, current: ReexportQueueItem, queue: ReexportQueueItem[]): void {
  for (const edge of context.edges.get(current.file) ?? []) {
    if (!edge.reexport) continue;
    const selected = selectedReexportSurface(ts, edge.declaration, current.selected);
    if (selected !== undefined) queue.push({ file: edge.to, selected, chain: [...current.chain, edge.to] });
  }
}

function reexportedTransportEvidence(ts: TypeScriptApi, context: TypeContext, sourceFiles: Map<string, SourceFile>, firstEdge: ImportEdge): { evidence: TransportEvidence; chain: string[] } | null {
  const queue: ReexportQueueItem[] = [{ file: firstEdge.to, selected: importedSurface(ts, firstEdge.declaration), chain: [firstEdge.from, firstEdge.to] }];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    const key = reexportQueueKey(current);
    if (visited.has(key)) continue;
    visited.add(key);
    const sourceFile = sourceFiles.get(path.resolve(current.file));
    if (!sourceFile) continue;
    const evidence = externalTransportReexport(ts, sourceFile, current.selected);
    if (evidence) return { evidence, chain: current.chain };
    addReexportEdges(ts, context, current, queue);
  }
  return null;
}

function finding(config: ArchitectureConfig, edge: ImportEdge, ruleId: string, message: string, chain: string[]): ArchitectureViolation {
  return {
    ruleId,
    path: relativePath(config.root, edge.from),
    line: edge.line,
    column: edge.column,
    specifier: edge.specifier,
    resolvedPath: relativePath(config.root, chain.at(-1) ?? edge.to),
    dependencyChain: chain.map(file => relativePath(config.root, file)),
    message,
  };
}

function checkApplicationComposition(config: ArchitectureConfig, ts: TypeScriptApi, sourceFile: SourceFile, fileName: string, app: AppSource, violations: ArchitectureViolation[]): void {
  const evidence = roleEvidence(ts, sourceFile);
  if (evidence) {
    violations.push({
      ruleId: 'BE_APP_BUSINESS_ROLE',
      path: relativePath(config.root, fileName),
      ...sourceLocation(sourceFile, evidence.node),
      message: `Application composition source contains measurable business/provider role ${evidence.detail}. Move that role under src/features or src/modules.`,
    });
  } else if (slotAdmitsFile(config.hfs, relativePath(config.root, fileName)) !== true) {
    violations.push({
      ruleId: FORBIDDEN_APP_ROLE.test(path.posix.basename(app.relative)) ? 'BE_APP_BUSINESS_ROLE' : 'BE_APP_COMPOSITION_ONLY',
      path: relativePath(config.root, fileName),
      line: 1,
      column: 1,
      message: `Application source ${app.relative} is not a file its app slot requires or allows (main.ts, app.module.ts, <app>.env.ts, <app>.options.ts, compose/<area>.ts).`,
    });
  }
}

/** The app's environment parser never depends on features, even through a type import or an internal barrel. */
function checkApplicationEnvEdges(config: ArchitectureConfig, context: TypeContext, fileName: string, violations: ArchitectureViolation[]): void {
  const role = allowsFile(config.hfs, relativePath(config.root, fileName));
  if (!role?.allowed || role.entry !== '<app>.env.ts') return;
  const isFeature = (target: string): boolean => config.hfs.tierOf(relativePath(config.root, target)) === 'feature';
  for (const edge of context.edges.get(fileName) ?? []) {
    const featureChain = reachableViolation(context.edges, edge, isFeature);
    if (featureChain) violations.push(finding(config, edge, 'BE_APP_COMPOSITION_ONLY',
      'The app environment file holds typed, fail-fast environment parsing only; it cannot depend on features, including through a type import or an internal barrel.', featureChain));
  }
}

function checkApplicationTransport(config: ArchitectureConfig, context: TypeContext, sourceFile: SourceFile, fileName: string, violations: ArchitectureViolation[]): void {
  for (const evidence of transportFrameworkEvidence(context.ts, sourceFile, context.checkerFor(fileName))) {
    violations.push({
      ruleId: 'BE_APPLICATION_TRANSPORT_FRAMEWORK',
      path: relativePath(config.root, fileName),
      ...sourceLocation(sourceFile, evidence.node),
      specifier: evidence.specifier,
      message: `Feature application code imports transport framework surface ${evidence.detail}. Keep protocol decorators, request/response types, validation DTOs, and generated transport types under transport/.`,
    });
  }
}

function checkFeatureTransportEdges(config: ArchitectureConfig, context: TypeContext, sourceFiles: Map<string, SourceFile>, featureRoots: string[], fileName: string, violations: ArchitectureViolation[]): void {
  for (const edge of context.edges.get(fileName) ?? []) {
    const reexported = reexportedTransportEvidence(context.ts, context, sourceFiles, edge);
    if (reexported) violations.push(finding(config, edge, 'BE_APPLICATION_TRANSPORT_FRAMEWORK', `Feature application code imports protocol surface ${reexported.evidence.detail} through an internal re-export. Keep protocol decorators and types under transport/.`, reexported.chain));
    const transportChain = reachableViolation(context.edges, edge, target => insideFeatureLayer(featureRoots, target, 'transport'));
    if (transportChain) violations.push(finding(config, edge, 'BE_APPLICATION_IMPORTS_TRANSPORT', 'Feature application code cannot depend on transport adapters or DTOs, including through a type import or barrel.', transportChain));
  }
}

function checkBackendSource(config: ArchitectureConfig, context: TypeContext, sourceFiles: Map<string, SourceFile>, roots: BackendRoots, sourceFile: SourceFile, violations: ArchitectureViolation[]): void {
  const { moduleRoots, featureRoots, nonAppRoots } = roots;
  const fileName = path.resolve(sourceFile.fileName);
  const fromModules = insideAny(moduleRoots, fileName);
  const fromFeatures = insideAny(featureRoots, fileName);
  const fromApplication = fromFeatures && insideFeatureLayer(featureRoots, fileName, 'application');
  const app = !fromModules && !fromFeatures ? appSource(config, fileName, nonAppRoots) : null;
  if (app) {
    checkApplicationComposition(config, context.ts, sourceFile, fileName, app, violations);
    checkApplicationEnvEdges(config, context, fileName, violations);
    checkApplicationEnvironment(config, context, sourceFile, fileName, violations);
  }
  if (!fromModules && !fromFeatures) return;
  if (fromApplication) checkApplicationTransport(config, context, sourceFile, fileName, violations);
  if (fromApplication) checkFeatureTransportEdges(config, context, sourceFiles, featureRoots, fileName, violations);
}

/** Enforce backend direction and keep executable apps as measurable composition roots. */
export function checkBackend(config: ArchitectureConfig, context: TypeContext): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const moduleRoots = roots(config.root, config.backend.modules);
  const featureRoots = roots(config.root, config.backend.features);
  const sourceRoots = { moduleRoots, featureRoots, nonAppRoots: [...moduleRoots, ...featureRoots] };
  const sourceFiles = new Map(context.files.map((file): [string, SourceFile] => [path.resolve(file.fileName), file]));
  for (const sourceFile of context.files) {
    checkBackendSource(config, context, sourceFiles, sourceRoots, sourceFile, violations);
  }
  return violations;
}
