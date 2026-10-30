import { checkerScope } from './required-files.mjs';
import { allowsFile } from '../allows.mjs';
import { locateDeclaration } from '../slots.mjs';
import { DEFAULT_ENVIRONMENT, STACKS_DIRECTORY, STATEFUL_KINDS, namesOfService, readStack } from '../../lib/stack-services.mjs';
import { unwrapEach } from './ast-walks.mjs';
import { hasAnyFlag, nameText, sourceLocation } from '../../lib/ts-ast.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import type { Expression, Node, ObjectLiteralElementLike, ObjectLiteralExpression, PropertyAssignment, SourceFile, VariableStatement } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { CheckInput, GraphFile, HfsGraph } from './hfs-graph.mjs';

/** A service of the repository's own stack definition, as `readStack` reads it (a parsed `.starcistacks` document). */
interface StackService {
  name: string;
  kind: string;
  role: string;
  image?: string;
  persistent?: boolean;
  environment?: string;
}

/** A key of the declaration's `fakes` object literal, with its position. */
interface FakeEntry {
  name: string;
  line: number;
  column: number;
}

/** A `stacks` entry that declares `fakedBy`. */
interface FakedByEntry {
  service: string;
  fake: string;
  reason: string;
  line: number;
  column: number;
}

/** A fake the world runs: a `fakes/<provider>/` folder or a `fakes` entry of the declaration. */
interface WorldFake {
  name: string;
  path: string | null;
  line: number;
  column: number;
  what: string;
}

/** A finding of this check; `path` is null only when the world has no declaration file to point at. */
interface WorldViolation {
  ruleId: string;
  path: string | null;
  line: number;
  column: number;
  slot: string;
  message: string;
}

type FakeProviders = Map<string, string>;

/**
 * R47 `test-world-files` (BE_TEST_TOPOLOGY). Judgements over the test world, read through slots, the repository's own
 * stack definition (`.starcistacks/<env>`, scripts/lib/stack-services.mjs) and the world's declaration
 * (`test-world.config.ts`, read in the shape @starci/test-world defines), never through a path or a name list:
 *
 * 1. Files. `src/tests/world/` is the only test infrastructure location, and it holds only what its slot `allows`
 *    (knowledge/hfs/slots.yaml be.tests.world: global-setup.ts, global-teardown.ts, use-test-world.ts, and fakes/; kit/ is
 *    its own slot, be.tests.world.kit) plus files at its root whose role suffix is in ruleParams.be.suffixes
 *    (`stripe.client.ts`, `checkout.contracts.ts`, `test-world.config.ts`, ...). Every tracked file below the world root is
 *    matched by the slot's own entries through `allowsFile`.
 * 2. The declaration. `test-world.config.ts` declares the world in ONE form, the named export R89 allows:
 *    `export const { useTestWorld, useSandbox } = defineTestWorld({ ... })` (an exported `const` initialized by a
 *    `defineTestWorld(<object literal>)` call). A config without it (a default export, or a declaration the machine cannot
 *    read) is refused: the world it declares could not be judged.
 * 3. Fakes against the stack (owner refinement 2026-09-30). Every service the stack declares runs real in the world; a fake
 *    (a `fakes/<provider>/` folder, or a `fakes` entry of the declaration such as `smtp: smtpFake()`) is a network-edge fake
 *    of an external SaaS the team does not operate. A fake of a stack service (its own name, its image repository or a
 *    well-known alias of the image) is refused, except the one owner-approved exception: a stack service that is stateless
 *    compute needing special hardware or an external model (GPU inference, a self-hosted embedding model) whose `stacks` entry
 *    declares it faked: `stacks: { "<stack service>": { fakedBy: "<fake>", reason: "<non-empty>" } }`. A stack service of a
 *    stateful kind (database, cache, identity, storage, mail, queue, search) or with a persistent volume is never accepted, and
 *    an entry that names a stack service or a fake (a `fakes` entry or a `fakes/` folder) that does not exist, or has no
 *    reason, is refused as stale or empty. The declaration's `stack` (`".starcistacks/<env>"`) names the stack environment the
 *    world runs (default `dev`); the machine reads the literal object of the declaration through the TypeScript AST and
 *    nothing else of it.
 */
export const TEST_WORLD_FILES_RULE_IDS = ['BE_TEST_TOPOLOGY'];

const RULE = 'BE_TEST_TOPOLOGY';
const WORLD_SLOT = 'be.tests.world';
const FAKES_DIRECTORY = 'fakes/';
const CONFIG_FILE = 'test-world.config.ts';
const DEFINE = 'defineTestWorld';
const NAMED_FORM = `export const { useTestWorld, useSandbox } = ${DEFINE}({ ... })`;
const defaultEnvironment = DEFAULT_ENVIRONMENT;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const unwrap = (ts: TypeScriptApi, node: Node): Node | null | undefined => unwrapEach(ts, node, [ts.isParenthesizedExpression, ts.isAsExpression, ts.isSatisfiesExpression]);
const propertyOf = (ts: TypeScriptApi, literal: ObjectLiteralExpression, key: string): Expression | null => literal.properties.find((property: ObjectLiteralElementLike): property is PropertyAssignment => ts.isPropertyAssignment(property) && nameText(ts, property.name) === key)?.initializer ?? null;
const isExported = (ts: TypeScriptApi, statement: VariableStatement): boolean => (statement.modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** The object literal of `defineTestWorld(<object literal>)`, or null. */
function defineLiteral(ts: TypeScriptApi, expression: Expression): ObjectLiteralExpression | null {
  const call = unwrap(ts, expression);
  if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== DEFINE) return null;
  const [first] = call.arguments;
  const literal = first ? unwrap(ts, first) : null;
  return literal && ts.isObjectLiteralExpression(literal) ? literal : null;
}

/** The declaration of the world: the object literal of an exported `const` initialized by `defineTestWorld({ ... })`, or null. */
function configLiteral(ts: TypeScriptApi, sourceFile: SourceFile): ObjectLiteralExpression | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(ts, statement)) continue;
    if (!hasAnyFlag(statement.declarationList.flags, ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const literal = declaration.initializer ? defineLiteral(ts, declaration.initializer) : null;
      if (literal) return literal;
    }
  }
  return null;
}

/** `stack` as the environment it names: the last segment of `".starcistacks/<env>"`; null when absent or not a literal. */
function environmentOf(ts: TypeScriptApi, literal: ObjectLiteralExpression | null): string | null {
  const node = literal ? propertyOf(ts, literal, 'stack') : null;
  const value = node ? unwrap(ts, node) : null;
  if (!value || !ts.isStringLiteralLike(value)) return null;
  return value.text.split(/[\\/]+/u).filter(Boolean).findLast(Boolean) ?? null;
}

/** The keys of the declaration's `fakes` object literal, with their positions. */
function fakeEntriesOf(ts: TypeScriptApi, sourceFile: SourceFile, literal: ObjectLiteralExpression | null): FakeEntry[] {
  const node = literal ? propertyOf(ts, literal, 'fakes') : null;
  const value = node ? unwrap(ts, node) : null;
  if (!value || !ts.isObjectLiteralExpression(value)) return [];
  return value.properties
    .map(property => ({ name: nameText(ts, property.name), ...sourceLocation(sourceFile, property) }))
    .filter(entry => entry.name);
}

/** The `fakedBy` entry of one `stacks` property, or null when the property does not declare one. */
function fakedByEntry(ts: TypeScriptApi, sourceFile: SourceFile, property: ObjectLiteralElementLike): FakedByEntry | null {
  if (!ts.isPropertyAssignment(property)) return null;
  const body = unwrap(ts, property.initializer);
  if (!body || !ts.isObjectLiteralExpression(body)) return null;
  const fake = propertyOf(ts, body, 'fakedBy');
  if (!fake) return null;
  const reason = propertyOf(ts, body, 'reason');
  return {
    service: nameText(ts, property.name),
    fake: ts.isStringLiteralLike(fake) ? fake.text : '',
    reason: reason && ts.isStringLiteralLike(reason) ? reason.text.trim() : '',
    ...sourceLocation(sourceFile, property),
  };
}

/** The `stacks` entries that declare `fakedBy`: [{service, fake, reason, line, column}]; a value the reader cannot read statically has an empty fake and reason. */
function fakedByOf(ts: TypeScriptApi, sourceFile: SourceFile, literal: ObjectLiteralExpression | null): FakedByEntry[] {
  const node = literal ? propertyOf(ts, literal, 'stacks') : null;
  const value = node ? unwrap(ts, node) : null;
  if (!value || !ts.isObjectLiteralExpression(value)) return [];
  return value.properties.map(property => fakedByEntry(ts, sourceFile, property)).filter((entry): entry is FakedByEntry => entry !== null);
}

function registerFakeProvider(fakeProviders: FakeProviders, relative: string, file: string): void {
  if (!relative.startsWith(FAKES_DIRECTORY)) return;
  const [provider, ...rest] = relative.slice(FAKES_DIRECTORY.length).split('/');
  if (provider !== undefined && rest.length > 0 && !fakeProviders.has(provider)) fakeProviders.set(provider, file);
}

function isRoleFileAtRoot(relative: string, suffixes: string[]): boolean {
  const parts = relative.slice(0, -'.ts'.length).split('.');
  return !relative.includes('/') && parts.length >= 2 && parts.every(part => KEBAB.test(part)) && suffixes.includes(parts.at(-1) ?? '');
}

function collectWorldFiles(resolver: HfsGraph['resolver'], tree: { files: Iterable<string> }, suffixes: string[], violations: WorldViolation[]) {
  const fakeProviders: FakeProviders = new Map();
  let worldRoot: string | null = null;
  let files = 0;
  for (const file of [...tree.files].sort(byCodeUnit)) {
    if (!file.endsWith('.ts')) continue;
    const verdict = allowsFile(resolver, file);
    if (verdict?.slot !== WORLD_SLOT) continue;
    files += 1;
    worldRoot ??= file.slice(0, file.length - verdict.relative.length);
    registerFakeProvider(fakeProviders, verdict.relative, file);
    if (verdict.allowed || isRoleFileAtRoot(verdict.relative, suffixes)) continue;
    violations.push({
      ruleId: RULE, path: file, line: 1, column: 1,
      message: `${file} is not allowed in the test world; src/tests/world/ holds only ${verdict.allows.join(', ')} and role-suffixed files (<name>.<role>.ts) at its root. Move it to fakes/ or kit/ (be.tests.world.kit), give it a role suffix, or delete it.`,
      slot: verdict.slot,
    });
  }
  return { fakeProviders, worldRoot, files };
}

function worldDeclaration(graph: HfsGraph, ts: TypeScriptApi, worldRoot: string | null, violations: WorldViolation[]): { configPath: string | null; configFile: GraphFile | null; literal: ObjectLiteralExpression | null } {
  const configPath = worldRoot === null ? null : `${worldRoot}${CONFIG_FILE}`;
  const configFile = configPath === null ? null : graph.files.get(configPath) ?? null;
  const literal = configFile ? configLiteral(ts, configFile.sourceFile) : null;
  if (configFile && !literal) {
    violations.push({
      ruleId: RULE, path: configPath, line: 1, column: 1, slot: WORLD_SLOT,
      message: `${configPath} declares no world the machine can read. Declare it in the one named form \`${NAMED_FORM}\` (an exported const of a ${DEFINE} call with an object literal, imported from @starci/test-world); a default export is refused by R89 and is not read.`,
    });
  }
  return { configPath, configFile, literal };
}

function stackServices(config: ArchitectureConfig, environments: string[]): StackService[] {
  const services: StackService[] = [];
  for (const environment of environments) {
    let stack: { services?: StackService[] } | null = null;
    // The stack is the app root's .starcistacks: the side folder the machine judges reads its app's (locateDeclaration).
    try { stack = readStack({ root: locateDeclaration(config.root).appRoot, environment }); } catch { stack = null; }
    for (const service of stack?.services ?? []) if (service.role !== 'service' && !services.some(known => known.name === service.name)) services.push({ ...service, environment });
  }
  return services;
}

function statefulWhy(service: StackService): string | null {
  if (STATEFUL_KINDS.has(service.kind)) return `a ${service.kind} holds data the app reads back`;
  return service.persistent ? 'the stack gives it a persistent volume' : null;
}

function reportDeclaredFakeProblems(declared: FakedByEntry[], services: StackService[], fakeProviders: FakeProviders, fakeEntries: FakeEntry[], configPath: string | null, stackHint: string, violations: WorldViolation[]): void {
  for (const entry of declared) {
    const service = services.find(candidate => candidate.name === entry.service);
    const problems: string[] = [];
    if (!service) problems.push(`${stackHint} declares no service ${entry.service}`);
    else if (statefulWhy(service)) problems.push(`${service.name} is stateful (${statefulWhy(service)}) and always runs real`);
    if (!fakeProviders.has(entry.fake) && !fakeEntries.some(fake => fake.name === entry.fake)) problems.push(`there is no fakes entry and no fakes/${entry.fake || '<fake>'}/ folder of that name`);
    if (entry.reason === '') problems.push('the reason is empty');
    if (problems.length > 0) {
      violations.push({
        ruleId: RULE, path: configPath, line: entry.line, column: entry.column, slot: WORLD_SLOT,
        message: `${configPath} declares ${entry.service} as faked by ${entry.fake || '(no fake)'}, but ${problems.join('; ')}. The exception covers only stateless compute that needs special hardware or an external model, with a reason; everything else in the stack runs real.`,
      });
    }
  }
}

function worldFakes(fakeProviders: FakeProviders, fakeEntries: FakeEntry[], configPath: string | null): WorldFake[] {
  return [
    ...[...fakeProviders].map(([provider, file]) => ({ name: provider, path: file, line: 1, column: 1, what: `fakes/${provider}/` })),
    ...fakeEntries.filter(entry => !fakeProviders.has(entry.name)).map(entry => ({ name: entry.name, path: configPath, line: entry.line, column: entry.column, what: `the fakes entry ${entry.name}` })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function reportServiceFakes(fakes: WorldFake[], services: StackService[], declared: FakedByEntry[], configPath: string | null, stackHint: string, violations: WorldViolation[]): void {
  for (const fake of fakes) {
    const service = services.find(candidate => namesOfService(candidate).includes(fake.name));
    if (!service) continue;
    if (declared.some(entry => entry.service === service.name && entry.fake === fake.name)) continue; // judged on its stacks entry above
    const why = statefulWhy(service);
    let reason = `${service.name} is stateful (${why}), so no exception applies. `;
    if (!why) {
      const worldConfig = configPath ?? `${CONFIG_FILE} in the world`;
      reason = `Only stateless compute that needs special hardware or an external model may be faked, and only when ${worldConfig} declares it in its stacks entry ({ fakedBy, reason }). `;
    }
    violations.push({
      ruleId: RULE, path: fake.path, line: fake.line, column: fake.column, slot: WORLD_SLOT,
      message: `${fake.what} fakes ${service.name} (${service.image}), which ${stackHint} declares: a service of the repository's own stack runs real in the test world. ${reason}Delete the fake and let the world run the real service; fakes are otherwise only for external SaaS the team does not operate.`,
    });
  }
}

export function checkTestWorldFiles(input: CheckInput) {
  const { config, graph, ts, resolver, tree } = checkerScope(input);
  const { suffixes } = graph.resolver.ruleParams();
  const violations: WorldViolation[] = [];
  const { fakeProviders, worldRoot, files } = collectWorldFiles(resolver, tree, suffixes, violations);
  const { configPath, configFile, literal } = worldDeclaration(graph, ts, worldRoot, violations);
  const environments = [(literal ? environmentOf(ts, literal) : null) ?? defaultEnvironment];
  const services = stackServices(config, environments);
  const stackHint = `${STACKS_DIRECTORY}/${environments.join(', ')}`;
  const worldSource = configFile?.sourceFile;
  const declared = literal && worldSource ? fakedByOf(ts, worldSource, literal) : [];
  const fakeEntries = literal && worldSource ? fakeEntriesOf(ts, worldSource, literal) : [];
  reportDeclaredFakeProblems(declared, services, fakeProviders, fakeEntries, configPath, stackHint, violations);

  // Every fake the world runs: the repository's fakes/<provider>/ folders and the fakes entries of the declaration.
  const fakes = worldFakes(fakeProviders, fakeEntries, configPath);
  reportServiceFakes(fakes, services, declared, configPath, stackHint, violations);
  return { violations, coverage: { status: 'checked', files } };
}
