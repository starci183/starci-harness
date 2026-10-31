// proves: LITE_DB_MIGRATION@lite
// A lite app synced by @starci/hfs 4.10 holds no Supabase reference in its managed files (ruling lite-self-hosted-postgres-passport-minio):
// the db scripts, codegen and CI name the self-hosted database through `starci app db ... --db-url-env DATABASE_URL`, and sync deletes a
// leftover supabase/types/. The one sanctioned mention is db/bootstrap.sql, which recreates the objects migrations written for a
// hosted Supabase reference. The db image is the official postgres image of the managed .starcistacks/images/db/Dockerfile (rulings
// lite-official-postgres-image and lite-db-image-in-stacks), and sync retires a leftover db/Dockerfile.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppSourceFacts, RenderedTarget } from '../sync/index.mjs';
import { PGMQ, renderTargets, retiredFiles } from '../sync/index.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { starterDeclaration } from '../scaffold/app.mjs';

const lite = starterDeclaration('demo', undefined, 'lite');
// reason: the spec renders from a source with no files, so the source facts are the minimal pair sync reads, not a full AppSourceFacts.
const targets = renderTargets(lite, bundledPresets(), { source: { files: [], read: () => '' } as unknown as AppSourceFacts });
const byPath = new Map(targets.map((target): [string, RenderedTarget] => [target.path, target]));
/** The rendered target at `file`; a spec that names an unrendered file fails here, as reading its content would. */
const targetAt = (file: string): RenderedTarget => byPath.get(file) as RenderedTarget;

test('a lite app has no Supabase reference in its managed files but the bootstrap', () => {
  for (const target of targets) {
    if (target.path === 'db/bootstrap.sql') continue;
    assert.equal(/supabase/i.test(String(target.content)), false, `${target.path} names Supabase`);
  }
  assert.ok(byPath.has('db/bootstrap.sql'), 'the bootstrap is managed');
  assert.equal(byPath.has('db/Dockerfile'), false, 'db/ keeps schema and data only');
});

test('the managed .starcistacks/images/db/Dockerfile builds the digest-pinned official postgres image plus pgvector and the checksum-verified pgmq release, and the local db container runs it', () => {
  const dockerfile = String(targetAt('.starcistacks/images/db/Dockerfile').content);
  assert.match(dockerfile, /^FROM postgres:17\.\d+@sha256:[a-f0-9]{64}$/mu);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends postgresql-17-pgvector=\S+/u);
  // pgmq is the event bus (ruling lite-pgmq-bus-bullmq-jobs): its pinned release source, added only when its sha256 matches.
  assert.ok(dockerfile.includes(`ADD --checksum=sha256:${PGMQ.sha256} ${PGMQ.source} /tmp/pgmq.tar.gz`));
  assert.ok(dockerfile.includes(`pgmq.sql "$extension/pgmq--${PGMQ.version}.sql"`));
  assert.equal(/pg_cron|pg_net|shared_preload_libraries/u.test(dockerfile), false, 'pgvector and pgmq are the extensions the image adds');
  const scripts = String(targetAt('package.json').content);
  assert.match(scripts, /^db:image: docker build --tag demo-db:local \.starcistacks\/images\/db$/mu);
  assert.match(scripts, /^db:create: npm run db:image && docker create .* demo-db:local$/mu);
  assert.match(String(targetAt('.github/workflows/images.yml').content), /- name: db\n\s+file: \.starcistacks\/images\/db\/Dockerfile/u, 'the release builds the db image beside the app images');
});

test('the managed db scripts, codegen and CI drive the self-hosted database', () => {
  const scripts = String(targetAt('package.json').content);
  for (const script of ['db:push: starci app db migrate --db-url-env DATABASE_URL --execute', 'db:new: starci app db new', 'db:plan: starci app db migrate --db-url-env DATABASE_URL', 'db:dump: starci app db dump --db-url-env DATABASE_URL', 'db:start: docker start demo-dev-db']) {
    assert.ok(scripts.includes(script), script);
  }
  assert.equal(scripts.includes('db:types'), false);
  // The database deploy workflow is retired: the stack deploy backs up and migrates inside the database container (ruling app-cicd-auto-deploy).
  assert.equal(byPath.has('.github/workflows/db-deploy.yml'), false);
  assert.ok(String(targetAt('.github/workflows/stack-deploy.yml').content).includes('starci app stack deploy'));
  assert.equal(String(targetAt('.github/workflows/ci.yml').content).includes('db-types'), false);
  assert.equal(String(targetAt('scripts/codegen.mjs').content).includes('database.types'), false);
  assert.deepEqual(lite.sides.fe.reads, ['be/contracts/']);
  assert.equal((lite.sides.be.connections[0] as { provider?: string } | undefined)?.provider, 'postgres');
});

test('sync retires a leftover supabase/types of a lite app, and only of a lite app', (t: TestContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lite-retired-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'supabase', 'types'), { recursive: true });
  fs.writeFileSync(path.join(root, 'supabase', 'types', 'database.types.ts'), 'export type Database = {};\n');
  assert.deepEqual(retiredFiles(root, { edition: 'lite' }), ['supabase/types/database.types.ts']);
  assert.deepEqual(retiredFiles(root, { edition: 'full' }), []);
});

test('sync retires the db/Dockerfile a lite app kept before the db image moved into the stacks (ruling lite-db-image-in-stacks)', (t: TestContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lite-retired-image-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'db', 'Dockerfile'), 'FROM postgres:17\n');
  fs.writeFileSync(path.join(root, 'db', 'migrations', '20261029000000_init.sql'), 'select 1;\n');
  assert.deepEqual(retiredFiles(root, { edition: 'lite' }), ['db/Dockerfile']);
  assert.deepEqual(retiredFiles(root, { edition: 'full' }), []);
});
