import path from 'node:path';
import type { ClassDeclaration, Declaration, Identifier, Node, TypeChecker } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, GraphFile, HfsGraph } from './hfs-graph.mjs';
import { isComposeGroup, machineKit } from './machine-ast.mjs';
import type { MachineContext, MachineKit } from './machine-ast.mjs';
import { treeOf } from './required-files.mjs';
import type { AppRef } from '../slots.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { trimTrailingSlashes } from '../trailing-slashes.mjs';

/**
 * R45 `module-per-transport` (BE_MODULE_SHAPE, BE-CONVENTION 1.2 and 1.6). A feature has one Nest module for its
 * application (`<f>.module.ts` at the feature root) and exactly one module per transport folder
 * (`transport/<protocol>/<f>-<protocol>.module.ts`). Never one module per operation. Every one of these modules has its own
 * module-definition beside it (owner ruling module-definition-everywhere, R295):
 *
 *   - a `*.module.ts` file below a transport folder other than `<f>-<protocol>.module.ts`, a `*.module-definition.ts` that is
 *     not the sibling of the application module or of the transport module of its own folder, and an `@Module` class (or a
 *     `ConfigurableModuleBuilder`/`ConfigurableModuleClass` use) in a feature file that is neither the application module, the
 *     transport module of its own folder nor that module's definition are refused;
 *   - apps import only transport modules, of the kinds their app kind allows: the `composedBy` list of each transport slot
 *     in knowledge/hfs/slots.yaml (api: graphql, http, websocket; worker: schedule, message). An app root (app.module.ts
 *     or a composition group of its compose/ folder) that lists a feature's application module, or the transport module
 *     of another kind, is refused;
 *   - a composed root (an owner slot with `composedBy`, be.cli) holds one static module per folder, named after the folder
 *     (cli.module.ts, <group>/<group>.module.ts); an app of a composing kind lists the root module only, and an app of any
 *     other kind lists none of its modules.
 */
export const MODULE_PER_TRANSPORT_RULE_IDS = ['BE_MODULE_SHAPE'];

const RULE = 'BE_MODULE_SHAPE';

type Resolver = HfsGraph['resolver'];

/** A slot that composes its folders into one root module (be.cli). */
interface ComposedSlot {
  composedBy: string[];
}

/** Where a feature file sits: its owner root, feature name, transport protocol (or null), the path below the owner and the composing slot (or null). */
interface ModulePlace {
  root: string;
  feature: string;
  protocol: string | null;
  below: string[];
  composed: ComposedSlot | null;
}

/** A declared app: its name and kind. */
type AppRecord = AppRef;

/** A Nest module class found in the program and the file that declares it. */
interface ModuleInfo {
  name: string;
  file: GraphFile;
}

type PlaceOf = (rel: string) => ModulePlace | null;
type ComposedModuleOf = (rel: string) => string;
type ReportAt = (file: GraphFile, node: Node, message: string, extra?: Record<string, unknown>) => void;
type ReportPlain = (rel: string, message: string, extra?: Record<string, unknown>) => void;

/** What the module scans share. */
interface ModuleScan {
  graph: HfsGraph;
  kit: MachineKit;
  ts: TypeScriptApi;
  moduleMap: Map<Declaration, ModuleInfo>;
  placeOf: PlaceOf;
  composedBy: Map<string, string[]>;
  report: ReportAt;
}

function featureOwnerOf(resolver: Resolver, rel: string) {
  const owner = resolver.ownerOf(rel);
  return owner && resolver.slot(owner.slot)?.tier === 'feature' ? owner : null;
}

function modulePlaceOf(resolver: Resolver, rel: string): ModulePlace | null {
  const owner = featureOwnerOf(resolver, rel);
  if (!owner) return null;
  const composedBy = resolver.slot(owner.slot)?.composedBy;
  const below = rel.slice(owner.root.length + 1).split('/');
  const feature = path.posix.basename(owner.root);
  if (composedBy) return { root: owner.root, feature, protocol: null, below, composed: { composedBy } };
  return { root: owner.root, feature, protocol: below[0] === 'transport' && below.length > 2 ? below[1] ?? null : null, below, composed: null };
}

function composedModulePath(rel: string): string {
  const dir = path.posix.dirname(rel);
  return `${dir}/${path.posix.basename(dir)}.module.ts`;
}

function composedByProtocol(resolver: Resolver): Map<string, string[]> {
  const composedBy = new Map<string, string[]>();
  for (const slot of resolver.slots()) {
    if (!slot.composedBy || slot.owner) continue;
    composedBy.set(path.posix.basename(trimTrailingSlashes(slot.path)), slot.composedBy);
  }
  return composedBy;
}

/** The module a feature file may declare: the application module, the transport module of its folder, or a cli folder's module. */
function ownModuleOf(place: ModulePlace, rel: string, composedModuleOf: ComposedModuleOf): string {
  if (place.composed) return composedModuleOf(rel);
  return place.protocol === null
    ? `${place.root}/${place.feature}.module.ts`
    : `${place.root}/transport/${place.protocol}/${place.feature}-${place.protocol}.module.ts`;
}

const DEFINITION_FILE = /\.module-definition\.[cm]?tsx?$/u;
const definitionOf = (modulePath: string): string => modulePath.replace(/\.module\.([cm]?tsx?)$/u, '.module-definition.$1');

function reportTransportFileShapes(tree: { files: Iterable<string> }, placeOf: PlaceOf, plain: ReportPlain, composedModuleOf: ComposedModuleOf): number {
  let transportModules = 0;
  for (const rel of [...tree.files].sort(byCodeUnit)) {
    const place = placeOf(rel);
    if (!place) continue;
    const base = path.posix.basename(rel);
    if (DEFINITION_FILE.test(base) && rel !== definitionOf(ownModuleOf(place, rel, composedModuleOf))) plain(rel, `${rel} is a module-definition that is not beside a module of feature ${place.feature}; the definition of a module is its sibling ${path.posix.basename(definitionOf(ownModuleOf(place, rel, composedModuleOf)))}, one per application module, transport module or cli folder.`, { feature: place.feature });
    if (place.protocol && /\.module\.[cm]?tsx?$/u.test(base)) {
      const expected = `${place.feature}-${place.protocol}.module.ts`;
      if (place.below.length !== 3 || base !== expected) plain(rel, `${rel} is a second module of the ${place.protocol} transport of ${place.feature}; a transport folder has exactly one module, transport/${place.protocol}/${expected}, never one module per operation. List the operation's providers in that module and delete this file.`, { feature: place.feature, protocol: place.protocol });
      else transportModules += 1;
    }
  }
  return transportModules;
}

function isNestModuleClass(ts: TypeScriptApi, kit: MachineKit, checker: TypeChecker, statement: ClassDeclaration): boolean {
  return kit.decorators(statement).some(decorator => {
    const call = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
    return kit.isImportOf(checker, call, 'Module', '@nestjs/common');
  });
}

function reportModuleClassLocation(file: GraphFile, name: Identifier, place: ModulePlace, composedModuleOf: ComposedModuleOf, report: ReportAt): void {
  if (place.composed) {
    const own = composedModuleOf(file.rel);
    if (file.rel !== own) report(file, name, `${name.text} is a Nest module declared in ${file.rel}; every folder of ${place.root} holds exactly one static module named after it (${own}), never a module per command.`, { feature: place.feature });
    return;
  }
  const own = place.protocol === null
    ? `${place.root}/${place.feature}.module.ts`
    : `${place.root}/transport/${place.protocol}/${place.feature}-${place.protocol}.module.ts`;
  if (file.rel !== own) report(file, name, `${name.text} is a Nest module declared in ${file.rel}; a feature declares exactly its application module (${place.feature}.module.ts) and one module per transport folder (${place.feature}-<protocol>.module.ts), never a module per operation.`, { feature: place.feature });
}

function reportConfigurableModuleUses(file: GraphFile, checker: TypeChecker, kit: MachineKit, ts: TypeScriptApi, place: ModulePlace, env: { composedModuleOf: ComposedModuleOf; report: ReportAt }): void {
  const own = ownModuleOf(place, file.rel, env.composedModuleOf);
  const isDefinition = file.rel === definitionOf(own);
  kit.walk(file.sourceFile, node => {
    if (ts.isNewExpression(node) && kit.isImportOf(checker, node.expression, 'ConfigurableModuleBuilder', '@nestjs/common') && !isDefinition) {
      env.report(file, node, `ConfigurableModuleBuilder builds the module definition of one module; in feature ${place.feature} it is written only in ${path.posix.basename(definitionOf(own))}, beside ${path.posix.basename(own)}.`, { feature: place.feature });
    } else if (ts.isHeritageClause(node) && file.rel !== own) {
      for (const type of node.types) if (kit.isImportOf(checker, type.expression, 'ConfigurableModuleClass', '@nestjs/common')) {
        env.report(file, type, `ConfigurableModuleClass is extended by the module of its own definition only (${path.posix.basename(own)}); feature ${place.feature} declares no other configurable module.`, { feature: place.feature });
      }
    }
    return true;
  });
}

function moduleClassesInFile(file: GraphFile, checker: TypeChecker, place: ModulePlace | null, modules: Map<Declaration, ModuleInfo>, env: { kit: MachineKit; ts: TypeScriptApi; composedModuleOf: ComposedModuleOf; report: ReportAt }): void {
  const { kit, ts, composedModuleOf, report } = env;
  for (const statement of file.sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;
    if (!isNestModuleClass(ts, kit, checker, statement)) continue;
    modules.set(statement, { name: statement.name.text, file });
    if (place) reportModuleClassLocation(file, statement.name, place, composedModuleOf, report);
  }
}

function collectFeatureModules(graph: HfsGraph, kit: MachineKit, ts: TypeScriptApi, placeOf: PlaceOf, composedModuleOf: ComposedModuleOf, report: ReportAt): Map<Declaration, ModuleInfo> {
  const modules = new Map<Declaration, ModuleInfo>(); // class declaration -> {name, file}
  const env = { kit, ts, composedModuleOf, report };
  for (const file of graph.files.values()) {
    const checker = kit.checkerOf(file.sourceFile);
    const place = placeOf(file.rel);
    moduleClassesInFile(file, checker, place, modules, env);
    if (place) reportConfigurableModuleUses(file, checker, kit, ts, place, env);
  }
  return modules;
}

function reportModuleReference(root: GraphFile, node: Node, app: AppRecord, module: ModuleInfo, place: ModulePlace, composedBy: Map<string, string[]>, report: ReportAt): void {
  if (place.composed) {
    const rootModule = `${place.root}/${place.feature}.module.ts`;
    if (!place.composed.composedBy.includes(app.kind)) report(root, node, `App ${app.name} is of kind ${app.kind} and lists ${module.name} from ${place.root}; only an app of kind ${place.composed.composedBy.join(', ')} composes that root.`, { app: app.name, module: module.name });
    else if (module.file.rel !== rootModule) report(root, node, `App ${app.name} lists ${module.name}, a group module inside ${place.root}; the app lists the root module (${rootModule}), which imports every group module.`, { app: app.name, module: module.name });
  } else if (place.protocol === null) {
    report(root, node, `App ${app.name} lists ${module.name}, the application module of feature ${place.feature}; apps import only transport modules (${place.feature}-<protocol>.module.ts), which import the application module themselves.`, { app: app.name, module: module.name });
  } else if (!(composedBy.get(place.protocol) ?? []).includes(app.kind)) {
    const allowed = [...composedBy].filter(([, kinds]) => kinds.includes(app.kind)).map(([protocol]) => protocol).sort(byCodeUnit);
    const transports = allowed.length ? `${allowed.join(', ')} transports only` : 'no transport module';
    report(root, node, `App ${app.name} is of kind ${app.kind} and lists ${module.name}, a ${place.protocol} transport module; an app of kind ${app.kind} composes ${transports}.`, { app: app.name, module: module.name, protocol: place.protocol });
  }
}

function inspectModuleDeclarations(checker: TypeChecker, target: Node, node: Node, root: GraphFile, app: AppRecord, scan: ModuleScan, seen: Set<Node>): number {
  const { moduleMap, kit, placeOf, composedBy, report } = scan;
  let references = 0;
  for (const declaration of kit.declarationsOf(checker, target)) {
    const module = moduleMap.get(declaration);
    if (!module) continue;
    const place = placeOf(module.file.rel);
    if (!place || seen.has(node)) continue;
    seen.add(node);
    references += 1;
    reportModuleReference(root, node, app, module, place, composedBy, report);
  }
  return references;
}

/** The module references of one composition file: the root's `imports` lists, or every array of a composition group (its module list). */
function inspectCompositionFile(file: GraphFile, app: AppRecord, scan: ModuleScan, seen: Set<Node>): number {
  const { kit, ts } = scan;
  const checker = kit.checkerOf(file.sourceFile);
  const group = isComposeGroup(file.rel);
  let references = 0;
  const judge = (node: Node): void => {
    const call = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register';
    if (ts.isCallExpression(node) && !call) return;
    const target = call ? node.expression.expression : node;
    references += inspectModuleDeclarations(checker, target, node, file, app, scan, seen);
  };
  kit.walk(file.sourceFile, node => {
    if (ts.isPropertyAssignment(node) && kit.propertyNameText(node.name) === 'imports' && ts.isArrayLiteralExpression(node.initializer)) {
      for (const element of node.initializer.elements) judge(element);
    } else if (group && ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) judge(element);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register') judge(node);
    return true;
  });
  return references;
}

/** The module references of an app: its root `apps/<app>/src/app.module.ts` and the composition groups of `compose/` it spreads. */
function inspectAppRoot(app: AppRecord, scan: ModuleScan): number {
  const seen = new Set<Node>();
  let references = 0;
  for (const file of scan.kit.appCompositionFiles(app.name)) references += inspectCompositionFile(file, app, scan, seen);
  return references;
}

function appModuleReferences(apps: readonly AppRecord[], scan: ModuleScan): number {
  let references = 0;
  for (const app of apps) references += inspectAppRoot(app, scan);
  return references;
}

export function checkModulePerTransport(input: { config: ArchitectureConfig; context: MachineContext; graph: HfsGraph }): { violations: ArchitectureViolation[]; coverage: { status: string; modules: number; transportModules: number; appReferences: number } } {
  const { config, graph } = input;
  const kit = machineKit(input);
  const { ts, resolver } = kit;
  const violations: ArchitectureViolation[] = [];
  const report: ReportAt = (file, node, message, extra = {}) => violations.push({ ruleId: RULE, path: file.rel, ...kit.at(file.rel, file.sourceFile, node), message, ...extra });
  const plain: ReportPlain = (rel, message, extra = {}) => violations.push({ ruleId: RULE, path: rel, line: 1, column: 1, message, ...extra });

  const placeOf: PlaceOf = rel => modulePlaceOf(resolver, rel);
  const composedModuleOf = composedModulePath;

  const composedBy = composedByProtocol(resolver);

  const tree = treeOf(config.root);
  const transportModules = reportTransportFileShapes(tree, placeOf, plain, composedModuleOf);

  const modules = collectFeatureModules(graph, kit, ts, placeOf, composedModuleOf, report);

  const references = appModuleReferences(resolver.repo.apps, { graph, kit, ts, moduleMap: modules, placeOf, composedBy, report });
  return { violations, coverage: { status: 'checked', modules: modules.size, transportModules, appReferences: references } };
}
