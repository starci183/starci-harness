// proves: DB_BASELINE_SHAPE@lite, DB_BASELINE_SHAPE@full
// proves: DB_MIGRATION_SHAPE@lite, DB_MIGRATION_SHAPE@full
// proves: DB_ARCHIVE_MUTATED@lite, DB_ARCHIVE_MUTATED@full
// A declared one-time baseline reset (hfs.json db.baselineReset): the declared baseline replaces the whole older migration history, so the
// immutability checks (R213, R257) accept the removal of every older active and archived file while the reset is pending; without the
// declaration the old behaviour stays, and the reset is judged: exactly one baseline, carrying the ruling, sorting before every later migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';
import { databaseBaselineFindings } from '../runtime/scripts/hfs/rules/database-baseline.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';

const made: string[] = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const OLD_FIRST = 'db/migrations/20260101120000_first.sql';
const OLD_SECOND = 'db/migrations/20260102120000_second.sql';
const ARCHIVED = 'db/migrations/archive/20250101120000_ancient.sql';
const BASELINE = 'db/migrations/20261106000000_baseline.sql';
const BASELINE_SQL = '-- starci:baseline-reset nivo-reset-2026-11-05\ncreate table public.items (id uuid primary key);\nalter table public.items enable row level security;\n';
const OLD_SQL = 'create table public.old (id uuid primary key);\n';
const RESET = { baseline: BASELINE, ruling: 'nivo-reset-2026-11-05', date: '2026-11-05', reason: 'a clean database keeps no data worth migrating' };

type Git = (args: string[]) => { ok: boolean; stdout: string };

/** The committed history of the base branch: `base` files and their text; HEAD holds the same. */
function history(base: Record<string, string>): Git {
  return (args) => {
    if (args[0] === 'merge-base') return { ok: true, stdout: 'base-sha' };
    if (args[0] === 'ls-tree') return { ok: true, stdout: `${Object.keys(base).join('\0')}\0` };
    const file = args[1]?.split(':./')[1] ?? '';
    return Object.hasOwn(base, file) ? { ok: true, stdout: base[file]! } : { ok: false, stdout: '' };
  };
}

const NONE = 'none';
const BASE_CHAIN = { [OLD_FIRST]: OLD_SQL, [OLD_SECOND]: OLD_SQL, [ARCHIVED]: 'select 1;\n' };

function fixture(contents: Record<string, string>, reset: unknown = RESET): string {
  const declared = reset === NONE ? {} : { baselineReset: reset };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-baseline-reset-'));
  made.push(dir);
  fs.writeFileSync(path.join(dir, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'reset', edition: 'lite', db: declared, sides: { be: { apps: [] }, fe: { apps: [] } } }));
  for (const [file, text] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

const codes = async (contents: Record<string, string>, base: Record<string, string>, reset: unknown = RESET) => {
  const dir = fixture(contents, reset);
  const files = Object.keys(contents);
  const findings = [
    ...await checkDatabase({ repoRoot: dir, files, git: history(base) }),
    ...databaseBaselineFindings({ repoRoot: dir, files, all: files, repo: { kind: 'app', edition: 'lite' }, isRoot: true, inScope: () => true, git: history(base) }),
  ];
  return findings.filter((finding) => ['DB_MIGRATION_SHAPE', 'DB_BASELINE_SHAPE', 'DB_ARCHIVE_MUTATED'].includes(finding.code)).map((finding) => `${finding.code} ${finding.path}`).sort();
};

test('a declared reset accepts the removal of every older active and archived file, the baseline being the new base chain', async () => {
  assert.deepEqual(await codes({ [BASELINE]: BASELINE_SQL }, BASE_CHAIN), []);
  const later = 'db/migrations/20261107000000_items-note.sql';
  assert.deepEqual(await codes({ [BASELINE]: BASELINE_SQL, [later]: 'alter table public.items add column note text;\n' }, BASE_CHAIN), [], 'a migration after the baseline appends as usual');
});

test('without the declaration deleting migrations already on the base branch is refused, as it always was', async () => {
  const without = await codes({ [BASELINE]: BASELINE_SQL.replace(/^-- starci:baseline-reset.*\n/, '') }, BASE_CHAIN, NONE);
  assert.ok(without.includes(`DB_MIGRATION_SHAPE ${OLD_FIRST}`), without.join(', '));
  assert.ok(without.includes(`DB_MIGRATION_SHAPE ${OLD_SECOND}`), without.join(', '));
  assert.ok(without.includes(`DB_ARCHIVE_MUTATED ${ARCHIVED}`), without.join(', '));
});

test('the reset is judged: a second baseline file, a missing marker or ruling, an older file kept, a stamp before the baseline and a missing baseline are refused', async () => {
  const second = 'db/migrations/20261107000000_other-baseline.sql';
  assert.ok((await codes({ [BASELINE]: BASELINE_SQL, [second]: BASELINE_SQL }, BASE_CHAIN)).includes(`DB_BASELINE_SHAPE ${second}`), 'a second baseline file');
  assert.ok((await codes({ [BASELINE]: BASELINE_SQL.replace('nivo-reset-2026-11-05', 'another-ruling') }, BASE_CHAIN)).includes(`DB_BASELINE_SHAPE ${BASELINE}`), 'another ruling');
  assert.ok((await codes({ [BASELINE]: BASELINE_SQL.replace(/^-- starci:baseline-reset.*\n/, '') }, BASE_CHAIN)).includes(`DB_BASELINE_SHAPE ${BASELINE}`), 'no marker');
  assert.ok((await codes({ [BASELINE]: BASELINE_SQL, [OLD_SECOND]: OLD_SQL }, BASE_CHAIN)).includes(`DB_MIGRATION_SHAPE ${OLD_SECOND}`), 'an older file kept beside the baseline');
  const early = 'db/migrations/20260301000000_early.sql';
  assert.ok((await codes({ [BASELINE]: BASELINE_SQL, [early]: 'select 1;\n' }, BASE_CHAIN)).includes(`DB_MIGRATION_SHAPE ${early}`), 'a stamp before the baseline');
  assert.ok((await codes({ [OLD_FIRST + 'x']: OLD_SQL }, BASE_CHAIN)).some((entry) => entry.startsWith('DB_BASELINE_SHAPE')), 'the declared baseline absent');
});

test('once the baseline is on the base branch the declaration is spent: deleting it again is refused like any landed migration', async () => {
  const landed = { [BASELINE]: BASELINE_SQL };
  assert.deepEqual(await codes({ [BASELINE]: BASELINE_SQL }, landed), [], 'unchanged');
  assert.ok((await codes({ [BASELINE]: BASELINE_SQL + 'select 2;\n' }, landed)).includes(`DB_MIGRATION_SHAPE ${BASELINE}`), 'a changed landed baseline');
  const later = 'db/migrations/20261107000000_items-note.sql';
  assert.ok((await codes({ [later]: 'select 1;\n', [BASELINE.replace('baseline', 'baseline2')]: BASELINE_SQL }, { ...landed, [later]: 'select 1;\n' })).some((entry) => entry.startsWith('DB_MIGRATION_SHAPE')), 'the landed baseline removed');
});

test('the declaration takes db.baselineReset as one baseline file, a ruling id, a date and a reason, and refuses any other shape', () => {
  const problems = (baselineReset: unknown) => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite', db: { baselineReset }, sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }], grammar: 'core' } } }, ['be', 'fe']).filter((problem) => problem.startsWith('db.'));
  assert.deepEqual(problems(RESET), []);
  for (const bad of [{ ...RESET, baseline: 'db/migrations/baseline.sql' }, { ...RESET, baseline: 'db/migrations/archive/20260101000000_x.sql' }, { ...RESET, ruling: 'has space' }, { ...RESET, date: '5/11/2026' }, { ...RESET, reason: ' ' }, { ...RESET, extra: 1 }, { baseline: RESET.baseline }, 'x']) {
    assert.equal(problems(bad).length, 1, JSON.stringify(bad));
  }
});
