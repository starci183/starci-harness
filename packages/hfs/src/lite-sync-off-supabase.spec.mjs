// proves: LITE_DB_MIGRATION@lite
// A lite app synced by @starci/hfs 4.10 holds no Supabase reference in its managed files (ruling lite-self-hosted-postgres-passport-minio):
// the db scripts, codegen and CI name the self-hosted database through `starci app db ... --url-env DATABASE_URL`, and sync deletes a
// leftover supabase/types/. The one sanctioned mention is db/bootstrap.sql, which recreates the objects migrations written for a
// hosted Supabase reference, and the db image reference `supabase/postgres`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTargets, retiredFiles } from '../sync/index.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { starterDeclaration } from '../scaffold/app.mjs';

const lite = starterDeclaration('demo', undefined, 'lite');
const targets = renderTargets(lite, bundledPresets(), { source: { files: [], read: () => '' } });
const byPath = new Map(targets.map((target) => [target.path, target]));

test('a lite app on hfs 4.10 has no Supabase reference in its managed files but the bootstrap and the db image', () => {
  for (const target of targets) {
    if (target.path === 'db/bootstrap.sql') continue;
    const text = String(target.content).replaceAll('supabase/postgres', '');
    assert.equal(/supabase/i.test(text), false, `${target.path} names Supabase`);
  }
  assert.ok(byPath.has('db/bootstrap.sql'), 'the bootstrap is managed');
});

test('the managed db scripts, codegen and CI drive the self-hosted database', () => {
  const scripts = String(byPath.get('package.json').content);
  for (const script of ['db:push: starci app db migrate --url-env DATABASE_URL --execute', 'db:new: starci app db new', 'db:plan: starci app db plan --url-env DATABASE_URL', 'db:dump: starci app db dump --url-env DATABASE_URL', 'db:start: docker start demo-dev-db']) {
    assert.ok(scripts.includes(script), script);
  }
  assert.equal(scripts.includes('db:types'), false);
  assert.ok(String(byPath.get('.github/workflows/db-deploy.yml').content).includes('starci app db migrate --url-env DATABASE_URL'));
  assert.equal(String(byPath.get('.github/workflows/ci.yml').content).includes('db-types'), false);
  assert.equal(String(byPath.get('scripts/codegen.mjs').content).includes('database.types'), false);
  assert.deepEqual(lite.sides.fe.reads, ['be/contracts/']);
  assert.equal(lite.sides.be.connections[0].provider, 'postgres');
});

test('sync retires a leftover supabase/types of a lite app, and only of a lite app', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lite-retired-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'supabase', 'types'), { recursive: true });
  fs.writeFileSync(path.join(root, 'supabase', 'types', 'database.types.ts'), 'export type Database = {};\n');
  assert.deepEqual(retiredFiles(root, { edition: 'lite' }), ['supabase/types/database.types.ts']);
  assert.deepEqual(retiredFiles(root, { edition: 'full' }), []);
});
