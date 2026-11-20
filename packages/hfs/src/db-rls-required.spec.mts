// proves: DB_RLS_REQUIRED
// proves: DB_RLS_REQUIRED
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';

const FILE = 'db/migrations/20260101120000_items.sql';
const TABLE = 'create table public.items (id uuid primary key, owner_id uuid not null);\n';

async function judge(t: TestContext, edition: string, sql: string, forceRls: string[] = []) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-rls-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'hfs.json'), JSON.stringify({
    hfs: 3, kind: 'app', project: 'proof', edition, db: { forceRls },
    sides: {
      be: {
        apps: [{ name: 'api', kind: 'api' }],
        connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'api', isolation: 'schema', provider: 'postgres' }],
      },
      fe: { apps: [{ name: 'web', kind: 'next' }] },
    },
  }));
  fs.mkdirSync(path.join(repoRoot, 'db/migrations'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, FILE), sql);
  return checkDatabase({ repoRoot, files: [FILE], git: () => ({ ok: false, stdout: '' }) });
}

for (const edition of ['lite'] as const) {
  test(`DB_RLS_REQUIRED@${edition} rejects an exposed table without RLS`, async (t) => {
    const findings = await judge(t, edition, TABLE);
    assert.deepEqual(findings.map(({ code }) => code), ['DB_RLS_REQUIRED']);
    assert.equal(findings[0]!.path, FILE);
    assert.equal(findings[0]!.table, 'public.items');
    assert.match(findings[0]!.message as string, /without a later.*enable row level security/);
  });

  test(`DB_RLS_REQUIRED@${edition} accepts RLS enabled after the table declaration`, async (t) => {
    assert.deepEqual(await judge(t, edition, `${TABLE}alter table public.items enable row level security;`), []);
  });

  test(`DB_RLS_REQUIRED@${edition} requires and accepts FORCE for a declared owner table`, async (t) => {
    const enabled = `${TABLE}alter table public.items enable row level security;\n`;
    const findings = await judge(t, edition, enabled, ['public.items']);
    assert.deepEqual(findings.map(({ code }) => code), ['DB_RLS_REQUIRED']);
    assert.match(findings[0]!.message as string, /force row level security/);
    assert.deepEqual(await judge(t, edition, `${enabled}alter table public.items force row level security;`, ['public.items']), []);
  });
}

test('DB_RLS_REQUIRED judges the ordered set: a table created bare in a baseline passes when a later migration enables (and forces) RLS or drops it, and fails when none does', async (t) => {
  const BASELINE = 'db/migrations/20260101000000_baseline.sql';
  const LATER = 'db/migrations/20260102000000_rls.sql';
  const judged = async (files: Record<string, string>, forceRls: string[] = []) => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-rls-set-'));
    t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
    fs.writeFileSync(path.join(repoRoot, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'proof', db: { forceRls }, sides: { be: { apps: [{ name: 'api', kind: 'api' }], connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'api', isolation: 'schema', provider: 'postgres' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } }));
    fs.mkdirSync(path.join(repoRoot, 'db/migrations'), { recursive: true });
    for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(repoRoot, name), sql);
    return (await checkDatabase({ repoRoot, files: Object.keys(files), git: () => ({ ok: false, stdout: '' }) })).filter((finding) => finding.code === 'DB_RLS_REQUIRED');
  };
  assert.equal((await judged({ [BASELINE]: TABLE })).length, 1, 'a baseline with no later migration keeps the finding');
  assert.deepEqual(await judged({ [BASELINE]: TABLE, [LATER]: 'alter table public.items enable row level security;\n' }), [], 'a later migration enables RLS');
  assert.equal((await judged({ [BASELINE]: TABLE, [LATER]: 'alter table public.items enable row level security;\n' }, ['public.items'])).length, 1, 'a declared definer-owned table still needs FORCE');
  assert.deepEqual(await judged({ [BASELINE]: TABLE, [LATER]: 'alter table public.items enable row level security;\nalter table public.items force row level security;\n' }, ['public.items']), []);
  assert.deepEqual(await judged({ [BASELINE]: TABLE, [LATER]: 'drop table public.items;\n' }), [], 'a table the set drops is judged no more');
  assert.equal((await judged({ [BASELINE]: 'create table public.other (id uuid primary key);\n', [LATER]: 'alter table public.items enable row level security;\n' })).length, 1, 'RLS on another table does not count');
});
