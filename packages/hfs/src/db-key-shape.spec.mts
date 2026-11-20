// proves: DB_PRIMARY_KEY_SHAPE@lite
// proves: DB_PRIMARY_KEY_SHAPE@full
// proves: DB_FOREIGN_KEY_NAME@lite
// proves: DB_FOREIGN_KEY_NAME@full
// proves: DB_FOREIGN_KEY_INDEX@lite
// proves: DB_FOREIGN_KEY_INDEX@full
/** The key shape of an app table (R431): `id uuid`, `[<role>_]<referenced table singular>_id` foreign keys, an index per foreign key, and the landed backlog. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';
import { tableSingular } from '../runtime/scripts/hfs/rules/database-keys.mjs';
import { withLandedMigrationsKnown } from '../runtime/scripts/hfs/rules/database-landed.mjs';
import { withoutGitLocalEnv } from '../runtime/scripts/lib/git.mjs';

const FILE = 'db/migrations/20260101120000_orders.sql';
const KEY_CODES = new Set(['DB_PRIMARY_KEY_SHAPE', 'DB_FOREIGN_KEY_NAME', 'DB_FOREIGN_KEY_INDEX']);
const RLS = (table: string) => `alter table public.${table} enable row level security;\nalter table public.${table} force row level security;\n`;
const CUSTOMERS = `create table public.customers (id uuid primary key default gen_random_uuid());\n${RLS('customers')}`;

function appAt(t: TestContext, edition: string, sql: string, db: Record<string, unknown> = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-keys-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'hfs.json'), JSON.stringify({
    hfs: 3, kind: 'app', project: 'proof', edition, db,
    sides: {
      be: { apps: [{ name: 'api', kind: 'api' }], connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'api', isolation: 'schema', provider: 'postgres' }] },
      fe: { apps: [{ name: 'web', kind: 'next' }] },
    },
  }));
  fs.mkdirSync(path.join(repoRoot, 'db/migrations'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, FILE), sql);
  return repoRoot;
}

async function keyFindings(t: TestContext, edition: string, sql: string, db: Record<string, unknown> = {}) {
  const repoRoot = appAt(t, edition, sql, db);
  const findings = await checkDatabase({ repoRoot, files: [FILE], git: () => ({ ok: false, stdout: '' }) });
  return findings.filter((finding) => KEY_CODES.has(finding.code));
}

test('the singular of a table name follows the fixed rules on its last word, and the app map wins', () => {
  assert.equal(tableSingular('order_items'), 'order_item');
  assert.equal(tableSingular('categories'), 'category');
  assert.equal(tableSingular('boxes'), 'box');
  assert.equal(tableSingular('addresses'), 'address');
  assert.equal(tableSingular('status'), 'status');
  assert.equal(tableSingular('staff'), 'staff');
  assert.equal(tableSingular('people', { people: 'person' }), 'person');
  assert.equal(tableSingular('team_people', { people: 'person' }), 'team_person');
});

for (const edition of ['lite'] as const) {
  test(`DB_PRIMARY_KEY_SHAPE@${edition} refuses a table keyed by anything but id uuid`, async (t) => {
    for (const sql of ['create table public.orders (code text primary key);', 'create table public.orders (id bigint primary key);', 'create table public.orders (a uuid, b uuid, primary key (a, b));', 'create table public.orders (id uuid);']) {
      const findings = await keyFindings(t, edition, `${sql}\n${RLS('orders')}`);
      assert.deepEqual(findings.map(({ code }) => code), ['DB_PRIMARY_KEY_SHAPE'], sql);
      assert.equal(findings[0]?.table, 'public.orders');
    }
  });

  test(`DB_PRIMARY_KEY_SHAPE@${edition} accepts id uuid, inline or as a table constraint, and a declared key exception`, async (t) => {
    assert.deepEqual(await keyFindings(t, edition, `create table public.orders (id uuid primary key default gen_random_uuid(), code text not null unique);\n${RLS('orders')}`), []);
    assert.deepEqual(await keyFindings(t, edition, `create table public.orders (id uuid not null, constraint orders_pkey primary key (id));\n${RLS('orders')}`), []);
    assert.deepEqual(await keyFindings(t, edition, `create table public.orders (code text primary key);\n${RLS('orders')}`, { keyExceptions: [{ table: 'orders', reason: 'a window keyed by its bucket' }] }), []);
  });

  test(`DB_FOREIGN_KEY_NAME@${edition} refuses a foreign key named by its role alone or by another table`, async (t) => {
    const sql = `${CUSTOMERS}create table public.orders (id uuid primary key, owner_id uuid references public.customers (id), buyer uuid references public.customers (id));\ncreate index orders_owner_id_idx on public.orders (owner_id);\ncreate index orders_buyer_idx on public.orders (buyer);\n${RLS('orders')}`;
    const findings = await keyFindings(t, edition, sql);
    assert.deepEqual(findings.map(({ code, column }) => [code, column]), [['DB_FOREIGN_KEY_NAME', 'owner_id'], ['DB_FOREIGN_KEY_NAME', 'buyer']]);
    assert.equal(findings[0]?.expected, 'customer_id');
  });

  test(`DB_FOREIGN_KEY_NAME@${edition} accepts <singular>_id, <role>_<singular>_id, a shared key and an irregular plural from db.singulars`, async (t) => {
    const sql = `${CUSTOMERS}create table public.people (id uuid primary key);\n${RLS('people')}create table public.orders (id uuid primary key, customer_id uuid references public.customers (id), billing_customer_id uuid, person_id uuid references public.people (id));\nalter table public.orders add constraint orders_billing_fk foreign key (billing_customer_id) references public.customers (id);\ncreate index orders_customer_id_idx on public.orders (customer_id);\ncreate index orders_billing_customer_id_idx on public.orders (billing_customer_id, id);\ncreate index orders_person_id_idx on public.orders (person_id);\n${RLS('orders')}create table public.customer_profiles (id uuid primary key references public.customers (id));\n${RLS('customer_profiles')}`;
    assert.deepEqual(await keyFindings(t, edition, sql, { singulars: { people: 'person' } }), []);
    assert.deepEqual((await keyFindings(t, edition, sql)).map(({ code }) => code), ['DB_FOREIGN_KEY_NAME'], 'without the map, people is singular people');
  });

  test(`DB_FOREIGN_KEY_INDEX@${edition} refuses a foreign key no index leads with, and accepts one a later migration or a unique key covers`, async (t) => {
    const table = `${CUSTOMERS}create table public.orders (id uuid primary key, customer_id uuid references public.customers (id), note text);\n${RLS('orders')}`;
    const findings = await keyFindings(t, edition, table);
    assert.deepEqual(findings.map(({ code }) => code), ['DB_FOREIGN_KEY_INDEX']);
    assert.match(String(findings[0]?.message), /create index orders_customer_id_idx on public\.orders \(customer_id\)/);
    assert.deepEqual((await keyFindings(t, edition, `${table}create index orders_note_customer_idx on public.orders (note, customer_id);`)).map(({ code }) => code), ['DB_FOREIGN_KEY_INDEX'], 'an index that does not lead with the column does not count');
    assert.deepEqual(await keyFindings(t, edition, `${table}alter table public.orders add constraint orders_customer_note_key unique (customer_id, note);`), []);
  });
}

test('the key shape of a migration already on the base is the backlog: reported as a known item, never blocking; a new migration blocks', async (t) => {
  const repoRoot = appAt(t, 'lite', `create table public.orders (code text primary key);\n${RLS('orders')}`);
  const env = withoutGitLocalEnv(process.env);
  const run = (...args: string[]) => execFileSync('git', ['-c', 'user.name=p', '-c', 'user.email=p@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repoRoot, env, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('add', '.');
  run('commit', '-q', '-m', 'base');
  const findings = (await checkDatabase({ repoRoot, files: [FILE] })).filter((finding) => KEY_CODES.has(finding.code));
  assert.deepEqual(withLandedMigrationsKnown(findings, { repoRoot }).map(({ code, level }) => [code, level]), [['DB_PRIMARY_KEY_SHAPE', 'info']]);
  run('checkout', '-q', '-b', 'feature');
  const next = 'db/migrations/20260102120000_lines.sql';
  fs.writeFileSync(path.join(repoRoot, next), `create table public.lines (code text primary key);\n${RLS('lines')}`);
  const fresh = (await checkDatabase({ repoRoot, files: [FILE, next] })).filter((finding) => KEY_CODES.has(finding.code));
  assert.deepEqual(withLandedMigrationsKnown(fresh, { repoRoot }).map(({ path: file, level }) => [file, level]), [[FILE, 'info'], [next, 'error']]);
});

test('the lite skeleton baseline, with its sync-managed identity module, passes the key shape rules it is judged by', async (t) => {
  const template = fs.readFileSync(new URL('../templates/app/skeleton/db/migrations/__timestamp___baseline.sql', import.meta.url), 'utf8');
  const sql = template.split('\n').filter((line) => !line.trimStart().startsWith('{{>')).join('\n');
  assert.deepEqual((await keyFindings(t, 'lite', sql)).map(({ code, table, column }) => [code, table, column]), []);
});
