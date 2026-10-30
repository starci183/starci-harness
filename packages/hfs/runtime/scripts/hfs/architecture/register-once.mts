import path from 'node:path';
import type { ArrayLiteralExpression, CallExpression, ClassDeclaration, Declaration, Decorator, Expression, Node, PropertyAccessExpression, PropertyAssignment, TypeChecker } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { CheckResult, HfsCheckInput, MachineKit } from './context-map.mjs';
import { isComposeGroup, machineKit } from './machine-ast.mjs';
import { callName } from './jwt-ast.mjs';
import { isTestWorldSlot } from '../test-world-slot.mjs';
import { byCodeUnit } from '../../lib/list.mjs';

/**
 * R45 `register-once` (BE_MODULE_SHAPE), the module graph read from the app roots (owner rule of 2026-09-30, the
 * reference's `CodingModule imports DeviceModule` shape). Each capability has one representative module: the only module
 * of the capability an app registers, once, in `apps/<app>/src/app.module.ts` as `X.register({ isGlobal: true, ... })`, or in a
 * composition group `apps/<app>/src/compose/<area>.ts` the root spreads (an app root here means the root and its groups).
 * It may split itself into sub-modules imported as `imports: [Sub.register({})]`; a sub-module is never in an app and has one
 * importer, its parent. Over every `@Module` class of the program:
 *
 *   - a module in an app root's imports (a `X.register(...)` call or a listed class, helpers of the root included) is
 *     listed once there, is imported by no other module, and, when it is a capability module of src/modules, is registered
 *     with the literal `isGlobal: true` (a bare capability class is not a registration);
 *   - a module imported by a non-app module (as `Sub.register({})`) has exactly one importer and appears in no app root; the one exception is
 *     the feature case: a feature's application module is imported by each protocol module of the same feature;
 *   - `isGlobal: true` appears only in an app root.
 */
export const REGISTER_ONCE_RULE_IDS = ['BE_MODULE_SHAPE'];

const RULE = 'BE_MODULE_SHAPE';
const CAPABILITY_TIERS = new Set(['domain', 'platform', 'integrations']);

/** One `@Module` class of the program. */
interface ModuleInfo {
  name: string;
  file: GraphFile;
  capability: boolean;
}

/** A module a reference points at, with the class declaration that identifies it. */
interface ModuleTarget extends ModuleInfo {
  declaration: Declaration;
}

/** A call `<receiver>.register(...)`. */
interface RegisterCall extends CallExpression {
  expression: PropertyAccessExpression;
}

/** An `imports: [...]` property of a module metadata literal. */
interface ImportsAssignment extends PropertyAssignment {
  initializer: ArrayLiteralExpression;
}

/** One place that imports or registers a module. */
interface ModuleReference {
  file: GraphFile;
  node: Node;
  target: ModuleTarget;
  register: boolean;
  viaImports: boolean;
  importer: ClassDeclaration | string;
  importerOwner: string | null;
  options: Expression | null;
  root: boolean;
}

type ModuleMap = Map<Declaration, ModuleInfo>;
type FileTest = (file: GraphFile) => boolean;
type AppOf = (file: GraphFile) => string | null;
type Reporter = (file: GraphFile, node: Node, message: string, extra?: Record<string, unknown>) => void;

/** What the walk over one file reads and records. */
interface ReferenceScan {
  ts: TypeScriptApi;
  kit: MachineKit;
  modules: ModuleMap;
  file: GraphFile;
  isWorld: FileTest;
  isAppRoot: FileTest;
  report: Reporter;
  references: ModuleReference[];
  checker: TypeChecker;
  seen: Set<Node>;
}

const isRegisterCall = (ts: TypeScriptApi, node: Node): node is RegisterCall => callName(ts, node) === 'register';

function moduleDeclarations(graph: HfsGraph, kit: MachineKit, ts: TypeScriptApi): ModuleMap {
  const modules: ModuleMap = new Map(); // declaration -> {name, file, capability}
  for (const file of graph.files.values()) {
    const checker: TypeChecker = kit.checkerOf(file.sourceFile);
    for (const statement of file.sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      const decorators: readonly Decorator[] = kit.decorators(statement);
      const isModule = decorators.some(decorator => {
        const call = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
        const binding = kit.importBinding(checker, call);
        return binding?.module === '@nestjs/common' && binding.name === 'Module';
      });
      if (isModule) modules.set(statement, { name: statement.name.text, file, capability: CAPABILITY_TIERS.has(file.tier ?? '') });
    }
  }
  return modules;
}

function targetOf(kit: MachineKit, modules: ModuleMap, checker: TypeChecker, node: Node): ModuleTarget | null {
  const declarations: Declaration[] = kit.declarationsOf(checker, node);
  for (const declaration of declarations) {
    const info = modules.get(declaration);
    if (info) return { declaration, ...info };
  }
  return null;
}

function enclosingModule(ts: TypeScriptApi, modules: ModuleMap, node: Node): ClassDeclaration | null {
  for (let current: Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isClassDeclaration(current) && modules.has(current)) return current;
  }
  return null;
}

/** Records the reference an element of an imports list, or a register call, makes to a module. */
function noteReference(scan: ReferenceScan, element: Node, viaImports: boolean): void {
  const { ts, kit, modules, checker, file, seen, references, isAppRoot } = scan;
  if (seen.has(element)) return;
  const call = isRegisterCall(ts, element);
  if (ts.isCallExpression(element) && !call) return;
  const target = targetOf(kit, modules, checker, call ? element.expression.expression : element);
  if (!target) return;
  seen.add(element);
  const owner = enclosingModule(ts, modules, element);
  references.push({ file, node: element, target, register: call, viaImports, importer: owner ?? file.rel, importerOwner: file.owner?.root ?? null,
    options: call ? element.arguments[0] ?? null : null, root: isAppRoot(file) });
}

const isImportsList = (scan: ReferenceScan, node: Node): node is ImportsAssignment => scan.ts.isPropertyAssignment(node) && scan.kit.propertyNameText(node.name) === 'imports' && scan.ts.isArrayLiteralExpression(node.initializer);

const isStrayGlobal = (scan: ReferenceScan, node: Node): boolean => scan.ts.isPropertyAssignment(node) && scan.kit.propertyNameText(node.name) === 'isGlobal'
  && node.initializer.kind === scan.ts.SyntaxKind.TrueKeyword && !scan.isAppRoot(scan.file) && !scan.isWorld(scan.file);

// A composition group's module list is any array of the group: the root spreads it into its imports.
const isGroupList = (scan: ReferenceScan, node: Node): node is ArrayLiteralExpression => scan.ts.isArrayLiteralExpression(node) && isComposeGroup(scan.file.rel);

function visitReferenceNode(scan: ReferenceScan, node: Node): boolean {
  if (isImportsList(scan, node)) {
    for (const element of node.initializer.elements) noteReference(scan, element, true);
  } else if (isGroupList(scan, node)) {
    for (const element of node.elements) noteReference(scan, element, true);
  } else if (callName(scan.ts, node) === 'register' && !scan.seen.has(node)) {
    noteReference(scan, node, false);
  }
  if (isStrayGlobal(scan, node)) {
    scan.report(scan.file, node, '`isGlobal: true` appears only in the app root (apps/<app>/src/app.module.ts or a group of apps/<app>/src/compose/), where the representative module of a capability is registered; a module never decides its own globality.');
  }
  return true;
}

function moduleReferences(graph: HfsGraph, kit: MachineKit, ts: TypeScriptApi, modules: ModuleMap, isWorld: FileTest, isAppRoot: FileTest, report: Reporter): ModuleReference[] {
  // The references to modules: importer (the enclosing module class, else the file), target, node, whether it is a register call.
  const references: ModuleReference[] = [];
  for (const file of graph.files.values()) {
    if (isWorld(file)) continue; // the test composition root assembles modules; it is not a module importer
    const scan: ReferenceScan = { ts, kit, modules, file, isWorld, isAppRoot, report, references, checker: kit.checkerOf(file.sourceFile), seen: new Set() };
    kit.walk(file.sourceFile, (node: Node) => visitReferenceNode(scan, node));
  }
  return references;
}

function isTrueGlobal(kit: MachineKit, ts: TypeScriptApi, options: Expression | null): boolean {
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  const property = kit.propertyOf(options, 'isGlobal');
  return property !== undefined && ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword;
}

function appRegistrations(rootReferences: ModuleReference[], appOf: AppOf): Map<Declaration, Set<string>> {
  const inApps = new Map<Declaration, Set<string>>(); // module declaration -> Set(app names)
  for (const item of rootReferences) {
    const app = appOf(item.file) ?? item.file.rel;
    let apps = inApps.get(item.target.declaration);
    if (!apps) {
      apps = new Set();
      inApps.set(item.target.declaration, apps);
    }
    apps.add(app);
  }
  return inApps;
}

function reportDuplicateAppModules(config: ArchitectureConfig, rootReferences: ModuleReference[], appOf: AppOf, report: Reporter): void {
  for (const app of config.apps) {
    const seenInApp = new Map<Declaration, Node>();
    for (const item of rootReferences.filter(entry => appOf(entry.file) === app.name)) {
      if (seenInApp.has(item.target.declaration)) {
        report(item.file, item.node, `${item.target.name} is registered more than once in the root of app ${app.name}; a module is listed once per app.`, { module: item.target.name, app: app.name });
      } else seenInApp.set(item.target.declaration, item.node);
    }
  }
}

function reportCapabilityRegistrations(rootReferences: ModuleReference[], kit: MachineKit, ts: TypeScriptApi, report: Reporter): void {
  for (const item of rootReferences) {
    if (!item.target.capability || !item.viaImports && !item.register) continue;
    if (!item.register) report(item.file, item.node, `${item.target.name} is listed in imports as a bare class; the representative module of a capability is registered in the app root as ${item.target.name}.register({ isGlobal: true, ...options }).`, { module: item.target.name });
    else if (!isTrueGlobal(kit, ts, item.options)) report(item.file, item.node, `${item.target.name} is registered in the app root without the literal \`isGlobal: true\`; write ${item.target.name}.register({ isGlobal: true, ...options }).`, { module: item.target.name });
  }
}

/** The references that import a module from a non-app module, grouped by the imported module declaration. */
function importersByModule(references: ModuleReference[]): Map<Declaration, ModuleReference[]> {
  const importersOf = new Map<Declaration, ModuleReference[]>(); // module declaration -> [reference]
  for (const item of references.filter(entry => !entry.root && entry.viaImports)) {
    let importers = importersOf.get(item.target.declaration);
    if (!importers) {
      importers = [];
      importersOf.set(item.target.declaration, importers);
    }
    importers.push(item);
  }
  return importersOf;
}

function reportSharedSubModule(target: ModuleInfo, list: ModuleReference[], report: Reporter): void {
  const distinct = [...new Set(list.map(item => item.importer))];
  const featureCase = target.file.tier === 'feature' && target.file.owner && list.every(item => item.importerOwner === target.file.owner.root);
  if (distinct.length <= 1 || featureCase) return;
  for (const item of list.filter(entry => entry.importer !== list[0]?.importer)) {
    report(item.file, item.node, `${target.name} is imported by ${distinct.length} modules; a sub-module has exactly one importer, its parent. Another capability's module is consumed through its Inject*() decorators, never imported.`, { module: target.name });
  }
}

function reportNonAppImporters(references: ModuleReference[], modules: ModuleMap, inApps: Map<Declaration, Set<string>>, report: Reporter): void {
  // Non-app importers: no importer of an app-registered module, exactly one importer otherwise (the feature case excepted).
  for (const [declaration, list] of importersByModule(references)) {
    const target = modules.get(declaration);
    if (!target) continue;
    const apps = inApps.get(declaration);
    if (!apps) {
      reportSharedSubModule(target, list, report);
      continue;
    }
    for (const item of list) {
      report(item.file, item.node, `${target.name} is registered in the root of app ${[...apps].sort(byCodeUnit).join(', ')}, so no other module imports it; consume it through its Inject*() decorators.`, { module: target.name });
    }
  }
}

export function checkRegisterOnce(input: HfsCheckInput): CheckResult {
  const { config, graph } = input;
  const kit = machineKit(input);
  const { ts } = kit;
  const violations: ArchitectureViolation[] = [];
  const report: Reporter = (file, node, message, extra = {}) => { violations.push({ ruleId: RULE, path: file.rel, ...kit.at(file.rel, file.sourceFile, node), message, ...extra }); };
  const isAppRoot: FileTest = file => Boolean(file.slot?.startsWith('be.app.')) && (path.posix.basename(file.rel) === 'app.module.ts' || isComposeGroup(file.rel));
  // The test world (slot be.tests.world) is the test composition root: useTestWorld registers capability modules with
  // `isGlobal: true` the way an app root does. A spec (integration, contract, e2e) is not a composition root.
  const isWorld: FileTest = file => isTestWorldSlot(file.slot);
  const appOf: AppOf = file => config.apps.find(app => file.rel === `apps/${app.name}/src/app.module.ts`
    || (isComposeGroup(file.rel) && file.rel.startsWith(`apps/${app.name}/src/compose/`)))?.name ?? null;
  const modules = moduleDeclarations(graph, kit, ts);
  const references = moduleReferences(graph, kit, ts, modules, isWorld, isAppRoot, report);
  const rootReferences = references.filter(item => item.root);
  const inApps = appRegistrations(rootReferences, appOf);

  // App roots: each module is listed once, capability modules are registered with isGlobal true.
  reportDuplicateAppModules(config, rootReferences, appOf, report);
  reportCapabilityRegistrations(rootReferences, kit, ts, report);
  reportNonAppImporters(references, modules, inApps, report);

  return { violations, coverage: { status: 'checked', apps: config.apps.filter(app => kit.appRoot(app.name)).length, modules: modules.size,
    capabilityModules: [...modules.values()].filter(item => item.capability).length, registrations: references.filter(item => item.register).length,
    rootImports: rootReferences.length } };
}
