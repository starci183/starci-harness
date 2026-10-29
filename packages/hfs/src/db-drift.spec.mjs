// proves: BE_ENTITY_SCHEMA_DRIFT@lite
// `starci app db drift` without a database: the fixture app's entities go through TypeORM's real metadata (the package's own typeorm and
// typescript, reached from the fixture's be/), the migrated schema is a stubbed introspection, and the verb's refusal paths run through
// an injected spawn, so no Docker or database is reached here (src/db-drift-docker.spec.mjs is the one that migrates a real database).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './main.mjs';
import { compareSchema, driftCheck, loadEntityColumns, migrationFiles } from '../db/drift.mjs';
import { normalizeRelease } from '../release/gate.mjs';
import { ciWorkflowCommands } from '../sync/ci-commands.mjs';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'db-drift', 'app');

/** The rows SCHEMA_SQL answers for the fixture's migrations: the orders table, with updated_at that no entity maps. */
const SCHEMA = Object.freeze([
  ['id', 'uuid', false], ['workspace_id', 'uuid', false], ['total_cents', 'bigint', false], ['status', 'character varying', false],
  ['kind', 'enum', false, 'order_kind'], ['note', 'text', true], ['tags', 'text[]', false], ['created_at', 'timestamp with time zone', false],
  ['updated_at', 'timestamp with time zone', false],
].map(([column, type, nullable, enumName = null]) => ({ schema: 'public', table: 'orders', column, type, nullable, enumName, view: false })));

const schemaWith = (change) => SCHEMA.flatMap((row) => change(row) ?? []);
const stubbed = (columns) => async () => ({ columns, files: ['db/bootstrap.sql', 'db/migrations/20261029000000_orders.sql'], how: 'a stubbed schema' });
const kinds = (result) => result.data.findings.map(({ kind, column }) => `${kind} ${column}`);

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
  const result = await driftCheck({ cwd: APP }, { schema: stubbed(SCHEMA) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.findings, []);
  assert.match(result.lines.at(-1), /^green/u);
});

test('a type mismatch is red', async () => {
  const result = await driftCheck({ cwd: APP }, { schema: stubbed(schemaWith((row) => (row.column === 'total_cents' ? { ...row, type: 'text' } : row))) });
  assert.equal(result.ok, false);
  assert.deepEqual(kinds(result), ['type-mismatch total_cents']);
  assert.equal(result.data.findings[0].code, 'BE_ENTITY_SCHEMA_DRIFT');
  assert.match(result.lines.join('\n'), /BE_ENTITY_SCHEMA_DRIFT OrderEntity public\.orders\.total_cents: type mismatch: entity bigint, schema text/u);
});

test('a missing column is red', async () => {
  const result = await driftCheck({ cwd: APP }, { schema: stubbed(schemaWith((row) => (row.column === 'note' ? null : row))) });
  assert.deepEqual(kinds(result), ['missing-column note']);
});

test('a nullability mismatch is red', async () => {
  const result = await driftCheck({ cwd: APP }, { schema: stubbed(schemaWith((row) => (row.column === 'status' ? { ...row, nullable: true } : row))) });
  assert.deepEqual(kinds(result), ['nullable-mismatch status']);
});

test('a missing table is one finding, and enums match by type and name', () => {
  const entity = (column, type, extra = {}) => ({ entity: 'E', schema: 'public', table: 't', column, type, enumName: null, nullable: false, view: false, ...extra });
  const row = (column, type, extra = {}) => ({ schema: 'public', table: 't', column, type, enumName: null, nullable: false, view: false, ...extra });
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
  const spawn = (command) => (command === 'docker' ? { status: null, stdout: '', stderr: '', error: new Error('spawn docker ENOENT') } : { status: 0, stdout: '', stderr: '' });
  const code = await main(['db', 'drift'], { cwd: APP, stdout: () => {}, stderr: (text) => { stderr += text; }, stackIo: { spawn } });
  assert.equal(code, 2);
  assert.match(stderr, /DB_DRIFT_NEEDS_DATABASE: needs a database: Docker is not available/u);
});

test('--url-env names an UPPER_CASE variable holding a postgres URL, else no verdict', async () => {
  let stderr = '';
  const code = await main(['db', 'drift', '--url-env', 'DRIFT_SCRATCH_URL'], { cwd: APP, env: {}, stdout: () => {}, stderr: (text) => { stderr += text; } });
  assert.equal(code, 2);
  assert.match(stderr, /needs a database: DRIFT_SCRATCH_URL holds no postgres connection URL/u);
});

test('an app with an entity list runs the drift row in its release gate, default or declared', () => {
  const names = (block, entities) => normalizeRelease(block, {}, { audit: { mode: 'disabled' } }, { entities }).config.gates.map((gate) => gate.name);
  assert.deepEqual(names({}, true), ['app-check', 'db-drift']);
  assert.deepEqual(names({}, false), ['app-check']);
  assert.deepEqual(names({ gates: [{ name: 'unit', command: ['unit-probe'] }] }, true), ['unit', 'db-drift']);
  const row = normalizeRelease({}, {}, { audit: { mode: 'disabled' } }, { entities: true }).config.gates.at(-1);
  assert.deepEqual(row.command, ['npx', 'starci', 'app', 'db', 'drift']);
});

test('the managed CI database step runs the drift check for an app with an entity list', () => {
  const step = (files) => ciWorkflowCommands({ files, read: () => '' }).ciDatabaseLint;
  assert.equal(step(['src/platform/database/entities.ts']), 'npm run db:lint && npx starci app db drift');
  assert.equal(step(['src/main.ts']), 'npm run db:lint');
});
