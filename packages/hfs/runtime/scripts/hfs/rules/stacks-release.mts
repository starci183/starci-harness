// R267/R268: immutable release references, recovery evidence and declared recurring CLI work.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { walkSqlAst, sqlParser, sqlCallArgument } from '../../lib/sql-ast.mjs';
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { found, readText } from './read.mjs';
import { stacksDeploymentContexts } from './stacks-runtime.mjs';
import type { Parsed } from './rule-types.mjs';

// PostgreSQL initializes asynchronously, while HFS finders must stay synchronous.
// Optional loading also lets dependency-free relocated development gates import this rule.
async function postgresParser() {
  try {
    const { default: parser } = await import('libpg-query');
    await parser.loadModule();
    return parser;
  } catch { return null; }
}

const pg = await postgresParser();
const HERE = path.dirname(fileURLToPath(import.meta.url));
let ts: Parsed;

const DECLARATION = '.starcistacks/application-stacks.yaml';
const MAX_BYTES = 1024 * 1024;
const SOURCE = /^(?:be\/)?(?:src|apps)\/.*\.[cm]?[jt]s$/;
const TEST = /(?:\.(?:spec|test)|-spec)\.[cm]?[jt]s$|\/(?:tests|__tests__)\//;
const SECRET = /(?:(?:^|\/)(?:secrets|\.claude|\.aws|\.codex)(?:\/|$))|(?:(?:^|\/)\.env(?:\.|$))|(?:\.(?:enc|pem|key|p12|pfx)$)/i;
const CLI_ENTRY = /^(?:be\/)?dist\/apps\/cli\/[A-Za-z0-9_./-]+\.(?:js|mjs|cjs)$/;
const mapping = (value: Parsed) => plain(value) ? value : {};
const present = (value: Parsed) => typeof value === 'string' && Boolean(value.trim());
const issue = (code: string, at: Parsed, message: string) => ({ code, at, message });
const scheduleIssue = (at: Parsed, message: string) => issue('HFS_SCHEDULE_UNDECLARED', at, message);

function safeRelative(relative: string) {
  if (!present(relative) || SECRET.test(relative) || relative.includes(String.fromCodePoint(92))) return false;
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return false;
  return relative.split('/').every((part: Parsed) => part && part !== '.' && part !== '..');
}

function publicReference(repoRoot: string, files: string[], relative: string) {
  if (!repoRoot || !safeRelative(relative)) return false;
  if (!files.includes(relative)) return false;
  const root = path.resolve(repoRoot), target = path.resolve(root, relative);
  try {
    let cursor = target;
    while (cursor !== root) {
      if (fs.lstatSync(cursor).isSymbolicLink()) return false;
      cursor = path.dirname(cursor);
    }
    const stat = fs.lstatSync(target);
    return stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES;
  } catch { return false; }
}

function releaseIssues({ environment, spec, repoRoot, files }: { environment: Parsed; spec: Parsed; repoRoot: string; files: string[] }) {
  const release = mapping(spec.release), at = `environments.${environment}.release`;
  const references = ['imagesLock', 'pointer', 'previous'];
  const assertions = release.healthAssertions;
  const valid = references.every(key => publicReference(repoRoot, files, release[key]))
    && Array.isArray(assertions) && assertions.length > 0 && assertions.every(present);
  return valid ? [] : [issue('STACKS_RELEASE_UNDECLARED', at,
    'Swarm release must declare tracked public imagesLock, pointer and previous records, and nonempty healthAssertions')];
}

function persistentVolume(volume: Parsed) {
  if (plain(volume)) return volume.type === 'volume' && present(volume.source);
  if (!present(volume)) return false;
  const source = volume.split(':')[0];
  return volume.includes(':') && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source);
}

function stateful(component: Parsed, service: Parsed) {
  return component.role === 'stateful' || component.stateful === true
    || present(component.database) || present(component.database?.provider)
    || (Array.isArray(component.volumes) && component.volumes.length > 0)
    || (Array.isArray(service.volumes) && service.volumes.some(persistentVolume));
}

function recoveryComponents({ doc, spec, model }: { doc: Parsed; spec: Parsed; model: Parsed }) {
  const components = mapping(doc.components), services = mapping(model?.services);
  const selected = new Set([...Object.keys(mapping(spec.components)), ...Object.keys(services)]);
  // Every declared backing (the lite db: backing.db naming its component) owes a backup, as every stateful component does.
  const required = new Set(Object.entries<Parsed>(mapping(doc.backing)).filter(([, entry]) => typeof entry?.provider === 'string').map(([id]) => id));
  for (const id of selected) if (stateful(mapping(components[id]), mapping(services[id]))) required.add(id);
  return [...required];
}

function backupIssues(context: Parsed) {
  const { environment, spec, repoRoot, files } = context;
  const backups = Array.isArray(spec.backup) ? spec.backup : [];
  const issues = [];
  for (const id of recoveryComponents(context)) {
    const at = `environments.${environment}.backup.${id}`;
    const records = backups.filter((record: Parsed) => record?.component === id);
    const complete = records.length === 1 && ['target', 'retention', 'owner'].every(key => present(records[0][key]));
    if (!complete) issues.push(issue('BACKUP_UNDECLARED', at, 'stateful components and managed backing must declare one backup target, retention and owner'));
    if (records.length === 1 && !publicReference(repoRoot, files, records[0].restoreProof))
      issues.push(issue('BACKUP_PROOF_MISSING', `${at}.restoreProof`, 'backup must reference a tracked, bounded public restore proof record'));
  }
  return issues;
}

/** Release and recovery declarations are mandatory for Swarm in either edition. */
export function releaseBackupIssues({ doc = {}, environment, spec = {}, model = {}, repoRoot, files = [] }: { doc?: Parsed; environment: Parsed; spec?: Parsed; model?: Parsed; repoRoot: string; files?: string[] }) {
  if (spec.runtime !== 'docker-swarm') return [];
  const context = { doc, environment, spec, model, repoRoot, files };
  return [...releaseIssues(context), ...backupIssues(context)];
}

function commandWords(value: Parsed) {
  if (Array.isArray(value)) return value.every(present) ? value : [];
  if (!present(value) || /[;&|<>`\r\n]/.test(value) || value.includes('$(')) return [];
  return value.trim().split(/\s+/).map((word: string) => word.replace(/^['"]|['"]$/g, ''));
}

function cliCommand(value: Parsed) {
  const words = commandWords(value);
  if (words.length < 3 || words[0] !== 'node' || !CLI_ENTRY.test(words[1]) || words[1].split('/').includes('..')) return null;
  if (!/^[a-z][A-Za-z0-9:_-]*$/.test(words[2])) return null;
  return [words[1].replace(/^be\//, ''), ...words.slice(2)].join(' ');
}

function jobIssues(doc: Parsed) {
  return Object.entries<Parsed>(mapping(doc.jobs)).flatMap(([id, job]) =>
    present(job?.schedule) && cliCommand(job?.command) ? [] : [scheduleIssue(`jobs.${id}`, 'recurring jobs must declare a nonempty schedule and an app CLI command')]);
}

function cadenceMatches(declared: Parsed, cadence: Parsed) {
  if (cadence === null) return true;
  const value = String(cadence);
  return declared === value || declared === `every:${value}` || declared === `${value}ms`;
}

function matchingJob(doc: Parsed, observation: Parsed) {
  const jobs = Object.entries<Parsed>(mapping(doc.jobs));
  const candidates = jobs.filter(([id, job]) => id === observation.id || (observation.component && job?.component === observation.id));
  return candidates.find(([, job]) => present(job?.schedule) && cliCommand(job.command)
    && (observation.id || observation.cadence !== null) && cadenceMatches(job.schedule, observation.cadence))?.[1] ?? null;
}

function unwrap(node: Parsed) {
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

function literal(node: Parsed, bindings: Parsed, seen = new Set()) {
  node = unwrap(node);
  if (!node) return null;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    seen.add(node.text);
    return literal(bindings.get(node.text), bindings, seen);
  }
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'CronExpression') return node.getText();
  return null;
}

function property(node: Parsed, name: string) {
  node = unwrap(node);
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const entry = node.properties.find((item: Parsed) => item.name?.getText().replaceAll('"', '').replaceAll("'", '') === name);
  return entry?.initializer ?? null;
}

function sourceBindings(source: Parsed) {
  const bindings = new Map(), aliases = new Map([['Cron', 'Cron'], ['Interval', 'Interval']]);
  const visit = (node: Parsed) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bindings.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@nestjs/schedule') continue;
    for (const item of statement.importClause?.namedBindings?.elements ?? []) aliases.set(item.name.text, (item.propertyName ?? item.name).text);
  }
  return { bindings, aliases };
}

function callObservation(node: Parsed, facts: Parsed) {
  if (!ts.isCallExpression(node)) return null;
  const name = node.expression.getText().split('.').at(-1), kind = facts.aliases.get(name) ?? name;
  if (kind === 'Cron' || kind === 'Interval') {
    const member = ts.isDecorator(node.parent) ? node.parent.parent.name?.getText() : null;
    return { id: literal(property(node.arguments[1], 'name'), facts.bindings) ?? member,
      cadence: literal(node.arguments[0], facts.bindings), node };
  }
  if (name === 'setInterval') return {
    id: node.arguments[0] && ts.isIdentifier(node.arguments[0]) ? node.arguments[0].text : null,
    cadence: literal(node.arguments[1], facts.bindings), node,
  };
  if (name !== 'upsertJobScheduler' && name !== 'addJobScheduler') return null;
  return { id: literal(node.arguments[0], facts.bindings),
    cadence: literal(property(node.arguments[1], 'pattern') ?? property(node.arguments[1], 'every'), facts.bindings), node };
}

function objectObservation(node: Parsed, facts: Parsed) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const id = property(node, 'id'), cadence = property(node, 'everyMs') ?? property(node, 'pattern');
  if (!id || !cadence) return null;
  return { id: literal(id, facts.bindings), cadence: literal(cadence, facts.bindings), node };
}

function sourceObservationIssues(doc: Parsed, file: string, source: Parsed, facts: Parsed) {
  const issues: Parsed[] = [];
  const visit = (node: Parsed) => {
    const observation = callObservation(node, facts) ?? objectObservation(node, facts);
    const forwarding = file.includes('/modules/platform/') && observation?.id === null && observation.cadence === null;
    if (observation && !forwarding && !matchingJob(doc, observation)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      issues.push(scheduleIssue(`${file}:${line}`, 'recurring source must match a manifest jobs entry with its schedule and an app CLI command'));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return issues;
}

const walkSql = (tree: Parsed, visit: Parsed) => walkSqlAst(tree, visit, true);
const parseSql = sqlParser(pg);

function sqlArgument(call: Parsed, position: Parsed, names: string[]) {
  const value = sqlCallArgument(call, position, names);
  return value?.A_Const?.sval?.sval ?? value?.TypeCast?.arg?.A_Const?.sval?.sval ?? null;
}

function executableExpression(expression: Parsed) {
  let query = expression.query;
  if (expression.parseMode === 0) return query;
  if (expression.parseMode >= 3) {
    const assignment = query.indexOf(':=');
    query = assignment < 0 ? query.slice(query.indexOf('=') + 1) : query.slice(assignment + 2);
  }
  return `SELECT ${query}`;
}

function doSqlObservations(statement: Parsed, file: string) {
  const body = statement.args?.find((arg: Parsed) => arg.DefElem?.defname === 'as')?.DefElem?.arg?.String?.sval;
  if (!present(body)) return [];
  let tree;
  try { tree = pg!.parsePlPgSQLSync("DO '" + body.replaceAll("'", "''") + "';"); }
  catch { return [{ id: null, cadence: null, at: file }]; }
  const observations: Parsed[] = [];
  walkSql(tree, (value: Parsed) => {
    const expression = value.PLpgSQL_expr;
    if (present(expression?.query)) observations.push(...sqlObservations(executableExpression(expression), file));
  });
  return observations;
}

function sqlObservations(text: string, file: string) {
  const tree = parseSql(text);
  if (!tree) return [{ id: null, cadence: null, at: file }];
  const observations: Parsed[] = [];
  walkSql(tree, (value: Parsed) => {
    if (value.DoStmt) observations.push(...doSqlObservations(value.DoStmt, file));
    const call = value.FuncCall;
    if (!call) return;
    const name = (call.funcname ?? []).map((part: Parsed) => part.String?.sval).join('.');
    if (name === 'cron.unschedule') observations.push({ remove: sqlArgument(call, 0, ['job_name']) });
    if (name === 'cron.schedule' || name === 'cron.schedule_in_database') observations.push({
      id: sqlArgument(call, 0, ['job_name']), cadence: sqlArgument(call, 1, ['schedule']),
      at: `${file}:${text.slice(0, call.location).split('\n').length}`,
    });
  });
  return observations;
}

function sourceSqlObservations(source: Parsed, file: string) {
  const observations: Parsed[] = [];
  const constants = sqlConstants(source);
  const visit = (node: Parsed) => {
    if (ts.isCallExpression(node) && /(?:^|\.)(?:query|execute)$/.test(node.expression.getText())) {
      const argument = unwrap(node.arguments[0]);
      const text = argument && ts.isIdentifier(argument) ? constants.get(argument.text) : argument;
      if (text) observations.push(...templateObservations(text, file));
    }
    if (ts.isTaggedTemplateExpression(node) && /(?:^|\.)sql$/.test(node.tag.getText()))
      observations.push(...templateObservations(node.template, file));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return observations;
}

/** The file's `const NAME = <string or template>` statements, so SQL named before its query call is judged as if inline. */
function sqlConstants(source: Parsed) {
  const constants = new Map();
  const visit = (node: Parsed) => {
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const)) {
      for (const declaration of node.declarations) {
        const value = unwrap(declaration.initializer);
        if (ts.isIdentifier(declaration.name) && value && (ts.isStringLiteralLike(value) || ts.isTemplateExpression(value)))
          constants.set(declaration.name.text, value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return constants;
}

const DYNAMIC = 'starci_dynamic_sql';

/**
 * The observations of an application SQL text. A template is read with each `${}` as NULL; when that does not parse (an
 * interpolated identifier: `LISTEN ${channel}`, `SET x = ${n}`, `FROM ${fn}(...)`), it is read again with each `${}` as an
 * identifier. A function whose name is interpolated bare may be pg_cron, so it stays an unknown observation; the skeleton's
 * `callDbFunction` quotes `"${schema}"."${name}"`, which parses as it is.
 */
function templateObservations(node: Parsed, file: string) {
  if (ts.isStringLiteralLike(node)) return sqlObservations(node.text, file);
  if (!ts.isTemplateExpression(node)) return [];
  const spell = (placeholder: Parsed) => node.head.text + node.templateSpans.map((span: Parsed) => `${placeholder}${span.literal.text}`).join('');
  const nulls = spell('NULL');
  if (parseSql(nulls)) return sqlObservations(nulls, file);
  const named = spell(DYNAMIC);
  const tree = parseSql(named);
  if (!tree) return [{ id: null, cadence: null, at: file }];
  let dynamicCall = false;
  walkSql(tree, (value: Parsed) => {
    if (value.FuncCall && (value.FuncCall.funcname ?? []).some((part: Parsed) => part.String?.sval === DYNAMIC)) dynamicCall = true;
  });
  if (dynamicCall) return [{ id: null, cadence: null, at: file }];
  return sqlObservations(named, file);
}

function recurringObservations({ doc, repoRoot, files, file, issues }: { doc: Parsed; repoRoot: string; files: string[]; file: string; issues: Parsed }) {
  const sql = file.startsWith('db/migrations/') && file.endsWith('.sql') && !file.startsWith('db/migrations/archive/');
  const sourceFile = SOURCE.test(file) && !TEST.test(file);
  if ((!sql && !sourceFile) || !publicReference(repoRoot, files, file)) return [];
  const text = readText(repoRoot, file);
  if (text === null) return [];
  if (sql) return sqlObservations(text, file);
  ts ??= loadTypescript(repoRoot, HERE);
  if (!ts) {
    issues.push(scheduleIssue(file, 'TypeScript is required to inspect recurring application work'));
    return [];
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  issues.push(...sourceObservationIssues(doc, file, source, sourceBindings(source)));
  return sourceSqlObservations(source, file);
}

function recurringSourceIssues({ doc, repoRoot, files }: { doc: Parsed; repoRoot: string; files: string[] }) {
  const issues: Parsed[] = [], cron = new Map();
  const paths = [...new Set(files)].sort((left, right) => left.localeCompare(right));
  for (const file of paths) {
    const observations = recurringObservations({ doc, repoRoot, files, file, issues });
    for (const observation of observations) {
      if ('remove' in observation) {
        if (observation.remove) cron.delete(observation.remove);
      } else cron.set(observation.id ?? observation.at, observation);
    }
  }
  for (const observation of cron.values()) if (!matchingJob(doc, observation))
    issues.push(scheduleIssue(observation.at, 'pg_cron job must match a manifest jobs entry with its schedule and an app CLI command'));
  return issues;
}

function scheduledComponentIssues({ doc, environment, spec, model }: { doc: Parsed; environment: Parsed; spec: Parsed; model: Parsed }) {
  const issues = [], components = mapping(doc.components), services = mapping(model?.services);
  const selected = new Set([...Object.keys(mapping(spec.components)), ...Object.keys(services)]);
  for (const id of selected) {
    const component = mapping(components[id]), service = mapping(services[id]);
    const replicated = component.mode === 'replicated-job' || service.deploy?.mode === 'replicated-job';
    if (!replicated && component.schedule === undefined) continue;
    const job = matchingJob(doc, { id, component: true, cadence: component.schedule ?? null });
    const command = cliCommand(service.command);
    const commandMatches = !replicated || (command && cliCommand(job?.command) === command);
    if (!job || (job.component !== undefined && job.component !== id) || !commandMatches)
      issues.push(scheduleIssue(`environments.${environment}.components.${id}`, 'scheduled component must match a manifest job schedule; replicated-job must execute its declared app CLI command'));
  }
  return issues;
}

/** Recurring sources and rendered replicated-jobs name one manifest job and CLI action. */
export function scheduleIssues({ doc = {}, environment, spec = {}, model = {}, repoRoot, files = [], scanSources = true }: { doc?: Parsed; environment?: Parsed; spec?: Parsed; model?: Parsed; repoRoot: string; files?: string[]; scanSources?: Parsed }) {
  return [...jobIssues(doc), ...(scanSources ? recurringSourceIssues({ doc, repoRoot, files }) : []),
    ...scheduledComponentIssues({ doc, environment, spec, model })];
}

function findingOf(checked: Parsed) {
  const match = /^(.*\.(?:sql|[cm]?[jt]s)):(\d+)$/.exec(checked.at);
  const sourceFile = /\.(?:sql|[cm]?[jt]s)$/.test(checked.at) ? checked.at : null;
  const file = match?.[1] ?? sourceFile ?? DECLARATION;
  return found(checked.code, file, `${file}: ${checked.at}: ${checked.message}`);
}

/** Both editions receive real findings when a declared Swarm model cannot be judged. */
export function stacksReleaseFindings(context: Parsed) {
  if (context.isRoot === false || (context.repo?.profile && context.repo.profile !== 'app')) return [];
  const { doc, deployments, files } = stacksDeploymentContexts(context);
  const findings = scheduleIssues({ doc, repoRoot: context.repoRoot, files }).map(findingOf);
  for (const deployment of deployments) {
    const input = { ...deployment, doc, files, repoRoot: context.repoRoot };
    if (deployment.unavailable) findings.push(found('STACKS_MODEL_UNAVAILABLE', deployment.file,
      `${deployment.file}: environments.${deployment.environment}: a tracked rendered deployment model is required to judge Swarm safety`));
    findings.push(...releaseBackupIssues(input).map(findingOf), ...scheduledComponentIssues(input).map(findingOf));
  }
  return findings;
}
