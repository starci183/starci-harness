// A migration already on the base branch is immutable (R213), so its destructive-DDL (R259) and dynamic-DDL findings are known items while
// it stays byte-identical there; an entry of hfs.json db.destructiveRulings accepts the exact objects of one migration only while the
// proof a contract migration gets finds them unreferenced. The fixture reproduces the landed identity-sessions migration of a product: five
// dropped account-door functions and a DO block that drops a constraint by name.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { contractReleaseFindings, defaultGit, destructiveMigrationFindings } from '../runtime/scripts/hfs/rules/database-migrations.mjs';
import { LANDED_KNOWN_CODES, landedBase, withLandedMigrationsKnown } from '../runtime/scripts/hfs/rules/database-landed.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { gateVerdict } from '../runtime/scripts/hfs/gate-threshold.mjs';
import type { Finding } from '../runtime/scripts/hfs/rules/rule-types.mjs';

const LANDED = 'db/migrations/20261110101300_identity-sessions-package.sql';
const NEW = 'db/migrations/20261111000000_drop-old-doors.sql';
const DOORS = ['be_auth_open_session', 'be_auth_touch_session', 'be_auth_close_session', 'be_auth_close_other_sessions', 'be_auth_close_user_sessions'];
const SESSIONS_SQL = [
  'do $$',
  'declare old_fk text;',
  'begin',
  "  select conname into old_fk from pg_constraint where conrelid = 'public.identity_refresh_tokens'::regclass and contype = 'f' limit 1;",
  "  if old_fk is not null then execute format('ALTER TABLE public.identity_refresh_tokens DROP CONSTRAINT %I', old_fk); end if;",
  'end $$;',
  'DROP FUNCTION public.be_auth_open_session(uuid, uuid, timestamp with time zone, text, text);',
  'DROP FUNCTION public.be_auth_touch_session(uuid, timestamp with time zone);',
  'DROP FUNCTION public.be_auth_close_session(uuid);',
  'DROP FUNCTION public.be_auth_close_other_sessions(uuid, uuid);',
  'DROP FUNCTION public.be_auth_close_user_sessions(uuid);',
  '',
].join('\n');
const DYNAMIC = { code: 'DB_DYNAMIC_DDL', level: 'error', path: LANDED, message: `${LANDED}:5 DO block runs dynamic SQL` };

const run = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();

/** An app root that is a git repository: `files` committed on main, then a branch `work` checked out with `edits` applied (null deletes). */
function app(t: TestContext, files: Record<string, string>, edits: Record<string, string | null> = {}, { main = true }: { main?: boolean } = {}): string {
  const root = mkdtemp(t, 'hfs-db-landed-');
  const write = (file: string, text: string | null) => {
    const target = path.join(root, file);
    if (text === null) { fs.rmSync(target); return; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  run(root, 'init', '-q', '-b', main ? 'main' : 'trunk');
  for (const [file, text] of Object.entries(files)) write(file, text);
  run(root, 'add', '-A');
  run(root, '-c', 'user.email=spec@example.test', '-c', 'user.name=spec', 'commit', '-qm', 'base');
  run(root, 'switch', '-qc', 'work');
  for (const [file, text] of Object.entries(edits)) write(file, text);
  return root;
}

const tracked = (root: string): string[] => run(root, 'ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
const destructive = (root: string): Finding[] => {
  const files = tracked(root);
  return destructiveMigrationFindings({ repoRoot: root, migrations: files.filter((file) => file.startsWith('db/migrations/')).sort(), files });
};
const ruling = (migration: string, objects: string[]) => JSON.stringify({ hfs: 3, kind: 'app', project: 'demo', db: { destructiveRulings: [{ migration, objects, reason: 'the account doors moved into @starci/auth; verified unreferenced', date: '2026-11-04' }] } });

test('the landed migration of the product: its five destructive drops and its dynamic DDL are known items, the gate stays green', (t) => {
  const root = app(t, { [LANDED]: SESSIONS_SQL });
  const findings: Finding[] = [...destructive(root), DYNAMIC, { code: 'DB_MIGRATION_SHAPE', level: 'error', path: LANDED, message: 'other' }];
  assert.deepEqual(findings.filter((finding) => finding.code === 'DB_MIGRATION_DESTRUCTIVE').map((finding) => finding.object), DOORS.map((door) => `public.${door}`));
  const judged = withLandedMigrationsKnown(findings, { repoRoot: root });
  const known = judged.filter((finding) => finding.level === 'info');
  assert.equal(known.length, 6);
  assert.ok(known.every((finding) => LANDED_KNOWN_CODES.has(finding.code) && finding.landed === 'main' && /known: .* is on main unchanged and immutable \(R213\)/u.test(String(finding.message))));
  assert.deepEqual(judged.filter((finding) => finding.level === 'error').map((finding) => finding.code), ['DB_MIGRATION_SHAPE'], 'only the two codes a rewrite would clear are known');
  assert.equal(gateVerdict(judged.filter((finding) => finding.level === 'error' && finding.code !== 'DB_MIGRATION_SHAPE')).pass, true);
});

test('the same file changed on the branch, a new file, and a repository with no base keep blocking', (t) => {
  const changed = app(t, { [LANDED]: SESSIONS_SQL }, { [LANDED]: `${SESSIONS_SQL}-- edited\n` });
  assert.ok(withLandedMigrationsKnown([...destructive(changed), DYNAMIC], { repoRoot: changed }).every((finding) => finding.level === 'error'));
  const fresh = app(t, { 'README.md': 'app\n' }, { [NEW]: SESSIONS_SQL });
  const freshFindings = destructive(fresh);
  assert.equal(freshFindings.length, 5);
  assert.ok(withLandedMigrationsKnown(freshFindings, { repoRoot: fresh }).every((finding) => finding.level === 'error'));
  const unbased = app(t, { [LANDED]: SESSIONS_SQL }, {}, { main: false });
  assert.equal(landedBase(unbased), null);
  assert.ok(withLandedMigrationsKnown([DYNAMIC], { repoRoot: unbased }).every((finding) => finding.level === 'error'));
  assert.deepEqual(withLandedMigrationsKnown([{ code: 'DB_RLS_REQUIRED', level: 'error', path: LANDED, message: 'm' }], { repoRoot: unbased }).map((finding) => finding.level), ['error'], 'no landable finding reads no git');
});

test('a named base is the ref the landed file is compared with', (t) => {
  const root = app(t, { [LANDED]: SESSIONS_SQL }, {}, { main: false });
  assert.deepEqual(landedBase(root, 'trunk')?.ref, 'trunk');
  const input: Array<{ code: string; level: string; path: string; message?: string; landed?: string }> = [DYNAMIC, { code: 'DB_DYNAMIC_DDL', level: 'warning', path: LANDED }];
  const judged = withLandedMigrationsKnown(input, { repoRoot: root, base: 'trunk', git: defaultGit });
  assert.deepEqual(judged.map((finding) => [finding.level, finding.landed]), [['info', 'trunk'], ['warning', undefined]]);
  assert.match(String(judged[0]?.message), /^db\/migrations\/.+ DO block runs dynamic SQL \(known: /u);
  assert.match(String(withLandedMigrationsKnown([{ ...DYNAMIC, message: undefined }], { repoRoot: root, base: 'trunk' })[0]?.message), /^ \(known: /u);
});

test('a db.destructiveRulings entry accepts exactly its objects while they are unreferenced, and is unproven otherwise', (t) => {
  const accepted = app(t, { 'README.md': 'app\n' }, { [NEW]: SESSIONS_SQL, 'hfs.json': ruling(NEW, DOORS.map((door) => `public.${door}`)) });
  assert.deepEqual(destructive(accepted), []);
  const partial = app(t, { 'README.md': 'app\n' }, { [NEW]: SESSIONS_SQL, 'hfs.json': ruling(NEW, ['public.be_auth_open_session', 'public.be_auth_not_dropped']) });
  const partialFindings = destructive(partial);
  assert.deepEqual(partialFindings.filter((finding) => finding.code === 'DB_MIGRATION_DESTRUCTIVE').length, 4, 'an object the entry does not name keeps blocking');
  assert.match(String(partialFindings.find((finding) => finding.code === 'DB_DESTRUCTIVE_RULING_UNPROVEN')?.message), /names public\.be_auth_not_dropped .* which the migration does not destroy/u);
  const referenced = app(t, { 'README.md': 'app\n' }, {
    [NEW]: SESSIONS_SQL,
    'hfs.json': ruling(NEW, DOORS.map((door) => `public.${door}`)),
    'be/src/modules/domain/identity/persistence/sessions.sql.ts': `export const CLOSE = ${JSON.stringify('select public.be_auth_close_session($1)')};\n`,
  });
  const unproven = destructive(referenced);
  assert.deepEqual(unproven.map((finding) => [finding.code, finding.object]), [['DB_DESTRUCTIVE_RULING_UNPROVEN', 'public.be_auth_close_session']]);
  assert.match(String(unproven[0]?.message), /still references it; the entry holds only while its targets are unreferenced/u);
  const stale = app(t, { 'README.md': 'app\n' }, { 'hfs.json': ruling('db/migrations/20261112000000_gone.sql', ['public.x']) });
  assert.deepEqual(destructive(stale).map((finding) => [finding.code, finding.path]), [['DB_DESTRUCTIVE_RULING_UNPROVEN', 'hfs.json']]);
  const contract = 'db/migrations/20261111000000_old-doors_contract_drop.sql';
  const contracted = app(t, { 'README.md': 'app\n' }, { [contract]: 'drop function public.be_auth_close_session(uuid);\n', 'hfs.json': ruling(contract, ['public.be_auth_close_session']) });
  assert.deepEqual(destructive(contracted), [], 'a contract migration is judged as a contract migration');
});

test('an accepted migration new since the previous release is proven against that release, for its accepted objects only', (t) => {
  const source = 'be/src/modules/domain/identity/persistence/sessions.sql.ts';
  const root = app(t, { 'README.md': 'app\n', [source]: `export const CLOSE = ${JSON.stringify('select public.be_auth_close_session($1)')};\n` });
  run(root, 'tag', 'v1.0.0');
  fs.rmSync(path.join(root, source));
  fs.mkdirSync(path.join(root, 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(root, NEW), SESSIONS_SQL);
  fs.writeFileSync(path.join(root, 'hfs.json'), ruling(NEW, ['public.be_auth_close_session', 'public.be_auth_open_session']));
  run(root, 'add', '-A');
  run(root, '-c', 'user.email=spec@example.test', '-c', 'user.name=spec', 'commit', '-qm', 'drop');
  return contractReleaseFindings({ repoRoot: root, migrations: [NEW], git: defaultGit }).then((findings: Finding[]) => {
    assert.deepEqual(findings.map((finding) => [finding.code, finding.object, finding.release]), [['DB_DESTRUCTIVE_RULING_UNPROVEN', 'public.be_auth_close_session', 'v1.0.0']]);
  });
});

test('the declaration takes rulings of one exact migration, its objects, a reason and the date, and refuses any other shape', () => {
  const declared = (destructiveRulings: unknown) => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite', db: { destructiveRulings }, sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }], grammar: 'core' } } }, ['be', 'fe']).filter((problem) => problem.startsWith('db.'));
  const good = { migration: LANDED, objects: ['public.be_auth_close_session'], reason: 'moved into the package', date: '2026-11-04' };
  assert.deepEqual(declared([good, { ...good, migration: 'db/migrations/20261111000000_doors_contract_drop.sql' }]), []);
  for (const bad of ['all', [{ ...good, migration: 'db/migrations/*.sql' }], [{ ...good, objects: [] }], [{ ...good, reason: ' ' }], [{ ...good, date: 'today' }], [{ ...good, scope: 'all' }], [null]]) {
    assert.equal(declared(bad).length, 1, JSON.stringify(bad));
  }
});
