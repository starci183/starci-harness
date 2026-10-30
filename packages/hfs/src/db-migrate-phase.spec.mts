// proves the phases of `db migrate` a deploy drives (db/migrate.mjs, owner approval 2026-10-31): the expand pass applies every migration but the
// `*_contract_*` ones before the services update, the contract pass applies only those after the accept, `all` (a first start) applies everything in
// stamp order, a pass with nothing to do is green with no mutating call, and `database.target` / `database.service` are judged.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isContractMigration, loadDatabase, migrateDatabase } from '../db/migrate.mjs';
import type { MigrationPhase } from '../db/migrate.mjs';
import { stackContext } from '../stack/context.mjs';
import type { Spawn } from '../stack/context.mjs';

const FILES = {
  '20261101000000_orders.sql': 'create table public.orders (id bigint primary key);\n',
  '20261102000000_orders-total.sql': 'alter table public.orders add column total bigint;\n',
  '20261103000000_orders_contract_drop-legacy.sql': 'alter table public.orders drop column legacy;\n',
};

/** An app root with the migrations above and a fake psql over an in-memory history; `applied` lists the files psql ran, in order. */
function world(t: TestContext, history: string[] = [], files: Record<string, string> = FILES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-migrate-phase-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'db', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(root, '.starcistacks'));
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'database:\n  target: stack\n');
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(root, 'db', 'migrations', name), sql);
  const versions = new Set(history);
  const applied: string[] = [];
  const spawn = ((_command: string, args: readonly string[]) => {
    const sql = String(args[args.indexOf('-c') + 1] ?? '');
    if (args.includes('-1')) {
      const file = args[args.indexOf('-f') + 1];
      const version = /values \('(\d+)'/u.exec(args.filter((_arg, index) => args[index - 1] === '-c').at(-1) ?? '')?.[1];
      if (file && version) { applied.push(path.basename(file)); versions.add(version); }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (sql.includes('to_regclass')) return { status: 0, stdout: `[{"present":${versions.size > 0}}]`, stderr: '' };
    if (sql.includes('order by version')) return { status: 0, stdout: JSON.stringify([...versions].sort().map((version) => ({ version }))), stderr: '' };
    return { status: 0, stdout: '[]', stderr: '' };
  }) as Spawn;
  const ctx = stackContext({ cwd: root, env: { DATABASE_URL: 'postgresql://app@127.0.0.1:5432/app' }, spawn });
  return { ctx, root, applied, versions };
}

const migrate = (w: ReturnType<typeof world>, phase: MigrationPhase, execute: boolean) => migrateDatabase(w.ctx, loadDatabase(w.root), { execute, phase });

test('a contract migration is recognised by its name, and only by it', () => {
  assert.equal(isContractMigration('20261103000000_orders_contract_drop-legacy.sql'), true);
  assert.equal(isContractMigration('20261103000000_contract_drop-legacy.sql'), true);
  assert.equal(isContractMigration('20261102000000_orders-total.sql'), false);
  assert.equal(isContractMigration('20261102000000_contractors.sql'), false);
});

test('the expand pass applies everything but the contract migrations, and the preview lists what is pending', async (t) => {
  const w = world(t, ['20261101000000']);
  const preview = await migrate(w, 'all', false);
  assert.equal(preview.ok, true);
  assert.equal(preview.data!.done, false);
  assert.deepEqual(preview.data!.pushFiles, ['20261102000000_orders-total.sql', '20261103000000_orders_contract_drop-legacy.sql']);
  assert.deepEqual(w.applied, [], 'a preview applies nothing');
  const expand = await migrate(w, 'expand', true);
  assert.equal(expand.ok, true);
  assert.deepEqual(w.applied, ['20261102000000_orders-total.sql']);
  assert.deepEqual(expand.data!.pushed, ['20261102000000']);
});

test('the contract pass applies only the contract migrations, and an expanded database has nothing left for the expand pass', async (t) => {
  const w = world(t, ['20261101000000', '20261102000000']);
  assert.equal((await migrate(w, 'expand', false)).data!.done, true, 'nothing to expand: the contract migration is not pending for this pass');
  const preview = await migrate(w, 'contract', false);
  assert.equal(preview.data!.done, false);
  assert.deepEqual(preview.data!.pushFiles, ['20261103000000_orders_contract_drop-legacy.sql']);
  const contract = await migrate(w, 'contract', true);
  assert.equal(contract.ok, true);
  assert.deepEqual(w.applied, ['20261103000000_orders_contract_drop-legacy.sql']);
  const again = await migrate(w, 'contract', true);
  assert.equal(again.data!.done, true);
  assert.deepEqual(w.applied, ['20261103000000_orders_contract_drop-legacy.sql'], 'a second contract pass makes no mutating call');
});

test('a history that already holds a contract migration is explained by the expand pass, not red', async (t) => {
  const w = world(t, ['20261101000000', '20261102000000', '20261103000000']);
  const expand = await migrate(w, 'expand', true);
  assert.equal(expand.ok, true);
  assert.equal(expand.data!.done, true);
  assert.deepEqual(w.applied, []);
});

test('the all pass (a first start) applies every migration in stamp order, contract ones included', async (t) => {
  const w = world(t, []);
  const all = await migrate(w, 'all', true);
  assert.equal(all.ok, true);
  assert.deepEqual(w.applied, Object.keys(FILES));
});

test('a repository with no contract migration has the same expand and all passes', async (t) => {
  const { '20261103000000_orders_contract_drop-legacy.sql': _contract, ...plain } = FILES;
  const w = world(t, [], plain);
  assert.deepEqual((await migrate(w, 'expand', false)).data!.pushFiles, (await migrate(w, 'all', false)).data!.pushFiles);
});

test('database.target and database.service are judged and default to the stack database service db', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-database-decl-'));
  try {
    fs.mkdirSync(path.join(root, '.starcistacks'));
    const declare = (block: string) => fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), block);
    declare('database:\n  heldBack: []\n');
    assert.deepEqual([loadDatabase(root).target, loadDatabase(root).service], ['stack', 'db']);
    declare('database:\n  target: external\n  service: postgres\n');
    assert.deepEqual([loadDatabase(root).target, loadDatabase(root).service], ['external', 'postgres']);
    declare('database:\n  target: cloud\n');
    assert.throws(() => loadDatabase(root), /database\.target: must be stack/u);
    declare('database:\n  service: Not A Service\n');
    assert.throws(() => loadDatabase(root), /database\.service: must match/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
