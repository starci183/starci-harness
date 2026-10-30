// proves: DB_MIGRATION_SHAPE@lite
// A migration is applied in one transaction with its history row (`psql -1`), so top-level transaction control and a COMMIT or ROLLBACK
// inside a DO block are DB_MIGRATION_SHAPE findings named by file:line; function bodies, dollar-quoted or not, are never judged.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';

const FILE = 'db/migrations/20260228235959_create-items.sql';

async function judge(t: TestContext, sql: string) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-transaction-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'hfs.json'), JSON.stringify({ kind: 'app', edition: 'lite' }));
  fs.mkdirSync(path.join(repoRoot, 'db/migrations'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, FILE), sql);
  const findings = await checkDatabase({ repoRoot, files: [FILE], edition: 'lite', git: () => ({ ok: false, stdout: '' }) });
  return findings.filter((finding) => /transaction control/.test(finding.message));
}

test('top-level BEGIN, SAVEPOINT, COMMIT, ROLLBACK and END are findings named by file:line', async (t) => {
  const sql = '-- header\nbegin;\nselect 1;\n\n  /* note */ savepoint s1;\nselect 2;\ncommit;\nstart transaction;\nrollback;\nend;\n';
  const findings = await judge(t, sql);
  assert.deepEqual(findings.map(({ code, line }) => [code, line]), [
    ['DB_MIGRATION_SHAPE', 2], ['DB_MIGRATION_SHAPE', 5], ['DB_MIGRATION_SHAPE', 7], ['DB_MIGRATION_SHAPE', 8], ['DB_MIGRATION_SHAPE', 9], ['DB_MIGRATION_SHAPE', 10],
  ]);
  assert.match(findings[0]!.message, new RegExp(`^${FILE}:2 carries transaction control \\(begin\\)`));
});

test('a COMMIT inside a DO block is a finding; begin/end of a PL/pgSQL block and function bodies are not', async (t) => {
  const sql = [
    'create function public.f() returns void language plpgsql as $$ begin commit; end $$;',
    "create function public.g() returns void language plpgsql as 'begin rollback; end';",
    'create procedure public.p() language plpgsql as $body$ begin commit; end $body$;',
    'do $$ begin perform 1; end $$;',
    'do $$',
    'begin',
    '  commit;',
    'end $$;',
    '',
  ].join('\n');
  const findings = await judge(t, sql);
  assert.deepEqual(findings.map(({ line }) => line), [7]);
  assert.match(findings[0]!.message, /commit inside a DO block/);
});

test('a migration with no transaction control has no such finding', async (t) => {
  assert.deepEqual(await judge(t, 'create table public.items (id bigint primary key);\nalter table public.items enable row level security;\n'), []);
});
