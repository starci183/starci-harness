// Literal service event tables share the vendored contract with typed event classes.
import { isDeepStrictEqual } from 'node:util';
import { nameText } from '../../lib/ts-ast.mjs';
import { found, readJson, readText } from './read.mjs';
import type { Parsed, Ts } from './rule-types.mjs';

const CODE = 'HFS_EVENT_CONTRACT';
const TABLE = /^be\/apps\/([^/]+)\/src\/(events|consumes)\.ts$/;
const SNAPSHOT = /^be\/contracts\/([^/]+)\/events\.json$/;

function literal(ts: Ts, node: Parsed): Parsed {
  if (!node) throw new Error('missing initializer');
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return literal(ts, node.expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (!ts.isObjectLiteralExpression(node)) throw new Error('expected a literal object, string or number');
  return Object.fromEntries(node.properties.map((property: Parsed): Parsed => {
    const key = nameText(ts, property.name);
    if (!ts.isPropertyAssignment(property) || key === null) throw new Error('expected a named literal property');
    return [key, literal(ts, property.initializer)];
  }));
}

function tableOf(ts: Ts, text: string, name: string) {
  const source = ts.createSourceFile('table.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) throw new Error('invalid TypeScript');
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find((entry: Parsed) => ts.isIdentifier(entry.name) && entry.name.text === name);
    if (declaration) {
      const value = literal(ts, declaration.initializer);
      if (value === null || typeof value !== 'object') throw new Error('expected a literal table');
      return value;
    }
  }
  throw new Error(`missing ${name} table`);
}

function readTables(ts: Ts, repoRoot: string, files: string[]) {
  const tables = [];
  const findings = [];
  for (const file of files.filter((candidate: Parsed) => TABLE.test(candidate))) {
    const [, service, kind] = TABLE.exec(file)!;
    try {
      const name = kind === 'events' ? 'EVENTS' : 'CONSUMES';
      tables.push({ file, service, kind, value: tableOf(ts, readText(repoRoot, file) ?? '', name) });
    } catch (error) {
      findings.push(found(CODE, file, `${file}: ${(error as Error).message}; declare a literal event contract table.`));
    }
  }
  return { tables, findings };
}

function providerFindings(table: Parsed, snapshots: Parsed, declared: Parsed) {
  const findings = [];
  const expected = { schema: 'starci/event-contract@1', service: table.service, events: table.value };
  if (!isDeepStrictEqual(snapshots.get(table.service), expected)) {
    findings.push(found(CODE, table.file, `${table.file}: be/contracts/${table.service}/events.json is missing or differs from EVENTS; commit the emitted provider snapshot.`));
  }
  for (const [name, event] of Object.entries<Parsed>(table.value)) {
    if (!Number.isInteger(event?.version) || event.version < 1 || !event.payload || typeof event.payload !== 'object') {
      findings.push(found(CODE, table.file, `${table.file}: ${name} needs a positive integer version and a literal payload.`));
    }
    if (event?.compensates !== undefined && !declared.has(event.compensates)) {
      findings.push(found(CODE, table.file, `${table.file}: ${name} compensates undeclared event ${event.compensates}.`));
    }
  }
  return findings;
}

function consumerFindings(table: Parsed, snapshots: Parsed) {
  const findings = [];
  for (const [provider, events] of Object.entries<Parsed>(table.value)) {
    if (events === null || typeof events !== 'object') {
      findings.push(found(CODE, table.file, `${table.file}: CONSUMES.${provider} must be a literal event/version table.`));
      continue;
    }
    for (const [name, version] of Object.entries<Parsed>(events)) {
      const snapshot = snapshots.get(provider);
      const event = snapshot?.events?.[name];
      if (snapshot?.schema !== 'starci/event-contract@1' || snapshot?.service !== provider || !event || event.version !== version) {
        findings.push(found(CODE, table.file, `${table.file}: ${provider} event ${name} at version ${version} is not declared by its vendored snapshot.`));
      }
    }
  }
  return findings;
}

export function eventTableFindings({ ts, repoRoot, files }: { ts: Ts; repoRoot: string; files: string[] }) {
  const snapshots = new Map(files.filter((file: string) => SNAPSHOT.test(file))
    .map((file: string) => [SNAPSHOT.exec(file)![1], readJson(repoRoot, file)]));
  const declared = new Set([...snapshots.values()].flatMap((snapshot) => Object.keys(snapshot?.events ?? {})));
  const { tables, findings } = readTables(ts, repoRoot, files);
  for (const table of tables) {
    findings.push(...(table.kind === 'events' ? providerFindings(table, snapshots, declared) : consumerFindings(table, snapshots)));
  }
  return findings;
}

export const eventTableServices = (files: string[]) => files.filter((file: string) => TABLE.test(file) && TABLE.exec(file)![2] === 'events')
  .map((file: string) => TABLE.exec(file)![1]);
