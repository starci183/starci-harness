// `starci app codemod account-doors`: a lite app that signs in over direct grants on auth.users and auth.identities moves to the account doors in
// two releases, an expand migration that creates the doors and, a release later, a contract migration that revokes the grants (R255, BE-PERSISTENCE-19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { accountDoorsMarkdown, migrateAccountDoors } from '../codemod/account-doors.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { retiredFiles } from '../sync/index.mjs';
import { checkDatabase } from '../runtime/scripts/hfs/rules/database.mjs';
import { withoutGitLocalEnv } from '../runtime/scripts/lib/git.mjs';

const TEMPLATES = path.resolve(import.meta.dirname, '..', 'templates');
const DOORS = fs.readFileSync(path.join(TEMPLATES, 'app', 'auth-doors.sql.partial'), 'utf8');
const OLD_BASELINE = `create role app_be login noinherit nobypassrls nosuperuser;
grant usage on schema auth to app_be;
grant select, insert, update on table auth.users to app_be;
grant select, insert on table auth.identities to app_be;
`;
const BASELINE = 'db/migrations/20260101120000_baseline.sql';
const ENTITY = 'be/src/modules/domain/identity/persistence/entities/auth-user.entity.ts';
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

const made: string[] = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

/** A lite app root holding the old baseline, and the old entity file unless the sync already deleted it. */
function app(files: Record<string, string> = {}, { edition = 'lite', synced = false }: { edition?: string; synced?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-account-doors-'));
  made.push(root);
  const contents: Record<string, string> = { 'hfs.json': JSON.stringify({ hfs: 3, kind: 'app', project: 'doors', edition, sides: { be: { apps: [] }, fe: { apps: [] } } }), [BASELINE]: OLD_BASELINE, ...files };
  if (!synced) contents[ENTITY] = '@Entity({ schema: "auth", name: "users" })\nexport class AuthUserEntity {}\n';
  for (const [file, text] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  execFileSync('git', ['-C', root, 'init', '-b', 'main', '-q'], { env: withoutGitLocalEnv(process.env), stdio: 'ignore' });
  return root;
}

const migrations = (root: string): string[] => fs.readdirSync(path.join(root, 'db', 'migrations')).sort();

test('1. the expand step writes the doors migration with the text of the lite baseline, a dry run writes nothing', () => {
  const root = app();
  const dry = migrateAccountDoors({ root, now: () => NOW });
  assert.deepEqual(dry.changes.map((change) => change.phase), ['expand']);
  assert.equal(dry.changes[0]!.file, 'db/migrations/20261103120000_account-doors.sql');
  assert.deepEqual(migrations(root), ['20260101120000_baseline.sql']);
  const done = migrateAccountDoors({ root, write: true, now: () => NOW });
  const [created] = done.changes;
  assert.equal(fs.readFileSync(path.join(root, created!.file), 'utf8'), DOORS);
  assert.match(created!.file, /^db\/migrations\/\d{14}_account-doors\.sql$/u);
  assert.ok(created!.file.slice(14, 28) > '20260101120000', 'it sorts after the committed chain');
  assert.equal(done.next.length, 2);
});

test('2. a second run, and an app whose migrations already define the doors, change nothing', () => {
  const root = app();
  migrateAccountDoors({ root, write: true, now: () => NOW });
  assert.deepEqual(migrateAccountDoors({ root, write: true, now: () => NOW }).changes, []);
  const baseline = app({ [BASELINE]: `${OLD_BASELINE}${DOORS}` });
  assert.deepEqual(migrateAccountDoors({ root: baseline, write: true, now: () => NOW }).changes, []);
  assert.deepEqual(migrations(baseline), ['20260101120000_baseline.sql']);
});

test('3. the contract step waits for the doors and for the sync, then revokes the three grants of the declared role', () => {
  const before = app();
  assert.deepEqual(migrateAccountDoors({ root: before, contract: true, write: true, now: () => NOW }).findings.map((finding) => finding.file), ['db/migrations', ENTITY]);
  assert.deepEqual(migrations(before), ['20260101120000_baseline.sql']);

  const root = app({ 'db/migrations/20260102120000_account-doors.sql': DOORS }, { synced: true });
  const report = migrateAccountDoors({ root, contract: true, write: true, now: () => NOW });
  assert.deepEqual(report.findings, []);
  const [created] = report.changes;
  assert.match(created!.file, /^db\/migrations\/\d{14}_contract_revoke-auth-grants\.sql$/u);
  const text = fs.readFileSync(path.join(root, created!.file), 'utf8');
  for (const line of ['revoke select, insert, update on table auth.users from app_be;', 'revoke select, insert on table auth.identities from app_be;', 'revoke usage on schema auth from app_be;']) assert.ok(text.includes(line), line);
  assert.deepEqual(migrateAccountDoors({ root, contract: true, write: true, now: () => NOW }).changes, [], 'the contract step is done once');
});

test('4. a full app is refused, and an app that never granted on schema auth has nothing to revoke', () => {
  assert.match(migrateAccountDoors({ root: app({}, { edition: 'full' }), now: () => NOW }).findings[0]!.reason, /lite edition/u);
  const clean = app({ [BASELINE]: 'create role app_be login noinherit nobypassrls nosuperuser;\n', 'db/migrations/20260102120000_account-doors.sql': DOORS }, { synced: true });
  assert.deepEqual(migrateAccountDoors({ root: clean, contract: true, now: () => NOW }).changes, []);
});

test('5. the two migrations pass the database checks: R255 flags the old grants until the contract migration revokes them', async () => {
  const root = app({ 'db/migrations/20260102120000_account-doors.sql': DOORS }, { synced: true });
  const codes = async (): Promise<string[]> => {
    const files = migrations(root).map((name) => `db/migrations/${name}`);
    return (await checkDatabase({ repoRoot: root, files })).filter((finding) => finding.code === 'DB_APP_ROLE').map((finding) => finding.path);
  };
  assert.deepEqual(await codes(), [BASELINE, BASELINE, BASELINE], 'usage, users and identities');
  migrateAccountDoors({ root, contract: true, write: true, now: () => NOW });
  assert.deepEqual(await codes(), []);
  const all = (await checkDatabase({ repoRoot: root, files: migrations(root).map((name) => `db/migrations/${name}`) })).map((finding) => finding.code);
  assert.deepEqual(all.filter((code) => code === 'DB_DEFINER_REVOKE' || code === 'DB_DEFINER_SAFE' || code === 'DB_MIGRATION_DESTRUCTIVE'), []);
});

test('6. the verb takes --contract, prints the report and exits 1 only for a case left for a person', async () => {
  assert.ok(CODEMODS.includes('account-doors'));
  const root = app();
  const out: string[] = [];
  assert.equal(await codemodMain(['account-doors'], { cwd: root, stdout: (text) => out.push(text) }), 0);
  assert.match(out.join(''), /# account-doors[\s\S]*Step expand: 1 migration to write/u);
  assert.equal(await codemodMain(['account-doors', '--contract'], { cwd: root, stdout: (text) => out.push(text) }), 1);
  assert.throws(() => codemodMain(['account-doors', '--bogus'], { cwd: root, stdout: () => undefined }), /unknown codemod option/u);
  assert.match(accountDoorsMarkdown(migrateAccountDoors({ root, contract: true })), /Left for a person/u);
});

test('7. sync retires the two auth entity files of the old sign-in glue', () => {
  const root = app();
  assert.deepEqual(retiredFiles(root, { edition: 'lite' }), [ENTITY]);
  assert.deepEqual(retiredFiles(app({}, { synced: true }), { edition: 'lite' }), []);
});

test('8. an app that has the six earlier doors, and Nivo\'s three-argument be_auth_set_password, gets only the two new doors', () => {
  const six = DOORS.replace(/\n-- Stamps the confirmation[\s\S]*?\$\$;\n\n-- Sets a new password hash;[\s\S]*?\$\$;\n/u, '')
    .split('\n').filter((line) => !/be_auth_(?:confirm_user|set_password)/u.test(line)).join('\n');
  assert.ok(!six.includes('be_auth_confirm_user') && !six.includes('be_auth_set_password'));
  const nivoOverload = 'CREATE FUNCTION public.be_auth_set_password(p_user uuid, p_hash text, p_now timestamp with time zone) RETURNS void\n    LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO \'\' AS $$ select 1 $$;\n';
  const root = app({ 'db/migrations/20260102120000_doors.sql': six, 'db/migrations/20260102130000_set-password.sql': nivoOverload }, { synced: true });
  const [created] = migrateAccountDoors({ root, write: true, now: () => NOW }).changes;
  const text = fs.readFileSync(path.join(root, created!.file), 'utf8');
  assert.deepEqual([...text.matchAll(/CREATE FUNCTION public\.(\w+)\(/gu)].map((match) => match[1]), ['be_auth_confirm_user', 'be_auth_set_password']);
  assert.match(text, /GRANT EXECUTE ON FUNCTION public\.be_auth_set_password\(uuid, text, boolean, timestamp with time zone\) TO app_be;/u);
  assert.doesNotMatch(text, /be_auth_user_by_email/u);
  assert.deepEqual(migrateAccountDoors({ root, write: true, now: () => NOW }).changes, [], 'a second run adds nothing');
  assert.equal(migrateAccountDoors({ root, contract: true, now: () => NOW }).findings.length, 0, 'the eight doors are defined, so the contract step can go');
});
