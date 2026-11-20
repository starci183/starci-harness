// `starci app stack db-upgrade` (PROJECT-STACKS-19) never invents a volume and never switches to a restore it did not prove: the pair comes from the
// declaration (deploy.dbUpgrade or deploy.renamedFrom) or the verb refuses with the YAML to add; the comparison of the old and the restored cluster refuses
// any difference of rows, sequences, objects, roles or password hashes, and lets only an extension's version change; the sealed superuser password must be
// the version the service runs. The container choreography itself is proven against real throwaway containers (the lane report), not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeployConfig } from '../stack/config.mjs';
import { inventoryProblems, parseCluster, parseDatabase } from '../stack/db-upgrade-core.mjs';
import type { ClusterInventory } from '../stack/db-upgrade-core.mjs';
import { sealedPassword, upgradePair } from '../stack/db-upgrade.mjs';
import { normalizeDeploy } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { normalizeLocal } from '../runtime/scripts/hfs/stack-local-config.mjs';

const STACK = ['services:', '  db:', '    image: shop/db', '    volumes:', '      - db-data:/var/lib/postgresql/data', 'volumes:', '  db-data:', '    external: true', '    name: shop-production-db-data', ''].join('\n');

function config(t: test.TestContext, extra: Partial<DeployConfig>): DeployConfig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stackFile = path.join(dir, 'stack.yaml');
  fs.writeFileSync(stackFile, STACK);
  return { env: 'production', stack: 'shop-production', stackFile, volumes: ['shop-production-db-data'], ...extra } as DeployConfig;
}

const cluster = (rows: number, digest = 'a'.repeat(64), version = '0.8.0'): ClusterInventory => ({
  databases: { shop: { extensions: { plpgsql: '1.0', vector: version }, rows: { 'public.orders': rows, 'public.items': 3 }, sequences: { 'public.orders_id_seq': `${rows}|t` }, objects: { r: 2, i: 2, S: 1, function: 4 } } },
  roles: { count: 3, digest }, members: { count: 1, digest: 'b'.repeat(64) },
});

test('the volume pair comes from the declaration, never from a guess', (t) => {
  const none = config(t, {});
  assert.throws(() => upgradePair(none, 'db'), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'STACK_DB_UPGRADE_UNDECLARED');
    assert.match(error.message, /never guesses a volume name/);
    assert.match(error.message, /dbUpgrade:\n {8}volumes:\n {10}shop-production-db-data: <the old volume/);
    return true;
  });
  assert.deepEqual(upgradePair(config(t, { dbUpgrade: { volumes: { 'shop-production-db-data': 'shop-production-postgres-data' } } }), 'db'), { from: 'shop-production-postgres-data', to: 'shop-production-db-data', mount: '/var/lib/postgresql/data', declaredIn: 'dbUpgrade', sourceStack: 'shop-production' });
  const renamed = config(t, { renamedFrom: { stack: 'shop-old', releasesBase: '/srv/shop-old', volumes: { 'shop-production-db-data': 'shop-old-db-data' } } });
  assert.deepEqual(upgradePair(renamed, 'db'), { from: 'shop-old-db-data', to: 'shop-production-db-data', mount: '/var/lib/postgresql/data', declaredIn: 'renamedFrom', sourceStack: 'shop-old' });
  assert.throws(() => upgradePair(config(t, { dbUpgrade: { volumes: { 'shop-production-other': 'shop-production-postgres-data' } } }), 'db'), /mounts shop-production-db-data as the data directory of db/);
});

test('deploy.dbUpgrade maps one declared new volume to another old one', () => {
  const probe = { exists: () => true, services: new Set(['db']), members: new Set<string>() };
  const problems = (dbUpgrade: unknown): string[] => normalizeDeploy({ stack: 'shop-production', volumes: ['shop-production-db-data'], dbUpgrade }, { project: 'shop', probe }).problems.map((item: { at: string; message: string }) => `${item.at}: ${item.message}`);
  assert.deepEqual(problems({ volumes: { 'shop-production-db-data': 'shop-production-postgres-data' } }), []);
  assert.match(problems({ volumes: { 'shop-production-other': 'old' } }).join('\n'), /is not a volume of deploy\.volumes/);
  assert.match(problems({ volumes: { 'shop-production-db-data': 'shop-production-db-data' } }).join('\n'), /the old volume is the new one/);
  assert.match(problems({ volumes: {} }).join('\n'), /must map the one new database volume/);
  assert.match(problems({ volumes: { 'shop-production-db-data': 'a' }, hold: 'x' }).join('\n'), /deploy\.dbUpgrade/);
});

test('a dev environment names exactly one of from and hold', () => {
  const block = (dbUpgrade: unknown): ReturnType<typeof normalizeLocal> => normalizeLocal({ ports: { db: 55432 }, services: [{ name: 'db', wait: 'healthy' }], dbUpgrade }, { project: 'shop', env: 'dev' });
  assert.deepEqual(block({ from: 'shop-dev_postgres-data' }).config?.dbUpgrade, { from: 'shop-dev_postgres-data' });
  assert.deepEqual(block({ hold: 'shop-dev-pg16' }).config?.dbUpgrade, { hold: 'shop-dev-pg16' });
  assert.match(block({ from: 'a', hold: 'b' }).problems.map((item) => item.message).join('\n'), /exactly one of from/);
  assert.match(block({ to: 'x' }).problems.map((item) => `${item.at} ${item.message}`).join('\n'), /dbUpgrade/);
  assert.equal(block(undefined).config?.dbUpgrade, undefined);
});

test('a restore is proven only when every row, sequence, object, role and password hash is equal; an extension may change version', () => {
  assert.deepEqual(inventoryProblems(cluster(5), cluster(5, 'a'.repeat(64), '0.8.7')), []);
  assert.deepEqual(inventoryProblems(cluster(5), cluster(4)), ['shop: public.orders holds 5 row(s) before and 4 after', 'shop: the sequence public.orders_id_seq is at 5|t before and 4|t after']);
  assert.match(inventoryProblems(cluster(5), cluster(5, 'c'.repeat(64))).join('\n'), /the roles differ .*password hashes changed/);
  const lost = cluster(5);
  delete lost.databases.shop?.extensions.vector;
  assert.match(inventoryProblems(cluster(5), lost).join('\n'), /the extension vector is missing after the restore/);
  const gone = cluster(5);
  gone.databases = {};
  assert.deepEqual(inventoryProblems(cluster(5), gone), ['database shop is missing after the restore']);
});

test('the inventory output is parsed by tag, a table name may hold a bar', () => {
  const db = parseDatabase(['ext|plpgsql|1.0', 'obj|r|2', 'obj|function|4', 'rows|public.a|b|7', 'seq|public.s|12|t', 'noise'].join('\n'));
  assert.deepEqual(db, { extensions: { plpgsql: '1.0' }, rows: { 'public.a|b': 7 }, sequences: { 'public.s': '12|t' }, objects: { r: 2, function: 4 } });
  assert.deepEqual(parseCluster(['db|postgres', 'db|shop', `roles|3|${'d'.repeat(64)}`, `members|0|${'e'.repeat(64)}`].join('\n')), { databases: ['postgres', 'shop'], roles: { count: 3, digest: 'd'.repeat(64) }, members: { count: 0, digest: 'e'.repeat(64) } });
});

test('the sealed superuser password must be the version the database service runs', () => {
  const spec = (secret: string) => ({ TaskTemplate: { ContainerSpec: { Env: ['POSTGRES_PASSWORD_FILE=/run/secrets/POSTGRES_PASSWORD'], Secrets: [{ File: { Name: 'POSTGRES_PASSWORD' }, SecretName: secret }] } } });
  const sealed = { secrets: { POSTGRES_PASSWORD: { runtimeName: 'shop-production-postgres-password-v0123456789', value: 'sealed-value' } }, grants: { db: ['POSTGRES_PASSWORD'] }, settings: {} };
  assert.deepEqual(sealedPassword(spec('shop-old-postgres-password-v0123456789'), sealed, 'shop-old_db', 'db'), { key: 'POSTGRES_PASSWORD', value: 'sealed-value' });
  assert.throws(() => sealedPassword(spec('shop-production-postgres-password-vffffffffff'), sealed, 'shop-production_db', 'db'), (error: Error & { code?: string }) => error.code === 'STACK_DB_UPGRADE_PASSWORD_DRIFT' && !error.message.includes('sealed-value'));
  assert.throws(() => sealedPassword({ TaskTemplate: { ContainerSpec: { Env: ['POSTGRES_PASSWORD=plain'] } } }, sealed, 'shop-production_db', 'db'), (error: Error & { code?: string }) => error.code === 'STACK_DB_UPGRADE_NO_PASSWORD');
});
