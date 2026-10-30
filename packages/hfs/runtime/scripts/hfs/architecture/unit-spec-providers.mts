import fs from 'node:fs';
import path from 'node:path';
import type { ArrayLiteralExpression, CallExpression, ClassDeclaration, Identifier, Node, SourceFile } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, GraphFile, HfsGraph } from './hfs-graph.mjs';
import { machineKit } from './machine-ast.mjs';
import type { MachineContext, MachineKit } from './machine-ast.mjs';
import { constructorDependencies } from './constructor-deps.mjs';
import { treeOf } from './required-files.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { importsOf } from '../../lib/ts-analysis.mjs';
import { checkFunctionSubject, functionSubjectExports, keyOf as literalKey, valueObjectSubjects } from './function-spec-providers.mjs';

/**
 * R48 `unit-spec-providers` (BE_SPEC_QUALITY), the unit test standard's rule 3: the unit spec of a service builds its
 * subject with `Test.createTestingModule({ providers: [...] })`, and that providers array EQUALS the constructor
 * dependencies of the service under test: the service class first, then one provider for each constructor parameter.
 *
 * The service under test is the sibling `<name>.service.ts` of every `<name>.service.spec.ts` under src/ or apps/ (a spec is
 * outside the production program, so it is read from disk). A parameter decorated with a custom `Inject<Thing>()` provides
 * the token that decorator's `injector<T>(TOKEN)` names; an undecorated parameter of a class type provides that class (see
 * constructor-deps.mjs). Providers are matched by the exported name of the imported binding (`import { CACHE as C }` is
 * CACHE), never by text. A provider is a class, or `{ provide: TOKEN, useValue: double }` and nothing else. A sibling
 * containing only exported functions instead provides its complete real function object and exercises it through module.get;
 * the constants, enums, re-exports and overload signatures beside those functions do not count. A value-object subject (an
 * undecorated class whose constructor parameters carry no injection token) is built with `new`, Nest never constructs it.
 *
 * Findings: an extra provider, a missing provider, a service that is not the first provider, a dependency whose token cannot
 * be resolved, a spec with no createTestingModule providers array, and a provider that is neither a class nor
 * `{ provide, useValue }`. Which double a `useValue` is, and whether other specs exist at all, are other rules' business.
 */
export const UNIT_SPEC_PROVIDERS_RULE_IDS = ['BE_SPEC_QUALITY'];

const RULE = 'BE_SPEC_QUALITY';
const SPEC_ROOT = /^(?:src|apps)\//u;

/** Records one finding on a node of the spec. */
type Report = (node: Node, message: string) => void;

/** An import binding of the spec: the imported name and its module specifier. */
interface ImportRecord {
  name: string;
  module: string;
}

/** One entry of the providers array: the token name, its node and whether it is a bare class. */
interface ProvidedItem {
  name: string;
  node: Node;
  isClass: boolean;
}

/** The service class under test and the import that names it. */
interface ServiceUnderTest {
  serviceClass: ClassDeclaration;
  serviceName: ImportRecord;
}

/** The `Test.createTestingModule(...)` calls of a spec. */
function testingModules(ts: TypeScriptApi, sourceFile: SourceFile): CallExpression[] {
  const calls: CallExpression[] = [];
  const visit = (node: Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createTestingModule') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}


function providerList(ts: TypeScriptApi, call: CallExpression, rel: string, report: Report): ArrayLiteralExpression | null {
  const options = call.arguments[0];
  const property = options && ts.isObjectLiteralExpression(options) ? options.properties.find(item => literalKey(ts, item) === 'providers') : null;
  const list = property && ts.isPropertyAssignment(property) && ts.isArrayLiteralExpression(property.initializer) ? property.initializer : null;
  if (!list) report(call, `${rel}: Test.createTestingModule has no literal \`providers\` array; list the service and each constructor dependency there.`);
  return list;
}

function readProviders(ts: TypeScriptApi, list: ArrayLiteralExpression, rel: string, nameOf: (identifier: Identifier) => string, report: Report): { provided: ProvidedItem[]; readable: boolean } {
  const provided: ProvidedItem[] = [];
  let readable = true;
  for (const element of list.elements) {
    if (ts.isIdentifier(element)) { provided.push({ name: nameOf(element), node: element, isClass: true }); continue; }
    if (ts.isObjectLiteralExpression(element)) {
      const keys = element.properties.map(item => literalKey(ts, item));
      const provide = element.properties.find(item => literalKey(ts, item) === 'provide');
      const value = provide && ts.isPropertyAssignment(provide) ? provide.initializer : null;
      if (keys.length === 2 && keys.includes('useValue') && value && ts.isIdentifier(value)) { provided.push({ name: nameOf(value), node: element, isClass: false }); continue; }
    }
    readable = false;
    report(element, `${rel}: a provider is a class or \`{ provide: TOKEN, useValue: double }\` and nothing else (no useClass, useFactory, useExisting, spread or computed token).`);
  }
  return { provided, readable };
}

function serviceClassFor(ts: TypeScriptApi, rel: string, serviceRel: string, serviceFile: GraphFile, imports: Map<string, ImportRecord>, list: ArrayLiteralExpression, report: Report): ServiceUnderTest | null {
  const first = list.elements[0];
  const serviceName = first && ts.isIdentifier(first) ? imports.get(first.text) : null;
  const target = serviceName ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), serviceName.module)).replace(/\.[cm]?[jt]s$/u, '') : null;
  const serviceClass = serviceName && target === serviceRel.replace(/\.ts$/u, '')
    ? serviceFile.sourceFile.statements.find((statement): statement is ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === serviceName.name) : null;
  if (!serviceClass) report(first ?? list, `${rel}: the first provider is the service under test, imported from ./${path.posix.basename(serviceRel, '.ts')}.`);
  return serviceClass ? { serviceClass, serviceName: serviceName as ImportRecord } : null; // a class is found only when the service name resolved
}

function checkDependencies(kit: MachineKit, rel: string, service: ServiceUnderTest, serviceFile: GraphFile, list: ArrayLiteralExpression, provided: ProvidedItem[], report: Report): void {
  const { serviceName, serviceClass } = service;
  const dependencies = constructorDependencies(kit, serviceFile, serviceClass);
  const expected: string[] = [];
  for (const dependency of dependencies) {
    if (dependency.kind === 'unresolved') {
      report(list, `${rel}: a constructor dependency of ${serviceName.name} cannot be resolved to a token (${dependency.reason}), so its provider cannot be checked; inject it through an exported Inject<Thing>() decorator or a class type.`);
      continue;
    }
    expected.push(dependency.name);
  }
  const remaining = [...expected];
  for (const item of provided.slice(1)) {
    const index = remaining.indexOf(item.name);
    if (index === -1) report(item.node, `${rel}: ${item.name} is provided but is not a constructor dependency of ${serviceName.name}; a unit spec provides exactly what the constructor needs.`);
    else remaining.splice(index, 1);
  }
  for (const name of remaining) report(list, `${rel}: ${name} is a constructor dependency of ${serviceName.name} but is not provided; add \`{ provide: ${name}, useValue: double }\` (or the class itself) to the providers.`);
}

interface TestingModuleInput {
  ts: TypeScriptApi;
  kit: MachineKit;
  rel: string;
  serviceRel: string;
  serviceFile: GraphFile;
  imports: Map<string, ImportRecord>;
  call: CallExpression;
  report: Report;
}

function checkTestingModule({ ts, kit, rel, serviceRel, serviceFile, imports, call, report }: TestingModuleInput): void {
  const list = providerList(ts, call, rel, report);
  if (!list) return;
  const names = functionSubjectExports(ts, serviceFile.sourceFile);
  if (names) { checkFunctionSubject({ ts, rel, serviceRel, imports, call, list, names, report }); return; }
  const nameOf = (identifier: Identifier): string => imports.get(identifier.text)?.name ?? identifier.text;
  const { provided, readable } = readProviders(ts, list, rel, nameOf, report);
  if (!readable) return;
  const service = serviceClassFor(ts, rel, serviceRel, serviceFile, imports, list, report);
  if (!service) return;
  checkDependencies(kit, rel, service, serviceFile, list, provided, report);
}

function checkServiceSpec({ config, graph, kit, ts, rel, violations }: { config: ArchitectureConfig; graph: HfsGraph; kit: MachineKit; ts: TypeScriptApi; rel: string; violations: ArchitectureViolation[] }): boolean {
  const abs = path.join(config.root, ...rel.split('/'));
  if (!fs.existsSync(abs)) return false;
  const sourceFile = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
  const report: Report = (node, message) => { violations.push({ ruleId: RULE, path: rel, ...kit.at(rel, sourceFile, node), message }); };
  const imports = importsOf(ts, sourceFile);
  const serviceRel = rel.replace(/\.spec\.ts$/u, '.ts');
  const serviceFile = graph.files.get(serviceRel);
  if (!serviceFile) { report(sourceFile, `${rel} has no ${path.posix.basename(serviceRel)} beside it; a service spec sits next to the service it tests.`); return true; }
  const modules = testingModules(ts, sourceFile);
  if (!modules.length && valueObjectSubjects(ts, serviceFile.sourceFile)) return true;
  if (!modules.length) { report(sourceFile, `${rel} never calls Test.createTestingModule({ providers: [...] }); build the service from a testing module holding exactly its constructor dependencies.`); return true; }
  for (const call of modules) checkTestingModule({ ts, kit, rel, serviceRel, serviceFile, imports, call, report });
  return true;
}

export function checkUnitSpecProviders(input: { config: ArchitectureConfig; context: MachineContext; graph: HfsGraph }): { violations: ArchitectureViolation[]; coverage: { status: string; specs: number; files: number } } {
  const { config, graph } = input;
  const kit = machineKit(input);
  const { ts } = kit;
  const violations: ArchitectureViolation[] = [];
  let specs = 0;
  const tree = treeOf(config.root);
  for (const rel of [...tree.files].filter(file => SPEC_ROOT.test(file) && file.endsWith('.service.spec.ts')).sort(byCodeUnit)) {
    if (checkServiceSpec({ config, graph, kit, ts, rel, violations })) specs += 1;
  }
  return { violations, coverage: { status: 'checked', specs, files: graph.files.size } };
}
