// proves: BE_ENTITY_SCHEMA_DRIFT@lite
// `starci app db drift` without a database: the fixture app's entities go through TypeORM's real metadata (the package's own typeorm and
// typescript, reached from the fixture's be/), the migrated schema is a stubbed introspection, and the verb's refusal paths run through
// an injected spawn, so no Docker or database is reached here (src/db-drift-docker.spec.mjs is the one that migrates a real database).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './main.mjs';
import type { VerbContext, VerbResult } from '../release/index.mjs';
import { compareSchema, driftCheck, loadEntityColumns, migrationFiles } from '../db/drift.mjs';
import type { DriftFinding, EntityColumn, SchemaColumn } from '../db/drift.mjs';
import { normalizeRelease } from '../release/gate.mjs';
import { ciWorkflowCommands } from '../sync/ci-commands.mjs';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'db-drift', 'app');

/** The rows SCHEMA_SQL answers for the fixture's migrations: the orders table, with updated_at that no entity maps. */
const SCHEMA: readonly SchemaColumn[] = Object.freeze(([
  ['id', 'uuid', false], ['workspace_id', 'uuid', false], ['total_cents', 'bigint', false], ['status', 'character varying', false],
  ['kind', 'enum', false, 'order_kind'], ['note', 'text', true], ['tags', 'text[]', false], ['created_at', 'timestamp with time zone', false],
  ['updated_at', 'timestamp with time zone', false],
] as [string, string, boolean, string?][]).map(([column, type, nullable, enumName = null]): SchemaColumn => ({ schema: 'public', table: 'orders', column, type, nullable, enumName, view: false })));

const schemaWith = (change: (row: SchemaColumn) => SchemaColumn | null) => SCHEMA.flatMap((row) => change(row) ?? []);
const stubbed = (columns: readonly SchemaColumn[]) => async () => ({ columns: columns as SchemaColumn[], files: ['db/bootstrap.sql', 'db/migrations/20261029000000_orders.sql'], how: 'a stubbed schema' });
// reason: the verb hands the stack context a fuller shape, but the drift check reads only cwd and the injected schema seam.
const ctxOf = (cwd: string) => ({ cwd }) as unknown as VerbContext;
// data and lines are optional on VerbResult; a drift result always carries both.
const dataOf = (result: VerbResult) => result.data as { findings: DriftFinding[] };
const linesOf = (result: VerbResult) => result.lines ?? [];
const kinds = (result: VerbResult) => dataOf(result).findings.map(({ kind, column }) => `${kind} ${column}`);

test('TypeORM metadata of the fixture entity normalises to the format_type spellings', async () => {
  const columns = await loadEntityColumns(APP);
  assert.deepEqual(columns.map(({ column, type, nullable, enumName }) => [column, type, nullable, enumName]), [
    ['id', 'uuid', false, null], ['workspace_id', 'uuid', false, null], ['total_cents', 'bigint', false, null],
    ['status', 'character varying', false, null], ['kind', 'enum', false, 'order_kind'], ['note', 'text', true, null],
    ['tags', 'text[]', false, null], ['created_at', 'timestamp with time zone', false, null],
  ]);
  assert.ok(columns.every((column) => column.entity === 'OrderEntity' && column.schema === 'public' && column.table === 'orders'));
});

test('a matching entity is green, and a schema column no entity maps is fine', async () => {
  const result = await driftCheck(ctxOf(APP), { schema: stubbed(SCHEMA) });
  assert.equal(result.ok, true);
  assert.deepEqual(dataOf(result).findings, []);
  assert.match(linesOf(result).at(-1) ?? '', /^green/u);
});

test('a type mismatch is red', async () => {
  const result = await driftCheck(ctxOf(APP), { schema: stubbed(schemaWith((row) => (row.column === 'total_cents' ? { ...row, type: 'text' } : row))) });
  assert.equal(result.ok, false);
  assert.deepEqual(kinds(result), ['type-mismatch total_cents']);
  assert.equal(dataOf(result).findings[0]!.code, 'BE_ENTITY_SCHEMA_DRIFT');
  assert.match(linesOf(result).join('\n'), /BE_ENTITY_SCHEMA_DRIFT OrderEntity public\.orders\.total_cents: type mismatch: entity bigint, schema text/u);
});

test('a missing column is red', async () => {
  const result = await driftCheck(ctxOf(APP), { schema: stubbed(schemaWith((row) => (row.column === 'note' ? null : row))) });
  assert.deepEqual(kinds(result), ['missing-column note']);
});

test('a nullability mismatch is red', async () => {
  const result = await driftCheck(ctxOf(APP), { schema: stubbed(schemaWith((row) => (row.column === 'status' ? { ...row, nullable: true } : row))) });
  assert.deepEqual(kinds(result), ['nullable-mismatch status']);
});

test('a missing table is one finding, and enums match by type and name', () => {
  const entity = (column: string, type: string, extra: Partial<EntityColumn> = {}): EntityColumn => ({ entity: 'E', schema: 'public', table: 't', column, type, enumName: null, nullable: false, view: false, ...extra });
  const row = (column: string, type: string, extra: Partial<SchemaColumn> = {}): SchemaColumn => ({ schema: 'public', table: 't', column, type, enumName: null, nullable: false, view: false, ...extra });
  assert.deepEqual(compareSchema([entity('a', 'uuid'), entity('b', 'text')], []).map(({ kind }) => kind), ['missing-table']);
  assert.deepEqual(compareSchema([entity('k', 'enum', { enumName: 'kind' })], [row('k', 'enum', { enumName: 'kind' })]), []);
  assert.deepEqual(compareSchema([entity('k', 'enum', { enumName: 'kind' })], [row('k', 'enum', { enumName: 'other' })]).map(({ kind }) => kind), ['type-mismatch']);
  assert.deepEqual(compareSchema([entity('k', 'enum')], [row('k', 'text')]).map(({ kind }) => kind), ['type-mismatch']);
  assert.deepEqual(compareSchema([entity('v', 'text', { nullable: false })], [row('v', 'text', { nullable: true, view: true })]), []);
});

test('the scratch database receives db/bootstrap.sql, then the active migrations in stamp order', () => {
  assert.deepEqual(migrationFiles(APP), ['db/bootstrap.sql', 'db/migrations/20261029000000_orders.sql']);
});

test('an app without an entity list is green with nothing to compare', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let stdout = '';
  const code = await main(['db', 'drift'], { cwd: root, stdout: (text) => { stdout += text; }, stderr: () => {} });
  assert.equal(code, 0);
  assert.match(stdout, /no entity list/u);
});

test('without Docker the verb reaches no verdict: exit 2, needs a database, never green', async () => {
  let stderr = '';
  const spawn = (command: string) => (command === 'docker' ? { status: null, stdout: '', stderr: '', error: new Error('spawn docker ENOENT') } : { status: 0, stdout: '', stderr: '' });
  const code = await main(['db', 'drift'], { cwd: APP, stdout: () => {}, stderr: (text) => { stderr += text; }, stackIo: { spawn } });
  assert.equal(code, 2);
  assert.match(stderr, /DB_DRIFT_NEEDS_DATABASE: needs a database: Docker is not available/u);
});

test('--db-url-env names an UPPER_CASE variable holding a postgres URL, else no verdict', async () => {
  let stderr = '';
  const code = await main(['db', 'drift', '--db-url-env', 'DRIFT_SCRATCH_URL'], { cwd: APP, env: {}, stdout: () => {}, stderr: (text) => { stderr += text; } });
  assert.equal(code, 2);
  assert.match(stderr, /needs a database: DRIFT_SCRATCH_URL holds no postgres connection URL/u);
});

test('an app with an entity list runs the drift row in its release gate, default or declared', () => {
  const names = (block: unknown, entities: boolean) => normalizeRelease(block, {}, { audit: { mode: 'disabled' } }, { entities }).config!.gates.map((gate) => gate.name);
  assert.deepEqual(names({}, true), ['app-check', 'db-drift']);
  assert.deepEqual(names({}, false), ['app-check']);
  assert.deepEqual(names({ gates: [{ name: 'unit', command: ['unit-probe'] }] }, true), ['unit', 'db-drift']);
  const row = normalizeRelease({}, {}, { audit: { mode: 'disabled' } }, { entities: true }).config!.gates.at(-1)!;
  assert.deepEqual(row.command, ['npx', 'starci', 'app', 'db', 'drift']);
});

test('the managed CI database step runs the drift check for an app with an entity list', () => {
  const step = (files: string[]) => ciWorkflowCommands({ files, read: () => '' }).ciDatabaseLint;
  assert.equal(step(['src/modules/platform/database/entities.ts']), 'npm run db:lint && npx starci app db drift');
  assert.equal(step(['src/main.ts']), 'npm run db:lint');
});

/** Installs `name` into `be/node_modules` as a shim of this package's own install, the way an app's `npm ci` provides it. */
const shimPackage = (be: string, name: string) => {
  const target = path.join(be, 'node_modules', name);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({ name, main: 'index.js' })}\n`);
  fs.writeFileSync(path.join(target, 'index.js'), `module.exports = require(${JSON.stringify(createRequire(import.meta.url).resolve(name))});\n`);
};

test('the columns a table entity inherits from the entity base of platform/database are compared like its own', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-drift-base-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const be = path.join(root, 'be');
  const templates = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'be');
  const files = {
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { paths: { '@modules/*': ['./src/modules/*'] } } })}\n`,
    'src/modules/platform/database/abstract.entity.ts': fs.readFileSync(path.join(templates, 'skeleton', 'src', 'modules', 'platform', 'database', 'abstract.entity.ts'), 'utf8'),
    'src/modules/platform/database/index.ts': 'export { UuidAbstractEntity } from "./abstract.entity"\n',
    'src/modules/platform/database/entities.ts': 'import { widgetsEntities } from "@modules/domain/widgets/persistence/entities"\n\nexport const PRIMARY_ENTITIES = [...widgetsEntities]\n',
    'src/modules/domain/widgets/persistence/entities/index.ts': 'import { WidgetEntity } from "./widgets.entity"\n\nexport const widgetsEntities = [WidgetEntity]\n',
    'src/modules/domain/widgets/persistence/entities/widgets.entity.ts': fs.readFileSync(path.join(templates, 'table', 'entity.ts.tpl'), 'utf8')
      .replaceAll('{{table}}', 'widgets').replaceAll('{{Singular}}', 'Widget'),
  };
  for (const [relative, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(be, relative)), { recursive: true });
    fs.writeFileSync(path.join(be, relative), text);
  }
  fs.writeFileSync(path.join(be, 'package.json'), '{"name":"be","private":true}\n');
  for (const name of ['typescript', 'typeorm', 'reflect-metadata', 'pg']) shimPackage(be, name);
  const columns = await loadEntityColumns(root);
  assert.deepEqual(columns.map(({ column, type, nullable }): [string, string, boolean] => [column, type, nullable]).sort(([a], [b]) => a.localeCompare(b)), [
    ['created_at', 'timestamp with time zone', false], ['id', 'uuid', false], ['owner_id', 'uuid', false], ['updated_at', 'timestamp with time zone', false],
  ]);
  assert.ok(columns.every((column) => column.entity === 'WidgetEntity' && column.table === 'widgets'), 'the base maps no table of its own');
  const schema = columns.map(({ column, type, nullable }) => ({ schema: 'public', table: 'widgets', column, type, nullable, enumName: null, view: false }));
  const missing = await driftCheck(ctxOf(root), { entityColumns: async () => columns, schema: stubbed(schema.filter((row) => row.column !== 'updated_at')) });
  assert.deepEqual(kinds(missing), ['missing-column updated_at']);
});
