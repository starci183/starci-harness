import fs from 'node:fs';
import path from 'node:path';
import { machineKit, pascal, upperSnake } from './machine-ast.mjs';
import { locateDeclaration, type ConnectionView } from '../slots.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import type { CallExpression, Declaration, Expression, Node, PropertyAccessExpression, Statement, TypeChecker, VariableStatement } from 'typescript';
import type { ArchitectureConfig, TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, CheckInput, GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { ImportBinding, MachineKit } from './machine-ast.mjs';

/** One connection hfs.json declares. */
type DeclaredConnection = ConnectionView;

type Report = (rel: string, message: string, extra?: Record<string, unknown>) => void;
type DecoratorsFile = (name: string) => string;

/** What the whole-map checks share. */
interface MapState {
  config: ArchitectureConfig;
  graph: HfsGraph;
  kit: MachineKit;
  ts: TypeScriptApi;
  declared: readonly DeclaredConnection[];
  byName: Map<string, DeclaredConnection>;
  violations: ArchitectureViolation[];
  report: Report;
  decoratorsFile: DecoratorsFile;
}

/** The map state plus what the per-file walk adds. */
interface WalkState extends MapState {
  perDecorators: Map<string, number>;
  slotIs: (file: GraphFile, id: string) => boolean;
}

/** What one `<receiver>.register(...)` argument walk reads. */
interface RegistrationScope {
  ts: TypeScriptApi;
  kit: MachineKit;
  checker: TypeChecker;
  byName: Map<string, DeclaredConnection>;
  passed: Map<string, number>;
  root: GraphFile;
  app: { name: string };
  report: Report;
}

/** The resolved database of one connection in one stack env. */
interface StackConnection {
  host: string;
  port: string;
  database: string;
  triple: string;
  schema: string | null;
}

/**
 * R84 `connection-map` (BE_CONNECTION_DUPLICATE), folding RED01 and RED02. One physical database is one connection, one
 * `Inject<Conn>EntityManager()` injector, one config; the `hfs.json` connections, the connection files, the injectors, the
 * database module registration of every app and the env of every stack correspond one to one.
 *
 *   - per declared connection `<name>`: `src/modules/platform/database/<name>.connection.ts` exports
 *     `<NAME>_CONNECTION = "<name>"`, `<name>.decorators.ts` exports `Inject<Pascal>EntityManager`, `<name>.config.ts`
 *     exists and reads only `<ENVPREFIX>_*` keys;
 *   - a connection file for a name hfs.json does not declare is refused;
 *   - `getEntityManagerToken(` and `InjectEntityManager(` (from @nestjs/typeorm) resolve their argument through the
 *     checker to a connection name and may be called only in that connection's decorators file, once; the DataSource
 *     forms only in platform/database, the cli app and the test fixtures; an exported `Inject*EntityManager`
 *     anywhere else (a capability-specific injector, a duplicate) is refused;
 *   - inside one app every connection is passed to the platform/database module registration once;
 *   - a connection whose hfs.json `isolation` is `schema` reads `<PREFIX>_SCHEMA` in its config (a context is its own database or its own
 *     schema of a shared one; splitting it out later is an env change only);
 *   - in every `.starcistacks/<env>/runtime/env` two connections whose `<PREFIX>_HOST`, `<PREFIX>_PORT` and
 *     `<PREFIX>_NAME` (or `_DATABASE`, whichever the config reads) resolve to one triple are the same database, unless both are
 *     `isolation: schema` with different `<PREFIX>_SCHEMA` values (two contexts as schemas of one database).
 */
export const CONNECTION_RULE_IDS = ['BE_CONNECTION_DUPLICATE'];

const RULE = 'BE_CONNECTION_DUPLICATE';
export const DATABASE_DIR = 'src/modules/platform/database';
const TYPEORM = '@nestjs/typeorm';
const MANAGER_CALLS = new Set(['getEntityManagerToken', 'InjectEntityManager']);
const SOURCE_CALLS = new Set(['getDataSourceToken', 'InjectDataSource']);
const ENV_KEY = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;
const INJECTOR_NAME = /^Inject[A-Za-z0-9]*EntityManager$/u;

const exportedInjectorName = (ts: TypeScriptApi, kit: MachineKit, node: Node): string | null => {
  const statement: Node | undefined = node.parent?.parent;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && statement && ts.isVariableStatement(statement) && kit.isExported(statement)) return node.name.text;
  if (ts.isFunctionDeclaration(node) && kit.isExported(node) && node.name) return node.name.text;
  return null;
};

const ENV_ASSIGNMENT = /^(?:export\s+)?([A-Za-z_]\w*)\s*=/u;
const LINE_BREAK = /[\n\r\u2028\u2029]/u;

// One `KEY=value` line: a value holding a line break after its first character is not an assignment.
function parseEnvLine(raw: string): [string, string] | null {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return null;
  const match = ENV_ASSIGNMENT.exec(line);
  if (!match) return null;
  const key = match[1];
  if (key === undefined) return null;
  let value = line.slice(match[0].length).trim();
  if (LINE_BREAK.test(value)) return null;
  if (/^(['"]).*\1$/u.test(value)) value = value.slice(1, -1);
  return [key, value.trim()];
}

function readEnvFile(file: string, merged: Map<string, string>): void {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split(/\r?\n/u)) {
    const parsed = parseEnvLine(raw);
    if (parsed) merged.set(parsed[0], parsed[1]);
  }
}

function readEnvFiles(target: string): Map<string, string> | null {
  const merged = new Map<string, string>();
  let stat: fs.Stats;
  try { stat = fs.statSync(target); } catch { return null; }
  if (stat.isFile()) readEnvFile(target, merged);
  else for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && !entry.name.toLowerCase().endsWith('.md')) readEnvFile(path.join(target, entry.name), merged);
  }
  return merged;
}

const exportsVariable = (ts: TypeScriptApi, kit: MachineKit, item: Statement, name: string): item is VariableStatement => ts.isVariableStatement(item) && kit.isExported(item as unknown as Declaration)
  && item.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name);

const checkConnectionFile = (connection: DeclaredConnection, kit: MachineKit, ts: TypeScriptApi, report: Report): void => {
  const connectionRel = `${DATABASE_DIR}/${connection.name}.connection.ts`;
  const constant = `${upperSnake(connection.name)}_CONNECTION`;
  const connectionFile = kit.graphFile(connectionRel);
  if (!connectionFile) {
    report(connectionRel, `hfs.json declares connection ${connection.name} but ${connectionRel} does not exist; declare \`export const ${constant} = "${connection.name}"\` there.`, { connection: connection.name });
    return;
  }
  const checker = kit.checkerOf(connectionFile.sourceFile);
  const statement = connectionFile.sourceFile.statements.find(item => exportsVariable(ts, kit, item, constant));
  const initializer = statement?.declarationList.declarations.find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === constant)?.initializer;
  if (!statement || kit.stringValue(checker, initializer) !== connection.name) {
    report(connectionRel, `${connectionRel} must export \`${constant} = "${connection.name}"\` (the connection name declared in hfs.json).`, { connection: connection.name });
  }
};

const checkInjectorFile = (connection: DeclaredConnection, kit: MachineKit, ts: TypeScriptApi, report: Report, decoratorsFile: DecoratorsFile): void => {
  const decorators = kit.graphFile(decoratorsFile(connection.name));
  const injector = `Inject${pascal(connection.name)}EntityManager`;
  const exported = decorators?.sourceFile.statements.some(item => exportsVariable(ts, kit, item, injector)
    || (ts.isFunctionDeclaration(item) && kit.isExported(item) && item.name?.text === injector));
  if (!exported) report(decoratorsFile(connection.name), `Connection ${connection.name} needs ${decoratorsFile(connection.name)} exporting ${injector}, the one injector of its shared EntityManager.`, { connection: connection.name });
};

const isProcessEnvAccess = (ts: TypeScriptApi, node: Node): node is PropertyAccessExpression => ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'env'
  && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'process';

const configEnvKey = (ts: TypeScriptApi, node: Node): string | null => {
  if (ts.isStringLiteralLike(node) && ENV_KEY.test(node.text)) return node.text;
  if (isProcessEnvAccess(ts, node) && ENV_KEY.test(node.name.text)) return node.name.text;
  return null;
};

const checkConfigFile = (connection: DeclaredConnection, declared: readonly DeclaredConnection[], kit: MachineKit, ts: TypeScriptApi, report: Report, configRel: string, configFile: GraphFile): void => {
  let readsSchema = false;
  kit.walk(configFile.sourceFile, node => {
    const key = configEnvKey(ts, node);
    if (key === null) return true;
    if (key === `${connection.envPrefix}_SCHEMA`) readsSchema = true;
    const own = key.startsWith(`${connection.envPrefix}_`);
    const foreign = declared.some(other => other !== connection && key.startsWith(`${other.envPrefix}_`));
    if (!own || foreign) {
      report(configRel, `${configRel} reads ${key}; the config of connection ${connection.name} reads only ${connection.envPrefix}_* keys.`, { ...kit.at(configRel, configFile.sourceFile, node), connection: connection.name });
    }
    return false;
  });
  if (connection.isolation === 'schema' && !readsSchema) report(configRel, `Connection ${connection.name} is isolated as a schema of a shared database (hfs.json isolation), so ${configRel} must read ${connection.envPrefix}_SCHEMA and hand it to the data source; splitting the context out into its own database is then an env change only.`, { connection: connection.name });
};

const checkDeclaredConnections = (declared: readonly DeclaredConnection[], kit: MachineKit, ts: TypeScriptApi, report: Report, decoratorsFile: DecoratorsFile): void => {
  for (const connection of declared) {
    checkConnectionFile(connection, kit, ts, report);
    checkInjectorFile(connection, kit, ts, report, decoratorsFile);
    const configRel = `${DATABASE_DIR}/${connection.name}.config.ts`;
    const configFile = kit.graphFile(configRel);
    if (!configFile) {
      report(configRel, `Connection ${connection.name} needs ${configRel}, the one place its ${connection.envPrefix}_* keys are read.`, { connection: connection.name });
      continue;
    }
    checkConfigFile(connection, declared, kit, ts, report, configRel, configFile);
  }
};

const reportUndeclaredDatabaseFiles = (databaseFiles: GraphFile[], byName: Map<string, DeclaredConnection>, report: Report): void => {
  for (const file of databaseFiles) {
    const match = /^(.+)\.(connection|decorators|config)\.ts$/u.exec(path.posix.basename(file.rel));
    const name = match?.[1];
    if (match && name !== undefined && path.posix.dirname(file.rel) === DATABASE_DIR && !byName.has(name)) {
      report(file.rel, `${file.rel} belongs to connection ${name}, which hfs.json does not declare; declare the database in hfs.json connections or delete the file.`, { connection: name });
    }
  }
};

const inspectManagerToken = (file: GraphFile, checker: TypeChecker, node: CallExpression, binding: ImportBinding, state: WalkState): void => {
  const { kit, byName, decoratorsFile, report, perDecorators } = state;
  const value = kit.stringValue(checker, node.arguments[0]);
  const home = value === null ? null : decoratorsFile(value);
  if (value === null || !byName.has(value)) {
    const target = value === null ? 'a connection that cannot be resolved to a constant' : `connection ${value}, which hfs.json does not declare`;
    report(file.rel, `${binding.name}() names ${target}; only the declared connections have an entity manager token.`, kit.at(file.rel, file.sourceFile, node));
  } else if (file.rel !== home) {
    report(file.rel, `${binding.name}(${value}) belongs in ${home} only; inject the shared manager with Inject${pascal(value)}EntityManager() instead of a second path to connection ${value}.`, { ...kit.at(file.rel, file.sourceFile, node), connection: value });
  } else {
    perDecorators.set(value, (perDecorators.get(value) ?? 0) + 1);
    if ((perDecorators.get(value) ?? 0) > 1) report(file.rel, `${home} resolves connection ${value} more than once; one connection has one injector.`, { ...kit.at(file.rel, file.sourceFile, node), connection: value });
  }
};

const inspectDataSourceCall = (file: GraphFile, node: Node, binding: ImportBinding, state: WalkState): void => {
  const allowed = file.rel.startsWith(`${DATABASE_DIR}/`) || state.slotIs(file, 'be.app.cli') || state.slotIs(file, 'be.cli') || state.slotIs(file, 'be.tests.fixtures');
  if (!allowed) state.report(file.rel, `${binding.name}() reaches the DataSource outside platform/database and the cli; inject the shared EntityManager of the connection instead.`, state.kit.at(file.rel, file.sourceFile, node));
};

const inspectTypeormCall = (file: GraphFile, checker: TypeChecker, node: CallExpression, state: WalkState): void => {
  const binding = state.kit.importBinding(checker, node.expression);
  if (binding?.module === TYPEORM && MANAGER_CALLS.has(binding.name)) inspectManagerToken(file, checker, node, binding, state);
  else if (binding?.module === TYPEORM && SOURCE_CALLS.has(binding.name)) inspectDataSourceCall(file, node, binding, state);
};

const inspectInjectorExport = (file: GraphFile, node: Node, state: WalkState): void => {
  const { ts, kit, byName, decoratorsFile, report } = state;
  const exportedName = exportedInjectorName(ts, kit, node);
  if (!exportedName || !INJECTOR_NAME.test(exportedName)) return;
  const home = [...byName.keys()].find(name => `Inject${pascal(name)}EntityManager` === exportedName);
  if (!home || file.rel !== decoratorsFile(home)) {
    report(file.rel, `${exportedName} is exported here, but the only injector of an entity manager is Inject<Conn>EntityManager in src/modules/platform/database/<conn>.decorators.ts, one per declared connection.`, kit.at(file.rel, file.sourceFile, node));
  }
};

const inspectManagerNode = (file: GraphFile, checker: TypeChecker, node: Node, state: WalkState): boolean => {
  if (state.ts.isCallExpression(node)) inspectTypeormCall(file, checker, node, state);
  inspectInjectorExport(file, node, state);
  return true;
};

const checkManagerCalls = (graph: HfsGraph, state: MapState): void => {
  const perDecorators = new Map<string, number>();
  const walkState: WalkState = { ...state, perDecorators, slotIs: (file: GraphFile, id: string) => file.slot === id };
  for (const file of graph.files.values()) {
    const checker = state.kit.checkerOf(file.sourceFile);
    state.kit.walk(file.sourceFile, node => inspectManagerNode(file, checker, node, walkState));
  }
};

/** The receiver of a `<receiver>.register(...)` call that `node` is, or null. */
const registerReceiver = (ts: TypeScriptApi, node: Node): Expression | null => {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'register' ? callee.expression : null;
};

const isPropertyName = (ts: TypeScriptApi, node: Node): boolean => {
  const parent: Node | undefined = node.parent;
  if (!parent) return false;
  return (ts.isPropertyAssignment(parent) || ts.isPropertyAccessExpression(parent)) && parent.name === node;
};

const passConnections = (argument: Node, scope: RegistrationScope): void => {
  const { ts, kit, checker, byName, passed, root, app, report } = scope;
  kit.walk(argument, inner => {
    if (isPropertyName(ts, inner)) return true;
    if (!(ts.isIdentifier(inner) || ts.isStringLiteralLike(inner) || ts.isPropertyAccessExpression(inner))) return true;
    const value = kit.stringValue(checker, inner);
    if (value === null || !byName.has(value)) return true;
    passed.set(value, (passed.get(value) ?? 0) + 1);
    if ((passed.get(value) ?? 0) > 1) report(root.rel, `App ${app.name} passes connection ${value} to the database module registration more than once; one connection is registered once per app.`, { ...kit.at(root.rel, root.sourceFile, inner), connection: value, app: app.name });
    return false;
  });
};

const checkAppRegistrations = (config: ArchitectureConfig, kit: MachineKit, ts: TypeScriptApi, byName: Map<string, DeclaredConnection>, report: Report): number => {
  let registrations = 0;
  for (const app of config.apps) {
    // The root and its composition groups (compose/<area>.ts) are one composition: a connection is passed once across them.
    const passed = new Map<string, number>();
    for (const root of kit.appCompositionFiles(app.name)) {
      const checker = kit.checkerOf(root.sourceFile);
      const scope: RegistrationScope = { ts, kit, checker, byName, passed, root, app, report };
      kit.walk(root.sourceFile, node => {
        const receiver = registerReceiver(ts, node);
        if (!receiver || !ts.isCallExpression(node)) return;
        const owner = kit.declarationsOf(checker, receiver).map(kit.ownerOfDeclaration).find(Boolean);
        if (owner?.tier !== 'platform' || owner.name !== 'database') return;
        registrations += 1;
        for (const argument of node.arguments) passConnections(argument, scope);
      });
    }
  }
  return registrations;
};

const listStackEnvs = (stacksRoot: string): string[] => {
  try { return fs.readdirSync(stacksRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(byCodeUnit); } catch { return []; }
};

// The resolved database of one connection in one stack env, or null while its host, port or name is unset.
const resolveStackConnection = (kit: MachineKit, connection: DeclaredConnection, values: Map<string, string>): StackConnection | null => {
  const configFile = kit.graphFile(`${DATABASE_DIR}/${connection.name}.config.ts`);
  const nameKey = configFile?.sourceFile.text.includes(`${connection.envPrefix}_DATABASE`) ? `${connection.envPrefix}_DATABASE` : `${connection.envPrefix}_NAME`;
  const host = values.get(`${connection.envPrefix}_HOST`);
  const port = values.get(`${connection.envPrefix}_PORT`);
  const database = values.get(nameKey);
  if (!host || !port || !database) return null;
  const schema = connection.isolation === 'schema' ? (values.get(`${connection.envPrefix}_SCHEMA`) ?? '') : null;
  return { host, port, database, triple: `${host.toLowerCase()}|${port}|${database}`, schema };
};

// True when the env resolves at least one connection; false when it is skipped.
const checkStackEnv = (config: ArchitectureConfig, kit: MachineKit, declared: readonly DeclaredConnection[], report: Report, stacksRoot: string, env: string): boolean => {
  // Relative to the side folder the machine judges (`../.starcistacks/...` for a side): the app-relative path once the side is prefixed.
  const rel = path.relative(config.root, path.join(stacksRoot, env, 'runtime', 'env')).split(path.sep).join('/');
  const values = readEnvFiles(path.join(stacksRoot, env, 'runtime', 'env'));
  if (!values || values.size === 0) return false;
  const seen = new Map<string, { name: string; schema: string | null }[]>(); // host|port|database -> [{name, isolation, schema}]
  let resolved = 0;
  for (const connection of declared) {
    const found = resolveStackConnection(kit, connection, values);
    if (!found) continue;
    resolved += 1;
    const { host, port, database, triple, schema } = found;
    const sharing = seen.get(triple) ?? [];
    // Two contexts may share one database only as distinct, named schemas; a context that is its own database shares it with nobody.
    const clash = sharing.find(other => schema === null || other.schema === null || other.schema === schema);
    if (clash) {
      const schemaDetail = schema !== null && clash.schema === schema ? `, schema ${schema || '(none)'}` : '';
      report(rel, `Connections ${clash.name} and ${connection.name} resolve to the same database (${host}:${port}/${database}${schemaDetail}) in stack ${env}; contexts share a database only as distinct schemas (isolation schema, a different ${connection.envPrefix}_SCHEMA), otherwise one physical database is one connection.`, { connection: connection.name, env });
    }
    sharing.push({ name: connection.name, schema });
    seen.set(triple, sharing);
  }
  return resolved > 0;
};

const checkStackConnections = (config: ArchitectureConfig, kit: MachineKit, declared: readonly DeclaredConnection[], report: Report): { stacksChecked: number; stacksSkipped: number } => {
  let stacksChecked = 0;
  let stacksSkipped = 0;
  // .starcistacks sits at the app root: the side folder the machine judges reads its app's tree (locateDeclaration).
  const stacksRoot = path.join(locateDeclaration(config.root).appRoot, '.starcistacks');
  for (const env of listStackEnvs(stacksRoot)) {
    if (checkStackEnv(config, kit, declared, report, stacksRoot, env)) stacksChecked += 1; else stacksSkipped += 1;
  }
  return { stacksChecked, stacksSkipped };
};

export function checkConnectionMap(input: CheckInput) {
  const { config, graph } = input;
  const kit = machineKit(input);
  const { ts } = kit;
  const declared: readonly DeclaredConnection[] = config.hfs.repo.connections ?? [];
  const byName = new Map(declared.map((connection): [string, DeclaredConnection] => [connection.name, connection]));
  const violations: ArchitectureViolation[] = [];
  const report: Report = (rel, message, extra = {}) => { violations.push({ ruleId: RULE, path: rel, message, ...extra }); };
  const decoratorsFile: DecoratorsFile = name => `${DATABASE_DIR}/${name}.decorators.ts`;
  const databaseFiles = [...graph.files.values()].filter(file => file.rel.startsWith(`${DATABASE_DIR}/`));
  const state: MapState = { config, graph, kit, ts, declared, byName, violations, report, decoratorsFile };
  checkDeclaredConnections(declared, kit, ts, report, decoratorsFile);
  reportUndeclaredDatabaseFiles(databaseFiles, byName, report);
  checkManagerCalls(graph, state);
  const registrations = checkAppRegistrations(config, kit, ts, byName, report);
  const { stacksChecked, stacksSkipped } = checkStackConnections(config, kit, declared, report);
  return { violations, coverage: { status: 'checked', connections: declared.length, registrations, stacksChecked, stacksSkipped } };
}
