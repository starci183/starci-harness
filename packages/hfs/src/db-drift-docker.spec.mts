// proves: BE_ENTITY_SCHEMA_DRIFT@lite
// `starci app db drift` end to end: the fixture app's migrations are applied to a scratch container of the image its .starcistacks declares
// (postgres:17-alpine) and its TypeORM entity is compared with the migrated schema. Which branch runs depends on the host and both are
// asserted: with a Docker daemon the matching app is green and a drifted copy is red with its three findings; without one the verb
// answers no verdict (exit 2, needs a database), which is the only other outcome it may give.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { main } from './main.mjs';
import { CATALOG_SQL, compareEngineCatalog } from '../db/drift.mjs';
import type { EngineCatalog } from '../db/drift.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'db-drift');
const APP = path.join(FIXTURES, 'app');
const DOCKER = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;

async function drift(cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await main(['db', 'drift', '--json'], { cwd, stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
  return { code, stdout, stderr };
}

/** A copy of the fixture app (inside the package, so its be/ still reaches typeorm) whose migration drifts from the entity. */
function drifted(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(FIXTURES, '.run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(APP, root, { recursive: true });
  const migration = path.join(root, 'db', 'migrations', '20261029000000_orders.sql');
  fs.writeFileSync(migration, fs.readFileSync(migration, 'utf8')
    .replace('total_cents bigint not null', 'total_cents text not null')
    .replace('    note text,\n', '')
    .replace('status varchar(32) not null', 'status varchar(32)'));
  return root;
}

test('the matching fixture app is green against its migrated scratch database', { timeout: 300_000 }, async () => {
  const run = await drift(APP);
  if (!DOCKER) {
    assert.equal(run.code, 2);
    assert.match(run.stderr, /needs a database/u);
    return;
  }
  assert.equal(run.code, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.columns, 8);
  assert.deepEqual(result.findings, []);
});

test('a type mismatch, a missing column and a nullability mismatch are red against the migrated scratch database', { timeout: 300_000 }, async (t) => {
  const run = await drift(drifted(t));
  if (!DOCKER) {
    assert.equal(run.code, 2);
    assert.match(run.stderr, /needs a database/u);
    return;
  }
  assert.equal(run.code, 1, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.deepEqual(result.findings.map(({ code, kind, column }: { code: string; kind: string; column: string }) => [code, kind, column]), [
    ['BE_ENTITY_SCHEMA_DRIFT', 'type-mismatch', 'total_cents'],
    ['BE_ENTITY_SCHEMA_DRIFT', 'nullable-mismatch', 'status'],
    ['BE_ENTITY_SCHEMA_DRIFT', 'missing-column', 'note'],
  ]);
});

// A partitioned parent's CHECKs are inherited by every partition (conislocal false there); only a CHECK local to the partition is its own.
test('the CHECKs of a partitioned parent are not reported on its partitions, a local CHECK the manifest lacks still is', { timeout: 300_000 }, async (t) => {
  if (!DOCKER) return;
  const name = `starci-hx-checks-${process.pid}`;
  const run = spawnSync('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=spec', '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  t.after(() => { spawnSync('docker', ['rm', '-f', name]); });
  const port = Number(/:(\d+)\s*$/mu.exec(String(spawnSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' }).stdout).split('\n')[0] ?? '')?.[1]);
  const { Client } = createRequire(path.join(APP, 'be', 'package.json'))('pg');
  let client: InstanceType<typeof Client> | undefined;
  for (let attempt = 0; attempt < 60 && !client; attempt += 1) {
    const candidate = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'spec', database: 'postgres' });
    candidate.on('error', () => {});
    try { await candidate.connect(); await candidate.query('select 1'); client = candidate; }
    catch { await candidate.end().catch(() => {}); await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  assert.ok(client, 'the scratch database accepted no connection');
  t.after(() => client.end());
  await client.query(`create table records (id int not null, entity text not null, data jsonb not null,
      constraint records_data_check check (jsonb_typeof(data) = 'object'), constraint records_entity_check check (entity <> '')) partition by list (entity);
    create table records_order partition of records for values in ('order');
    create table records_note partition of records for values in ('note');
    alter table records_order add constraint records_order_stray_check check (id > 0);`);
  const rows = (await client.query(CATALOG_SQL.checks)).rows;
  assert.deepEqual(rows.map((row: { relation: string; name: string }) => `${row.relation}.${row.name}`).sort(),
    ['records.records_data_check', 'records.records_entity_check', 'records_order.records_order_stray_check']);
  const catalog: EngineCatalog = { partitions: [{ name: 'records_order', parent: 'records' }, { name: 'records_note', parent: 'records' }], views: [], checks: rows, indexes: [] };
  const engine = { capability: 'entity-engine', tables: ['records'], partitionsOf: 'records', views: 'v_*', manifest: '.starciwork/entities.manifest.json' };
  const manifest = { version: 1 as const, entities: [{ entity: 'order', partition: 'records_order' }, { entity: 'note', partition: 'records_note' }] };
  assert.deepEqual(compareEngineCatalog(engine, manifest, catalog).map(({ kind, table }) => `${kind} ${table}`), ['check-undeclared records_order.records_order_stray_check']);
});
