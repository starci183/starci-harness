// proves: DB_EXTENSION_ALLOWED@lite DB_API_EXPOSED@lite DB_MIGRATION_DESTRUCTIVE@lite
// proves: HFS_SEED_PII@lite DB_VAULT_WRITE@lite
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { databaseConfigFindings } from '../runtime/scripts/hfs/rules/database-config.mjs';
import { databaseExecutableTokens, databaseSqlTokens, isMigrationName, migrationShapeFindings } from '../runtime/scripts/hfs/rules/database-migrations.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const CONFIG = 'supabase/config.toml';
const MIGRATION = 'db/migrations/20261014120000_expand.sql';
const CONTRACT = 'db/migrations/20261014120000_contract_remove-old.sql';
const roots: string[] = [];
interface FixtureOptions { db?: object; manifest?: unknown; [option: string]: unknown }
interface Finding { code: string }
test.after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(contents: Record<string, string> = {}, edition = 'lite', options: FixtureOptions = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-config-'));
  roots.push(repoRoot);
  const files = {
    'hfs.json': JSON.stringify({ hfs: 3, kind: 'app', edition, db: options.db ?? {} }),
    ...contents,
  };
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(repoRoot, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const all = Object.keys(files);
  return { repoRoot, files: all, all, repo: { edition }, isRoot: true, manifest: undefined, base: undefined, ...options }; // reason: both finders read manifest and base as optional (absent means the shipped defaults) though their types require them
}

function findings(contents: Record<string, string>, edition?: string, options?: FixtureOptions) {
  return databaseConfigFindings(fixture(contents, edition, options));
}
const only = (list: Finding[], code: string) => list.filter((finding: Finding) => finding.code === code);
const has = (list: Finding[], code: string) => assert.ok(only(list, code).length > 0, `${code} expected: ${JSON.stringify(list)}`);

for (const edition of ['lite', 'full']) {
  test(`${edition}: the shipped extension policy preserves booking exclusion support and refuses unlisted extensions`, () => {
    const manifest = loadSlotManifest();
    assert.ok(manifest.ruleParams.db!.extensions.includes('btree_gist'));
    assert.deepEqual(findings({ [MIGRATION]: 'create extension if not exists btree_gist;' }, edition, { manifest }), []);
    has(findings({ [MIGRATION]: 'create extension if not exists hstore;' }, edition, { manifest }), 'DB_EXTENSION_ALLOWED');
    has(findings({ [MIGRATION]: 'create extension if not exists btree_gist;' }, edition, { manifest: { ruleParams: { db: { extensions: [] } } } }), 'DB_EXTENSION_ALLOWED');
  });

  test(`${edition}: a bounded config and additive migration pass every R259 check`, () => {
    assert.deepEqual(findings({ [MIGRATION]: 'create extension if not exists pgcrypto; create table public.items (id integer);' }, edition), []);
  });

  test(`${edition}: DB_EXTENSION_ALLOWED rejects an off-list extension and accepts the configured allowlist`, () => {
    has(findings({ [MIGRATION]: 'create extension if not exists hstore with schema extensions;' }, edition), 'DB_EXTENSION_ALLOWED');
    assert.deepEqual(findings({ [MIGRATION]: 'create extension if not exists "uuid-ossp"; create extension vector;' }, edition), []);
    // the db image adds pgmq, the event bus (ruling:lite-pgmq-bus-bullmq-jobs), and none of Supabase's other extensions
    assert.deepEqual(findings({ [MIGRATION]: 'create extension if not exists pgmq;' }, edition), []);
    for (const extension of ['pg_cron', 'pg_net', 'supabase_vault']) has(findings({ [MIGRATION]: `create extension ${extension};` }, edition), 'DB_EXTENSION_ALLOWED');
    assert.deepEqual(findings({ [MIGRATION]: 'create extension hstore;' }, edition, { manifest: { ruleParams: { db: { extensions: ['hstore'] } } } }), []);
    has(findings({ [MIGRATION]: 'create extension pgcrypto;' }, edition, { manifest: { ruleParams: { db: { extensions: [] } } } }), 'DB_EXTENSION_ALLOWED');
  });

  test(`${edition}: DB_EXTENSION_ALLOWED accepts unaccent and still refuses a made-up extension`, () => {
    assert.deepEqual(findings({ [MIGRATION]: 'create extension unaccent with schema extensions;' }, edition), []);
    has(findings({ [MIGRATION]: 'create extension not_a_real_extension with schema extensions;' }, edition), 'DB_EXTENSION_ALLOWED');
  });

  for (const sql of [
    "select vault.create_secret('fixture-value');",
    "select vault.update_secret('fixture-id', 'fixture-value');",
    "insert into vault.secrets (name, secret) values ('fixture-name', 'fixture-value');",
    "update only vault.secrets set secret = 'fixture-value';",
    "delete from vault.secrets;",
    "truncate table vault.secrets;",
    "truncate table public.items, only vault.secrets;",
    "merge into vault.secrets s using public.items i on s.id = i.id when matched then delete;",
    "create role app_be password 'fixture-value';",
    "alter user app_be encrypted password 'fixture-value';",
  ]) {
    test(`${edition}: DB_VAULT_WRITE refuses ${sql.split(' ').slice(0, 3).join(' ')}`, () => {
      const list = findings({ [MIGRATION]: sql }, edition);
      has(list, 'DB_VAULT_WRITE');
      assert.ok(!JSON.stringify(list).includes('fixture-value'), 'literal values are never copied into findings');
    });
  }

  test(`${edition}: vault reads and credential-free role changes pass`, () => {
    assert.deepEqual(findings({ [MIGRATION]: 'select name from vault.decrypted_secrets; create role app_be nologin; alter role app_be login;' }, edition), []);
  });

  test(`${edition}: HFS_SEED_PII rejects personal email and phone literals and accepts synthetic seed identities`, () => {
    for (const value of ['demo@real.invalid', '+1 (202) 555-0199', '2025550199']) {
      const list = findings({ 'db/seed.sql': `insert into fixtures values ('${value}');` }, edition);
      has(list, 'HFS_SEED_PII');
      assert.ok(!JSON.stringify(list).includes(value));
    }
    assert.deepEqual(findings({ 'db/seed.sql': "-- demo@real.invalid\ninsert into fixtures values ('demo@example.test', '2026-10-14', '00000000-0000-0000-0000-000000000001');" }, edition), []);
  });

  test(`${edition}: .starcistacks seed files are scanned for PII`, () => {
    has(findings({ '.starcistacks/dev/seeds/demo.sql': "insert into fixtures values ('demo@real.invalid');" }, edition), 'HFS_SEED_PII');
    assert.deepEqual(findings({ '.starcistacks/dev/seeds/demo.sql': "insert into fixtures values ('demo@example.test');" }, edition), []);
  });

  const destructiveCases = [
    'drop table if exists public.obsolete;',
    'drop role if exists retired_role;',
    'drop schema old_schema cascade;',
    'drop policy old_policy on public.items;',
    'alter table public.items drop column if exists old_column;',
    'alter table public.items rename column old_column to new_column;',
    'alter table public.items rename to new_items;',
    'alter table public.items alter column amount type integer;',
    'alter table public.items alter column amount set data type integer;',
    'alter table public.items alter column amount set not null;',
    'alter type public.old_type rename to new_type;',
    'truncate table public.items;',
  ];
  for (const sql of destructiveCases) {
    test(`${edition}: DB_MIGRATION_DESTRUCTIVE rejects ${sql} in expansion migrations and accepts an unreferenced contract migration`, () => {
      has(findings({ [MIGRATION]: sql }, edition), 'DB_MIGRATION_DESTRUCTIVE');
      assert.deepEqual(only(findings({ [CONTRACT]: sql }, edition), 'DB_MIGRATION_DESTRUCTIVE'), []);
    });
  }

  test(`${edition}: a contract migration waits until SQL/entity references are removed`, () => {
    for (const [file, source, sql] of [
      ['be/src/features/items/items.sql.ts', "export const query = 'select id from public.obsolete';", 'drop table public.obsolete;'],
      ['be/src/features/items/items.entity.ts', "export const columns = ['items', 'old_column'];", 'alter table public.items drop column old_column;'],
    ] as const) {
      has(findings({ [CONTRACT]: sql, [file]: source }, edition), 'DB_MIGRATION_DESTRUCTIVE');
      assert.deepEqual(only(findings({ [CONTRACT]: sql, [file]: source.replace(/obsolete|old_column/g, 'replacement') }, edition), 'DB_MIGRATION_DESTRUCTIVE'), []);
    }
    // A column is referenced only by a source that names its table too: the same column name of another table is no reference.
    assert.deepEqual(only(findings({ [CONTRACT]: 'alter table public.items drop column old_column;', 'be/src/features/orders/orders.entity.ts': 'export class Order { old_column = 0; }' }, edition), 'DB_MIGRATION_DESTRUCTIVE'), []);
    has(findings({ [CONTRACT]: 'truncate table public.retired, public.obsolete;', 'be/src/features/items/items.sql.ts': "export const query = 'select id from public.obsolete';" }, edition), 'DB_MIGRATION_DESTRUCTIVE');
  });

  test(`${edition}: comments/data literals are opaque while SQL and PLpgSQL bodies are checked`, () => {
    assert.deepEqual(findings({ [MIGRATION]: `-- create extension hstore; drop table public.items;
/* outer /* nested */ select vault.create_secret('fixture-value'); */
select 'drop table public.items;', E'create extension hstore;', $$select vault.create_secret('fixture-value');$$;
create function public.message() returns text language plpgsql as $$begin return 'drop table public.items;'; end$$;
create function public.javascript() returns text language plv8 as $$drop table public.items;$$;
` }, edition), []);
    const sql = `do $body$ begin create extension hstore; perform vault.create_secret('fixture-value'); drop table public.items; end $body$;`;
    const list = findings({ [MIGRATION]: sql }, edition);
    for (const code of ['DB_EXTENSION_ALLOWED', 'DB_VAULT_WRITE', 'DB_MIGRATION_DESTRUCTIVE']) has(list, code);
  });

  test(`${edition}: archived SQL is excluded from active extension/custody/DDL checks`, () => {
    assert.deepEqual(findings({ 'db/migrations/archive/20260101120000_retired.sql': "create extension hstore; select vault.create_secret('fixture-value'); drop table items;" }, edition), []);
  });
}

test('config finder is synchronous and respects root, profile and finding scope', () => {
  const input = fixture({ [MIGRATION]: 'create extension hstore;' });
  assert.ok(Array.isArray(databaseConfigFindings(input)));
  assert.deepEqual(databaseConfigFindings({ ...input, isRoot: false }), []);
  for (const profile of ['be', 'fe']) assert.deepEqual(databaseConfigFindings({ ...input, repo: { edition: 'lite', profile } }), []);
  assert.deepEqual(databaseConfigFindings({ ...input, inScope: (file: string) => file === CONFIG }), []);
});

test('SQL token helpers preserve identifiers, body/data boundaries and line locations', () => {
  const tokens = databaseSqlTokens(`-- ignored\n/* outer /* inner */ done */\nselect "Mixed", 'escaped''quote', E'escape\\'';`);
  assert.ok(tokens.some((token) => token.t === 'ident' && token.v === 'Mixed' && token.line === 3));
  assert.ok(tokens.some((token) => token.t === 'string' && token.v === "escaped'quote"));
  assert.ok(databaseExecutableTokens('do $$begin drop table items; end$$;').some((token) => token.v === 'drop'));
});

test('migration names retain legacy kebab form and allow explicit contract names', () => {
  for (const name of ['20261014120000_add-items.sql', '20261014120000_contract_remove-items.sql', '20261014120000_items_contract_remove-old.sql']) assert.ok(isMigrationName(name));
  for (const name of ['bad.sql', '20261014120000_Add-items.sql', '20261014120000_under_score.sql']) assert.equal(isMigrationName(name), false);
});

function historyGit(contents: Record<string, string>, headFiles = Object.keys(contents)) {
  return (args: string[]) => {
    if (args[0] === 'merge-base') return { ok: true, stdout: 'base-sha' };
    if (args[0] === 'ls-tree') return { ok: true, stdout: (args.includes('HEAD') ? headFiles : Object.keys(contents)).join('\0') };
    if (args[0] === 'show') return { ok: Object.hasOwn(contents, args[1]!.replace('base-sha:./', '')), stdout: contents[args[1]!.replace('base-sha:./', '')] ?? '' };
    return { ok: false, stdout: '' };
  };
}

for (const edition of ['lite', 'full']) {
  test(`${edition}: an explicit content-preserving restamp retires its old version without bypassing unrelated history`, async () => {
    const old = 'db/migrations/29990101120000_old.sql';
    const next = 'db/migrations/20261014120000_old.sql';
    const sql = 'select 1;\n';
    const input = fixture({ [next]: '-- starci:restamp 29990101120000 20261014120000\n' + sql }, edition);
    assert.deepEqual(await migrationShapeFindings({ ...input, migrations: [next], git: historyGit({ [old]: sql }) }), []);
    const repeated = fixture({ [next]: '-- starci:restamp 29990101120000 20261014120000\n' + sql }, edition);
    assert.deepEqual(await migrationShapeFindings({ ...repeated, migrations: [next], git: historyGit({ [old]: '-- starci:restamp 29980101120000 29990101120000\n' + sql }) }), []);
    const changed = fixture({ [next]: '-- starci:restamp 29990101120000 20261014120000\nselect 2;\n' }, edition);
    has(await migrationShapeFindings({ ...changed, migrations: [next], git: historyGit({ [old]: sql }) }), 'DB_MIGRATION_SHAPE');
    const noHeader = fixture({ [next]: sql }, edition);
    has(await migrationShapeFindings({ ...noHeader, migrations: [next], git: historyGit({ [old]: sql }) }), 'DB_MIGRATION_SHAPE');
  });
}
