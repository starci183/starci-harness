// DB_MIGRATION_DESTRUCTIVE: a contract migration that drops a column is blocked only by a be/src source that still names that
// column together with its own table in one SQL statement; a same-named column in another query is not a reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { destructiveMigrationFindings } from '../runtime/scripts/hfs/rules/database-migrations.mjs';

const MIGRATION = 'db/migrations/20261101000906_origin-columns_contract_drop.sql';

/** The findings of `migration` (SQL text) against be/src sources `{ path: text }` in a fresh app root. */
function judge(t, migration, sources, additionalMigrations = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-destructive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = { [MIGRATION]: migration, ...additionalMigrations, ...sources };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const migrations = Object.keys(files).filter((file) => file.startsWith('db/migrations/')).sort();
  return destructiveMigrationFindings({ repoRoot: root, migrations, files: Object.keys(files) });
}

const sql = (text) => `export const QUERY = ${JSON.stringify(text)};\n`;
const dropOrigin = 'alter table public.transactions drop column origin;\n';

test('a same-named column of another table is not a reference of the dropped column', (t) => {
  const findings = judge(t, dropOrigin, { 'be/src/modules/domain/brain-lessons/persistence/brain-lessons.sql.ts': sql('select public.brain_lessons.origin from public.brain_lessons') });
  assert.deepEqual(findings, []);
});

test('the same table and the same column is a reference', (t) => {
  const findings = judge(t, dropOrigin, { 'be/src/modules/domain/ledger/persistence/transactions.sql.ts': sql('select public.transactions.origin from public.transactions') });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'DB_MIGRATION_DESTRUCTIVE');
  assert.equal(findings[0].reference, 'be/src/modules/domain/ledger/persistence/transactions.sql.ts');
});

test('an unqualified column beside a mention of its table is a reference', (t) => {
  const findings = judge(t, dropOrigin, { 'be/src/modules/domain/ledger/persistence/transactions.sql.ts': sql('select origin, amount from transactions where id = $1') });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].object, 'public.transactions.origin');
});

test('a table drop still matches any source naming the table', (t) => {
  const findings = judge(t, 'drop table public.brain_lessons;\n', { 'be/src/modules/domain/brain-lessons/persistence/brain-lessons.sql.ts': sql('select id from brain_lessons') });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].object, 'public.brain_lessons');
});

const PUBLIC_API = 'be/src/tests/fixtures/persistence/public-api.sql.ts';
const originDrops = ['work_items', 'inbound_events', 'leads'].map((table) =>
  `ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${table}_origin_check, DROP COLUMN origin;`).join('\n');
const publicApiQueries = [
  'SELECT id, need, company, channel, stage FROM public.leads WHERE workspace_id = $1::uuid AND id = $2::uuid',
  'SELECT id, action, status, lead_id, inbound_event_id FROM public.work_items WHERE workspace_id = $1::uuid',
  'SELECT id, event_id, body, lead_id FROM public.inbound_events WHERE workspace_id = $1::uuid',
  'SELECT id, title, content, origin FROM public.knowledge_sources WHERE workspace_id = $1::uuid AND id = $2::uuid',
];
const schemaMigrations = {
  'db/migrations/20261026000000_baseline.sql': 'CREATE TABLE public.knowledge_sources (id uuid, origin text);',
  'db/migrations/20261104000500_source-metadata.sql': 'ALTER TABLE public.knowledge_sources ADD COLUMN IF NOT EXISTS topic text;',
};

test('NIVO public API queries do not attribute surviving knowledge_sources.origin to three dropped columns', (t) => {
  const source = publicApiQueries.map((query, index) => `export const QUERY_${index} = sql\`${query}\`;`).join('\n');
  assert.deepEqual(judge(t, originDrops, { [PUBLIC_API]: source }, schemaMigrations), []);
});

test('separate statements in one SQL literal do not combine table and column names', (t) => {
  assert.deepEqual(judge(t, originDrops, { [PUBLIC_API]: sql(publicApiQueries.join(';\n')) }, schemaMigrations), []);
});

test('a real removed origin read in the public API fixture stays red', (t) => {
  const source = publicApiQueries.map(sql).join('\n') + sql('SELECT origin FROM public.work_items');
  const findings = judge(t, originDrops, { [PUBLIC_API]: source }, schemaMigrations);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'DB_MIGRATION_DESTRUCTIVE');
  assert.equal(findings[0].object, 'public.work_items.origin');
  assert.equal(findings[0].reference, PUBLIC_API);
});

test('dropping the surviving knowledge source column is still destructive', (t) => {
  const findings = judge(t, 'ALTER TABLE public.knowledge_sources DROP COLUMN origin;', {
    [PUBLIC_API]: sql(publicApiQueries.join(';\n')),
  }, schemaMigrations);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].object, 'public.knowledge_sources.origin');
});

for (const expression of [
  'sql`SELECT origin ${projection} FROM public.transactions WHERE id = ${id}`',
  "'SELECT origin ' + 'FROM public.transactions'",
  'sql`SELECT ${"origin"} FROM public.transactions`',
  'sql`SELECT ${sql`origin`} FROM public.transactions`',
  'sql`SELECT ${("origin" as const)} FROM public.transactions`',
  'sql`SELECT ${("origin" satisfies string)} FROM public.transactions`',
  'sql`SELECT ${("origin"!)} FROM public.transactions`',
]) {
  test(`a real column read across SQL expression fragments stays red: ${expression}`, (t) => {
    const findings = judge(t, dropOrigin, { [PUBLIC_API]: `export const QUERY = ${expression};` });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].object, 'public.transactions.origin');
  });
}

test('entity table decorators and column identifiers remain associated', (t) => {
  const findings = judge(t, dropOrigin, {
    'be/src/modules/domain/ledger/transactions.entity.ts': '@Entity("transactions") export class Transaction { @Column() origin: string; }',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].object, 'public.transactions.origin');
});

for (const source of [
  "const projection = 'SELECT origin '; export const QUERY = projection + 'FROM public.transactions';",
  'const column = "origin"; const alias = column; export const QUERY = sql`SELECT ${alias} FROM public.transactions`;',
  'const column = "id"; function query() { const column = "origin"; return sql`SELECT ${column} FROM public.transactions`; }',
  'const first = second; const second = first; export const QUERY = sql`SELECT origin, ${first} FROM public.transactions`;',
]) {
  test(`a genuine column read assembled from local bindings stays red: ${source}`, (t) => {
    const findings = judge(t, dropOrigin, { [PUBLIC_API]: source });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].object, 'public.transactions.origin');
  });
}

test('a shadowed SQL fragment does not borrow the outer column name', (t) => {
  const source = 'const column = "origin"; function query() { const column = "id"; return sql`SELECT ${column} FROM public.transactions`; }';
  assert.deepEqual(judge(t, dropOrigin, { [PUBLIC_API]: source }), []);
});

test('dropping a constraint does not remove a surviving column of the same name', (t) => {
  assert.deepEqual(judge(t, 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT IF EXISTS origin;', {
    [PUBLIC_API]: sql('SELECT origin FROM public.knowledge_sources'),
  }, schemaMigrations), []);
});

test('a real constraint dependency remains red', (t) => {
  const findings = judge(t, 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT IF EXISTS origin;', {
    [PUBLIC_API]: sql('INSERT INTO public.knowledge_sources (id) VALUES ($1) ON CONFLICT ON CONSTRAINT origin DO NOTHING'),
  }, schemaMigrations);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].object, 'public.knowledge_sources.origin');
});

test('dropping a constraint still requires a contract migration', (t) => {
  const file = 'db/migrations/20261101000907_remove-constraint.sql';
  const findings = judge(t, '', {}, { [file]: 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT IF EXISTS origin;' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, file);
});

test('a constraint and column sharing a name do not hide a real column drop', (t) => {
  const findings = judge(t, 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT origin, DROP COLUMN origin;', {
    [PUBLIC_API]: sql('SELECT origin FROM public.knowledge_sources'),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].object, 'public.knowledge_sources.origin');
  assert.equal(findings[0].reference, PUBLIC_API);
});

test('an entity named constraint remains a dependency', (t) => {
  const findings = judge(t, 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT sources_origin_key;', {
    'be/src/modules/domain/knowledge/knowledge-sources.entity.ts': '@Entity("knowledge_sources") @Unique("sources_origin_key", ["origin"]) export class Source { origin: string; }',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].reference, 'be/src/modules/domain/knowledge/knowledge-sources.entity.ts');
});

test('a same-named constraint belonging to another table is not a dependency', (t) => {
  assert.deepEqual(judge(t, 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT origin;', {
    [PUBLIC_API]: sql('INSERT INTO public.leads (id) VALUES ($1) ON CONFLICT ON CONSTRAINT origin DO NOTHING'),
  }), []);
});

test('a column and a different named constraint in one query are distinct dependencies', (t) => {
  assert.deepEqual(judge(t, 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT origin;', {
    [PUBLIC_API]: sql('INSERT INTO public.knowledge_sources (origin) VALUES ($1) ON CONFLICT ON CONSTRAINT sources_key DO NOTHING'),
  }), []);
});

for (const statement of [
  'SET CONSTRAINTS sources_origin_key DEFERRED',
  'SET CONSTRAINTS other_key, public.sources_origin_key IMMEDIATE',
]) {
  test(`a named constraint dependency without a table stays red: ${statement}`, (t) => {
    const findings = judge(t, 'ALTER TABLE public.knowledge_sources DROP CONSTRAINT sources_origin_key;', {
      [PUBLIC_API]: sql(statement),
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].reference, PUBLIC_API);
  });
}

test('a later additive migration cannot excuse data loss in an expansion migration', (t) => {
  const findings = judge(t, '', {}, {
    'db/migrations/20261101000907_remove-origin.sql': dropOrigin,
    'db/migrations/20261101000908_restore-origin.sql': 'ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS origin text;',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, 'db/migrations/20261101000907_remove-origin.sql');
  assert.equal(findings[0].object, 'public.transactions.origin');
});
