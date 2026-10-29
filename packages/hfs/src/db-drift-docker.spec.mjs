// proves: BE_ENTITY_SCHEMA_DRIFT@lite
// `starci app db drift` end to end: the fixture app's migrations are applied to a scratch container of the image its .starcistacks declares
// (postgres:17-alpine) and its TypeORM entity is compared with the migrated schema. Which branch runs depends on the host and both are
// asserted: with a Docker daemon the matching app is green and a drifted copy is red with its three findings; without one the verb
// answers no verdict (exit 2, needs a database), which is the only other outcome it may give.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './main.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'db-drift');
const APP = path.join(FIXTURES, 'app');
const DOCKER = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;

async function drift(cwd) {
  let stdout = '';
  let stderr = '';
  const code = await main(['db', 'drift', '--json'], { cwd, stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
  return { code, stdout, stderr };
}

/** A copy of the fixture app (inside the package, so its be/ still reaches typeorm) whose migration drifts from the entity. */
function drifted(t) {
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
  assert.deepEqual(result.findings.map(({ code, kind, column }) => [code, kind, column]), [
    ['BE_ENTITY_SCHEMA_DRIFT', 'type-mismatch', 'total_cents'],
    ['BE_ENTITY_SCHEMA_DRIFT', 'nullable-mismatch', 'status'],
    ['BE_ENTITY_SCHEMA_DRIFT', 'missing-column', 'note'],
  ]);
});
