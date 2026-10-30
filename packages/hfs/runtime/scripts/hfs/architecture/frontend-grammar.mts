import fs from 'node:fs';
import path from 'node:path';
import { canonical, isInside } from './config.mjs';
import { readJsonFile as readJson } from '../../lib/json.mjs';
import { exportTargetStrings, isUnshadowedCommonJsRequire, relativePath } from './typescript.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { sameOrUnder } from '../../lib/path-key.mjs';
import type { Node, SourceFile, TypeChecker } from 'typescript';
import type { ArchitectureConfig, GrammarContext, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation } from './hfs-graph.mjs';
import type { TypeContext } from './type-context.mjs';
import type { ImportEdge, WorkspaceRecord } from './typescript.mjs';

/** The slice of a grammar package's package.json this check reads. */
interface GrammarManifest {
  name?: unknown;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

/** One string-literal module name a source file references. */
interface LiteralModule {
  node: Node;
  specifier: string;
}

/** One consumer manifest of the grammar package with the install it resolves. */
interface GrammarConsumer {
  relative: string;
  root: string;
  packageRoot: string;
  packageManifest: GrammarManifest | null;
  manifest: GrammarManifest;
}

/** Builds one finding at a node of a source file; supplied by the frontend checker. */
export type MakeViolation = (config: ArchitectureConfig, sourceFile: SourceFile, node: Node, ruleId: string, message: string, extra?: Record<string, unknown>) => ArchitectureViolation;

/** What the per-source scan reads and updates. */
interface GrammarScan {
  config: ArchitectureConfig;
  context: TypeContext;
  grammar: GrammarContext;
  consumers: GrammarConsumer[];
  installs: GrammarConsumer[];
  allowed: Set<string>;
  violations: ArchitectureViolation[];
  makeViolation: MakeViolation;
}

function grammarExport(manifest: GrammarManifest | null | undefined, packageName: string, specifier: string): boolean {
  const key = specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
  const value = manifest?.exports?.[key];
  const targets = exportTargetStrings(value);
  return targets.length > 0 && targets.every(target => target.startsWith('./') && !target.includes('\\') && !target.split('/').includes('..'));
}

function grammarExportTargets(manifest: GrammarManifest | null | undefined, packageRoot: string, packageName: string, specifier: string): string[] {
  const key = specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
  return exportTargetStrings(manifest?.exports?.[key]).filter(target => target.startsWith('./') && !target.includes('\\') && !target.split('/').includes('..'))
    .map(target => canonical(path.resolve(packageRoot, target)));
}

function literalModules(ts: TypeScriptApi, sourceFile: SourceFile, checker: TypeChecker | null): LiteralModule[] {
  const modules: LiteralModule[] = [];
  const visit = (node: Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      modules.push({ node: node.moduleSpecifier, specifier: node.moduleSpecifier.text });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
      modules.push({ node: node.moduleReference.expression, specifier: node.moduleReference.expression.text });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && node.arguments[0] !== undefined && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || isUnshadowedCommonJsRequire(ts, checker, node.expression))) {
      modules.push({ node: node.arguments[0], specifier: node.arguments[0].text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return modules;
}

function cssImports(content: string): { specifier: string; index: number }[] {
  const imports: { specifier: string; index: number }[] = [];
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '));
  const pattern = new RegExp([String.raw`@import\s+(?:url\(\s*(?:(["'])`, String.raw`(.*?)\1|([^\s)]+))\s*\)|(["'])(.*?)\4)`].join(''), 'gi');
  for (const match of withoutComments.matchAll(pattern)) {
    const specifier = match[2] ?? match[3] ?? match[5];
    if (specifier === undefined || match.index === undefined) continue; // one alternative of the pattern always matches
    imports.push({ specifier, index: match.index });
  }
  return imports;
}

function installRootFor(config: ArchitectureConfig): string {
  return config.packageRoot ?? config.root;
}

function installedPackageRoot(installRoot: string, packageName: string, from: string): string {
  for (let dir = from; isInside(installRoot, dir); dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', ...packageName.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === installRoot || path.dirname(dir) === dir) break;
  }
  return path.join(installRoot, 'node_modules', ...packageName.split('/'));
}

function grammarConsumers(config: ArchitectureConfig, grammar: GrammarContext, local: WorkspaceRecord | undefined, installRoot: string): GrammarConsumer[] {
  return grammar.consumerManifests.map((relative): GrammarConsumer => {
    const root = path.dirname(path.join(config.root, ...relative.split('/')));
    const packageRoot = local?.root ?? installedPackageRoot(installRoot, grammar.package, root);
    return { relative, root, packageRoot, packageManifest: readJson(path.join(packageRoot, 'package.json')),
      manifest: readJson(path.join(config.root, ...relative.split('/'))) ?? {} };
  });
}

function uniqueGrammarInstalls(consumers: GrammarConsumer[]): GrammarConsumer[] {
  return [...new Map(consumers.map((consumer): [string, GrammarConsumer] => [consumer.packageRoot, consumer])).values()];
}

function grammarPackageRoot(installs: GrammarConsumer[], local: WorkspaceRecord | undefined, installRoot: string, packageName: string): string {
  return installs[0]?.packageRoot ?? local?.root ?? path.join(installRoot, 'node_modules', ...packageName.split('/'));
}

function addInstallContractProblems(install: GrammarConsumer, installs: GrammarConsumer[], grammar: GrammarContext, configRoot: string, problems: string[]): void {
  const where = installs.length > 1 ? ` (as ${install.relative} resolves it, ${relativePath(configRoot, install.packageRoot)})` : '';
  if (install.packageManifest?.name !== grammar.package) problems.push(`installed package ${grammar.package} is unavailable or has a different name${where}`);
  if (!grammarExport(install.packageManifest, grammar.package, grammar.entry)) problems.push(`${grammar.entry} is not a safe declared package export${where}`);
  if (!grammarExport(install.packageManifest, grammar.package, grammar.styleEntry)) problems.push(`${grammar.styleEntry} is not a safe declared style export${where}`);
  const actualPeers = Object.keys(install.packageManifest?.peerDependencies ?? {}).sort(byCodeUnit);
  const selectedPeers = [...grammar.peers].sort(byCodeUnit);
  if (JSON.stringify(actualPeers) !== JSON.stringify(selectedPeers)) {
    problems.push(`${grammar.package} peerDependencies must exactly match the selected peers ${selectedPeers.join(', ')}${where}`);
  }
}

function addConsumerDependencyProblems(grammar: GrammarContext, consumers: GrammarConsumer[], problems: string[]): void {
  for (const consumer of consumers) if (!Object.hasOwn(consumer.manifest.dependencies ?? {}, grammar.package)) {
    problems.push(`${consumer.relative} does not declare ${grammar.package} as a runtime dependency`);
  }
  for (const peer of grammar.peers) {
    for (const consumer of consumers) if (!Object.hasOwn(consumer.manifest.dependencies ?? {}, peer) && !Object.hasOwn(consumer.manifest.peerDependencies ?? {}, peer)) {
      problems.push(`${consumer.relative} does not declare Grammar peer ${peer}`);
    }
  }
}

function addGrammarStyleProblems(config: ArchitectureConfig, grammar: GrammarContext, problems: string[], styleBypasses: ArchitectureViolation[]): void {
  for (const source of grammar.styleSources) {
    const content = fs.readFileSync(path.join(config.root, ...source.split('/')), 'utf8');
    const grammarStyles = cssImports(content).filter(item => item.specifier === grammar.package || item.specifier.startsWith(`${grammar.package}/`));
    if (!grammarStyles.some(item => item.specifier === grammar.styleEntry)) problems.push(`${source} does not import ${grammar.styleEntry}`);
    for (const imported of grammarStyles) if (imported.specifier !== grammar.styleEntry) {
      problems.push(`${source} imports Grammar style ${imported.specifier} outside the selected style entry`);
      styleBypasses.push({ ruleId: 'ARCH_GRAMMAR_EXPORT_BYPASS', path: source,
        line: content.slice(0, imported.index).split(/\r?\n/u).length, column: 1, package: grammar.package, specifier: imported.specifier,
        message: `Style source must use the selected Grammar style entry ${grammar.styleEntry}; ${imported.specifier} is outside that contract.` });
    }
  }
}

function grammarOwner(consumers: GrammarConsumer[], fileName: string): GrammarConsumer | null {
  return consumers.filter(consumer => isInside(consumer.root, fileName))
    .sort((a, b) => b.root.length - a.root.length)[0] ?? null;
}

function sourceEdges(context: TypeContext, sourceFile: SourceFile): Map<number, ImportEdge> {
  return new Map((context.edges.get(path.resolve(sourceFile.fileName)) ?? []).map((edge): [number, ImportEdge] => [edge.node.getStart(sourceFile), edge]));
}

function grammarReferenceAllowed(reference: LiteralModule, sourceFile: SourceFile, owner: GrammarConsumer, edgesByStart: Map<number, ImportEdge>, grammar: GrammarContext, allowed: Set<string>): boolean {
  if (!allowed.has(reference.specifier)) return false;
  const edge = edgesByStart.get(reference.node.getStart(sourceFile));
  const expected = grammarExportTargets(owner.packageManifest, owner.packageRoot, grammar.package, reference.specifier);
  return !edge || expected.includes(canonical(edge.to));
}

function reportGrammarReference(scan: GrammarScan, sourceFile: SourceFile, reference: LiteralModule, owner: GrammarConsumer, edgesByStart: Map<number, ImportEdge>): void {
  const { config, grammar, allowed, violations, makeViolation } = scan;
  if (!sameOrUnder(reference.specifier, grammar.package)) return;
  if (grammarReferenceAllowed(reference, sourceFile, owner, edgesByStart, grammar, allowed)) return;
  violations.push(makeViolation(config, sourceFile, reference.node, 'ARCH_GRAMMAR_EXPORT_BYPASS',
    `Product source must import the selected Grammar code entry ${grammar.entry} or style entry ${grammar.styleEntry}; ${reference.specifier} is outside that contract.`,
    { specifier: reference.specifier, package: grammar.package }));
}

function inspectGrammarSource(scan: GrammarScan, sourceFile: SourceFile): void {
  const { context, consumers, installs } = scan;
  if (installs.some(install => isInside(install.packageRoot, sourceFile.fileName))) return;
  const owner = grammarOwner(consumers, sourceFile.fileName);
  if (!owner) return;
  const edgesByStart = sourceEdges(context, sourceFile);
  const references = literalModules(context.ts, sourceFile, context.checkerFor(sourceFile.fileName));
  for (const reference of references) reportGrammarReference(scan, sourceFile, reference, owner, edgesByStart);
}

function addGrammarContractFinding(config: ArchitectureConfig, grammar: GrammarContext, manifestFile: string, problems: string[], violations: ArchitectureViolation[]): void {
  if (!problems.length) return;
  violations.push({
    ruleId: 'ARCH_GRAMMAR_CONTRACT_INVALID',
    path: fs.existsSync(manifestFile) && isInside(config.root, manifestFile) ? relativePath(config.root, manifestFile) : 'package.json',
    line: 1,
    column: 1,
    package: grammar.package,
    message: `Grammar contract is invalid: ${problems.join('; ')}.`,
  });
}

export function checkGrammar(config: ArchitectureConfig, context: TypeContext, makeViolation: MakeViolation): ArchitectureViolation[] {
  const grammar = config.frontend.grammar;
  if (!grammar) return [];
  const violations: ArchitectureViolation[] = [];
  const local = context.workspaces.find(workspace => workspace.name === grammar.package);
  // Node resolution per consumer: in an npm-workspaces monorepo a consumer whose range differs from the
  // hoisted copy gets its own apps/<app>/node_modules/<package> (one consumer: apps/app on 0.5.0 beside a hoisted
  // 0.4.11). Every consumer is judged against the copy it actually resolves, never the hoisted one alone.
  // An app installs once, at its root (config.packageRoot): a side folder has no node_modules of its own.
  const installRoot = installRootFor(config);
  const consumers = grammarConsumers(config, grammar, local, installRoot);
  const installs = uniqueGrammarInstalls(consumers);
  const packageRoot = grammarPackageRoot(installs, local, installRoot, grammar.package);
  const manifestFile = path.join(packageRoot, 'package.json');
  readJson(manifestFile);
  const contractProblems: string[] = [];
  const styleBypasses: ArchitectureViolation[] = [];
  for (const install of installs) addInstallContractProblems(install, installs, grammar, config.root, contractProblems);
  addConsumerDependencyProblems(grammar, consumers, contractProblems);
  addGrammarStyleProblems(config, grammar, contractProblems, styleBypasses);
  addGrammarContractFinding(config, grammar, manifestFile, contractProblems, violations);
  const allowed = new Set([grammar.entry, grammar.styleEntry]);
  violations.push(...styleBypasses);
  const scan: GrammarScan = { config, context, grammar, consumers, installs, allowed, violations, makeViolation };
  for (const sourceFile of context.files) inspectGrammarSource(scan, sourceFile);
  return violations;
}
