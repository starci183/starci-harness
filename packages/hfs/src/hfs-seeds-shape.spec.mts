// proves: HFS_SEEDS_SHAPE@lite HFS_SEEDS_SHAPE@full HFS_SEED_MANIFEST@lite HFS_SEED_MANIFEST@full HFS_SEED_DDL@lite HFS_SEED_DDL@full
// proves: HFS_SEED_DATA_SCHEMA@lite HFS_SEED_DATA_SCHEMA@full HFS_SEED_TEST_DATA@lite HFS_SEED_TEST_DATA@full
// proves: HFS_SEED_SECRET_REF@lite HFS_SEED_SECRET_REF@full
// The seed data of an app lives in the seed levels of .starcistacks (R375): the shared seeds/ and <env>/seeds/ of a declared environment, each a
// seeds.yaml manifest (starci/seeds@1) listing every file of its sql/, data/ and files/; no custody, no schema statement (seed data is never a
// migration), data that validates against its declared schema, no test data where production applies; a plaintext secret is R06's, and the
// lite db/ tree keeps no SQL but migrations, the archive and the bootstrap (R332), so the db/seed.sql of manifest 3.17 is refused.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { liteDbPathFindings } from '../runtime/scripts/hfs/rules/database.mjs';
import { databaseConfigFindings } from '../runtime/scripts/hfs/rules/database-config.mjs';
import { declaredEnvironments, isSeedFile, seedLiterals, seedsFindings } from '../runtime/scripts/hfs/rules/seeds.mjs';
import { secretFileFindings } from '../runtime/scripts/hfs/rules/secrets.mjs';
import { addSeedEntries, entryDigest, normalizeSeeds, readSeedLevel, resolveSecrets, secretReference, secretReferences } from '../runtime/scripts/hfs/stack-seeds-config.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const DECLARATION = `schema: starci/application-stacks@1
environments:
  dev: {runtime: docker-compose}
  production: {runtime: docker-swarm}
services:
  sonar:
    provider: sonarqube
    mode: local
    stack:
      owner: host
      root: .claude/ext/sonar
`;
const MODULE_SCHEMA = JSON.stringify({ type: 'object', required: ['id'], properties: { id: { type: 'string' } } });
const manifest = (entries: string[]): string => `schema: starci/seeds@1\nentries:\n${entries.map((entry) => `  - ${entry}\n`).join('')}`;
const EMPTY = 'schema: starci/seeds@1\nentries: []\n';

function tree(t: TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-seeds-shape-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

const judge = (t: TestContext, files: Record<string, string>) => seedsFindings({ repoRoot: tree(t, files), files: Object.keys(files) });
const codes = (list: Array<{ code: string; path?: string | undefined }>) => list.map((item) => `${item.code} ${String(item.path)}`).sort();
const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** A valid tree: shared plans and modules, dev demo accounts, production initial data and an asset. */
const VALID: Record<string, string> = {
  '.starcistacks/application-stacks.yaml': DECLARATION,
  'be/schemas/module.schema.json': MODULE_SCHEMA,
  '.starcistacks/seeds/seeds.yaml': manifest([
    '{id: plans, kind: sql, path: sql/010-plans.sql, target: primary, mode: upsert}',
    '{id: modules, kind: data, path: data/modules, target: [npm, run, -w, be, cli, --, modules, seed], schema: be/schemas/module.schema.json, mode: upsert, after: [plans]}',
  ]),
  '.starcistacks/seeds/sql/010-plans.sql': "insert into plans (code) values ('free') on conflict do nothing;\n-- create table is a word in a comment only\n",
  '.starcistacks/seeds/data/modules/sales.json': '{"id": "sales"}\n',
  '.starcistacks/seeds/data/modules/chatbot.yaml': 'id: chatbot\n',
  '.starcistacks/seeds/files/.gitkeep': '',
  '.starcistacks/dev/seeds/seeds.yaml': manifest(['{id: demo, kind: sql, path: sql/demo.sql, target: primary, mode: once, after: [plans]}']),
  '.starcistacks/dev/seeds/sql/demo.sql': "insert into users (email) values ('demo@example.test') on conflict do nothing;\n",
  '.starcistacks/production/seeds/seeds.yaml': manifest(['{id: logo, kind: files, path: files/brand, target: media, mode: once}']),
  '.starcistacks/production/seeds/files/brand/logo.png': 'png',
};

test('a seed file is a file of a seed level but its placeholders, and the environments come with their runtime', (t) => {
  assert.equal(isSeedFile('.starcistacks/seeds/sql/010-plans.sql'), true);
  assert.equal(isSeedFile('.starcistacks/dev/seeds/data/.gitkeep'), false);
  assert.equal(isSeedFile('db/seed.sql'), false);
  assert.deepEqual([...(declaredEnvironments(tree(t, { '.starcistacks/application-stacks.yaml': DECLARATION })) ?? [])], [['dev', 'docker-compose'], ['production', 'docker-swarm']]);
  assert.equal(declaredEnvironments(tree(t, {})), null);
  assert.equal(declaredEnvironments(tree(t, { '.starcistacks/application-stacks.yaml': 'environments: [dev]\n' })), null);
});

test('R375 accepts the three levels with their manifests, and judges nothing without a seed file', (t) => {
  assert.deepEqual(judge(t, VALID), []);
  assert.deepEqual(judge(t, { '.starcistacks/application-stacks.yaml': DECLARATION }), []);
});

test('HFS_SEEDS_SHAPE: a loose seed, a level of an undeclared environment and custody in a level', (t) => {
  const list = judge(t, {
    '.starcistacks/application-stacks.yaml': DECLARATION,
    '.starcistacks/dev/seeds/old.sql': 'select 1;\n',
    '.starcistacks/staging/seeds/seeds.yaml': EMPTY,
    '.starcistacks/seeds/data/ai.enc.yaml': 'sops: {}\n',
    '.starcistacks/seeds/files/tls.pem': 'x\n',
  });
  assert.deepEqual(codes(list), ['HFS_SEEDS_SHAPE .starcistacks/dev/seeds/old.sql', 'HFS_SEEDS_SHAPE .starcistacks/seeds/data/ai.enc.yaml', 'HFS_SEEDS_SHAPE .starcistacks/seeds/files/tls.pem', 'HFS_SEEDS_SHAPE .starcistacks/staging/seeds/seeds.yaml']);
  assert.match(list.find((item) => item.path.endsWith('old.sql'))?.message ?? '', /starci app codemod seeds-layout/u);
});

test('HFS_SEED_MANIFEST: a level without a manifest, a missing path, an unlisted file, an unknown after, a cycle and a bad field', (t) => {
  const list = judge(t, {
    '.starcistacks/application-stacks.yaml': DECLARATION,
    '.starcistacks/production/seeds/sql/plans.sql': 'select 1;\n',
    '.starcistacks/seeds/seeds.yaml': manifest([
      '{id: a, kind: sql, path: sql/a.sql, target: primary, mode: upsert, after: [b]}',
      '{id: b, kind: sql, path: sql/b.sql, target: primary, mode: upsert, after: [a]}',
      '{id: c, kind: sql, path: sql/gone.sql, target: primary, mode: upsert, after: [nope]}',
      '{id: d, kind: data, path: data/x.json, target: primary, mode: sometimes, extra: 1}',
    ]),
    '.starcistacks/seeds/sql/a.sql': 'select 1;\n',
    '.starcistacks/seeds/sql/b.sql': 'select 1;\n',
    '.starcistacks/seeds/sql/unlisted.sql': 'select 1;\n',
  });
  const messages = list.filter((item) => item.code === 'HFS_SEED_MANIFEST').map((item) => item.message).join('\n');
  for (const expected of [/production\/seeds holds seed files but no seeds\.yaml/u, /sql\/gone\.sql does not exist in the level/u, /unlisted\.sql is listed by no entry/u, /nope is no entry of this level or the shared level/u, /form a cycle/u, /\.mode: must be one of once, upsert/u, /\.extra: is not a field of the seed entry block/u, /\.target: must be the argv list/u, /\.path: data\/x\.json does not exist/u, /\.schema: must name the JSON schema/u]) assert.match(messages, expected);
});

test('the manifest normaliser refuses a wrong schema, a non-list, a duplicate id, an unknown kind, a path outside its kind and a schema on a sql entry', (t) => {
  const root = tree(t, { 'sql/a.sql': '' });
  const problems = (doc: unknown) => normalizeSeeds(doc, root).problems.map((item) => `${item.at}: ${item.message}`).join('\n');
  assert.match(problems({ schema: 'x', entries: [] }), /schema: must be starci\/seeds@1/u);
  assert.match(problems({ schema: 'starci/seeds@1', entries: {} }), /entries: must be a list/u);
  assert.match(problems([]), /manifest: must be a mapping/u);
  const entry = { id: 'a', kind: 'sql', path: 'sql/a.sql', target: 'primary', mode: 'once' };
  assert.match(problems({ schema: 'starci/seeds@1', entries: [entry, entry] }), /a is declared twice/u);
  assert.match(problems({ schema: 'starci/seeds@1', entries: [{ ...entry, kind: 'blob' }] }), /kind: must be one of sql, data, test-account, files/u);
  assert.match(problems({ schema: 'starci/seeds@1', entries: [{ ...entry, path: 'data/a.sql' }] }), /path: must be a path under sql\//u);
  assert.match(problems({ schema: 'starci/seeds@1', entries: [{ ...entry, schema: 'x.json', after: 'a' }] }), /after: must be a list[\s\S]*schema: is a field of a data or test-account entry only/u);
  assert.match(readSeedLevel(tree(t, { '.starcistacks/seeds/seeds.yaml': 'a: [' }), null).problems[0]?.message ?? '', /does not parse/u);
  assert.deepEqual(readSeedLevel(tree(t, { '.starcistacks/seeds/seeds.yaml': '' }), null).problems.map((item) => item.at), ['schema']);
});

test('the manifest normaliser takes always and a probe where they can run, and refuses them where they cannot', (t) => {
  const root = tree(t, { 'sql/a.sql': '', 'files/b.png': 'png' });
  const sql = { id: 'a', kind: 'sql', path: 'sql/a.sql', target: 'primary', mode: 'upsert' };
  const files = { id: 'b', kind: 'files', path: 'files/b.png', target: 'media', mode: 'once' };
  const level = (entries: unknown[]) => normalizeSeeds({ schema: 'starci/seeds@1', entries }, root);
  const problems = (entries: unknown[]) => level(entries).problems.map((item) => `${item.at}: ${item.message}`).join('\n');
  assert.deepEqual(level([{ ...sql, probe: ['node', 'cli.js', 'plans', 'probe'] }, { ...sql, id: 'c', mode: 'always' }]).entries.map((entry) => [entry.mode, entry.probe]), [['upsert', ['node', 'cli.js', 'plans', 'probe']], ['always', null]]);
  assert.match(problems([{ ...sql, probe: 'node cli.js probe' }]), /probe: must be the argv list of the app command that exits non-zero when the target drifted \(never a shell line\)/u);
  assert.match(problems([{ ...sql, mode: 'once', probe: ['probe'] }]), /probe: is a field of an upsert entry only/u);
  assert.match(problems([{ ...sql, mode: 'always', probe: ['probe'] }]), /probe: is a field of an upsert entry only/u);
  assert.match(problems([{ ...files, probe: ['probe'] }]), /probe: is no field of a files entry/u);
  assert.match(problems([{ ...files, mode: 'always' }]), /mode: always is no mode of a files entry/u);
  const [probed] = level([{ ...sql, probe: ['one'] }]).entries;
  const [other] = level([{ ...sql, probe: ['two'] }]).entries;
  assert.ok(probed && other);
  assert.notEqual(entryDigest(root, probed), entryDigest(root, other), 'a changed probe changes the digest');
});

test('the apply order is manifest order with each entry after the ones it names, and the digest follows the content', (t) => {
  const root = tree(t, { 'sql/a.sql': '1', 'sql/b.sql': '2', 'data/m/x.json': '{}' });
  const entries = normalizeSeeds({ schema: 'starci/seeds@1', entries: [
    { id: 'b', kind: 'sql', path: 'sql/b.sql', target: 'primary', mode: 'once', after: ['a'] },
    { id: 'a', kind: 'sql', path: 'sql/a.sql', target: 'primary', mode: 'once', after: ['shared-one'] },
    { id: 'm', kind: 'data', path: 'data/m', target: ['node', 'load.js'], schema: 's.json', mode: 'upsert' },
  ] }, root, new Set(['shared-one'])).entries;
  assert.deepEqual(entries.map((entry) => entry.id), ['a', 'm', 'b']);
  const [a] = entries;
  assert.ok(a);
  const before = entryDigest(root, a);
  fs.writeFileSync(path.join(root, 'sql/a.sql'), '3');
  assert.notEqual(entryDigest(root, a), before);
  assert.match(before, /^[0-9a-f]{64}$/u);
});

test('HFS_SEED_DDL: a sql entry that changes the schema or its grants is refused at the line of the statement, inside a DO block too', (t) => {
  const sql = ["insert into plans (code) values ('free');", 'create table public.extra (id uuid);', 'ALTER TABLE public.plans ADD COLUMN x int;', 'grant select on public.plans to app_be;', 'do $$ begin drop table public.old; end $$;', 'truncate public.notes;', ''].join('\n');
  const list = judge(t, { ...VALID, '.starcistacks/seeds/sql/010-plans.sql': sql });
  assert.deepEqual(list.map((item) => [item.code, item.line]), [['HFS_SEED_DDL', 2], ['HFS_SEED_DDL', 3], ['HFS_SEED_DDL', 4], ['HFS_SEED_DDL', 5], ['HFS_SEED_DDL', 6]]);
  assert.match(list[1]?.message ?? '', /runs ALTER, a schema change; seed data is never a migration/u);
});

test('HFS_SEED_DATA_SCHEMA: a document off its schema, one that does not parse, and a schema that cannot be read', (t) => {
  const off = judge(t, { ...VALID, '.starcistacks/seeds/data/modules/sales.json': '{"name": "sales"}\n', '.starcistacks/seeds/data/modules/chatbot.yaml': 'id: [\n' });
  assert.deepEqual(codes(off), ['HFS_SEED_DATA_SCHEMA .starcistacks/seeds/data/modules/chatbot.yaml', 'HFS_SEED_DATA_SCHEMA .starcistacks/seeds/data/modules/sales.json']);
  const unread = judge(t, { ...VALID, 'be/schemas/module.schema.json': '{ not' });
  assert.deepEqual(codes(unread), ['HFS_SEED_DATA_SCHEMA .starcistacks/seeds/seeds.yaml']);
});

test('HFS_SEED_TEST_DATA: test markers in the shared level or a production level, never in a docker-compose level', (t) => {
  const list = judge(t, {
    ...VALID,
    '.starcistacks/seeds/sql/010-plans.sql': "insert into users (email) values ('owner@example.test');\n",
    '.starcistacks/production/seeds/seeds.yaml': manifest(['{id: logo, kind: files, path: files/brand, target: media, mode: once}', '{id: ws, kind: data, path: data/ws.json, target: [node, ws.js], schema: be/schemas/module.schema.json, mode: once}']),
    '.starcistacks/production/seeds/files/brand/test-logo.png': 'png',
    '.starcistacks/production/seeds/data/ws.json': '{"id": "uat-workspace"}\n',
  });
  assert.deepEqual(codes(list), ['HFS_SEED_TEST_DATA .starcistacks/production/seeds/data/ws.json', 'HFS_SEED_TEST_DATA .starcistacks/production/seeds/files/brand/test-logo.png', 'HFS_SEED_TEST_DATA .starcistacks/seeds/sql/010-plans.sql']);
});

test('HFS_SEED_PII scans the SQL and the JSON and YAML data of the levels, and seed literals skip a document that does not parse', (t) => {
  const files = {
    'hfs.json': JSON.stringify({ hfs: 3, kind: 'app', edition: 'lite' }),
    '.starcistacks/seeds/sql/owners.sql': "insert into owners values ('owner@real.invalid');\n",
    '.starcistacks/dev/seeds/data/people.json': '{\n  "people": [\n    {"mail": "demo@example.test"},\n    {"mail": "someone@real.invalid"}\n  ]\n}\n',
    '.starcistacks/dev/seeds/data/people.yaml': 'mail: other@real.invalid\n',
    '.starcistacks/dev/seeds/files/notes.txt': 'someone@real.invalid',
  };
  const list = databaseConfigFindings({ repoRoot: tree(t, files), files: Object.keys(files), all: Object.keys(files), repo: { edition: 'lite' }, isRoot: true });
  assert.deepEqual(list.map((item) => `${item.code} ${item.path}:${String(item.line)}`), ['HFS_SEED_PII .starcistacks/seeds/sql/owners.sql:1', 'HFS_SEED_PII .starcistacks/dev/seeds/data/people.json:4', 'HFS_SEED_PII .starcistacks/dev/seeds/data/people.yaml:1']);
  assert.deepEqual(seedLiterals('x.json', '{ not'), []);
});

test('a plaintext secret on a seed line is R06 (HFS_PLAINTEXT_SECRET), the one judgement of every tracked file', () => {
  // The key header is built from its parts, so this spec holds no secret-shaped line of its own.
  const header = ['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ');
  const list = secretFileFindings({ file: '.starcistacks/seeds/data/integrations.json', text: `{"key": "${header}\\nMIIE"}\n` });
  assert.equal(list[0]?.code, 'HFS_PLAINTEXT_SECRET');
});

test('R332: the SQL of a seed level is no SQL outside db/, and db/ keeps no SQL but its migrations, the archive and the bootstrap', () => {
  const list = liteDbPathFindings(['.starcistacks/seeds/sql/a.sql', 'db/seed.sql', 'db/bootstrap.sql', 'db/migrations/20261103000000_x.sql', 'db/migrations/archive/20250101000000_y.sql', 'scripts/fix.sql']);
  assert.deepEqual(list.map((item) => item.path), ['db/seed.sql', 'scripts/fix.sql']);
  assert.match(list[0]?.message ?? '', /starci app codemod seeds-layout moves it/u);
});

test('addSeedEntries creates a manifest, keeps an id it already holds and writes nothing on a dry run', (t) => {
  const root = tree(t, {});
  const entry = { id: 'reference', kind: 'sql' as const, path: 'sql/reference.sql', target: 'primary', mode: 'upsert' as const };
  assert.deepEqual(addSeedEntries(root, null, [entry], false), ['reference']);
  assert.equal(fs.existsSync(path.join(root, '.starcistacks/seeds/seeds.yaml')), false);
  assert.deepEqual(addSeedEntries(root, 'dev', [entry]), ['reference']);
  assert.deepEqual(addSeedEntries(root, 'dev', [entry, { ...entry, id: 'more' }]), ['more']);
  assert.match(fs.readFileSync(path.join(root, '.starcistacks/dev/seeds/seeds.yaml'), 'utf8'), /^schema: starci\/seeds@1\nentries:\n {2}- id: reference[\s\S]*- id: more/u);
});

for (const edition of ['lite', 'full'] as const) {
  test(`${edition}: starci app check places the seed levels in app.starcistacks and reports R375 through the app root`, (t) => {
    const files = { ...VALID, '.starcistacks/dev/environment.json': '{}', '.starcistacks/dev/seeds/old.sql': 'select 1;\n' };
    const root = tree(t, files);
    const declaration = { hfs: 3, kind: 'app', project: 'fixture', edition, sides: { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } };
    const report = checkRepo({ repoRoot: root, declaration, files: Object.keys(files), tree: false });
    // The fixture's production environment declares no Swarm sources; that runtime finding is R10's own and not judged here.
    const relevant = report.findings.filter((item) => item.code.startsWith('HFS_SEED') || (item.code === 'HFS_STACKS_SHAPE' && item.path !== '.starcistacks/application-stacks.yaml'));
    assert.deepEqual(codes(relevant), ['HFS_SEEDS_SHAPE .starcistacks/dev/seeds/old.sql', 'HFS_STACKS_SHAPE .starcistacks/dev/seeds/old.sql']);
  });

  test(`${edition}: a new app is scaffolded with the shared level and a level per declared environment, each with an empty manifest`, (t) => {
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-seeds-scaffold-'), harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock: lockedOk, initGit: init });
    const environments = [...(declaredEnvironments(root)?.keys() ?? [])];
    assert.ok(environments.length >= 2, environments.join(', '));
    for (const env of [null, ...environments]) {
      const level = readSeedLevel(root, env);
      assert.deepEqual(level.problems, [], level.dir);
      for (const kind of ['sql', 'data', 'files']) assert.ok(fs.readdirSync(path.join(root, level.dir, kind)).length > 0, `${level.dir}/${kind} is tracked`);
    }
  });
}

/** A sealed-looking member: its key names in the clear, its values as sops ciphertext (no value of this fixture is ever opened). */
const sealedMember = (keys: string[]): string => `${keys.map((key) => `${key}: ENC[AES256_GCM,data:eA==,iv:aXY=,tag:dGc=,type:str]`).join('\n')}\nsops:\n  age:\n    - recipient: age1fake\n`;
const ACCOUNT_SCHEMA = JSON.stringify({
  type: 'object', required: ['email', 'password'],
  properties: { email: { type: 'string' }, password: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } }, zaloOa: { type: 'object' } },
});
/** Production's one test account: its login and its connector credentials are references to sealed members of production. */
const ACCOUNT: Record<string, string> = {
  'be/schemas/account.schema.json': ACCOUNT_SCHEMA,
  '.starcistacks/production/seeds/seeds.yaml': manifest([
    '{id: logo, kind: files, path: files/brand, target: media, mode: once}',
    '{id: demo-account, kind: test-account, path: data/demo-account.json, target: [npm, run, -w, be, cli, --, accounts, seed], schema: be/schemas/account.schema.json, mode: upsert, reason: "the one account the owner signs in with to test the connectors on production"}',
  ]),
  '.starcistacks/production/seeds/data/demo-account.json': JSON.stringify({ email: 'owner-test@example.test', password: { secret: 'seeds-test-owner' }, zaloOa: { secret: 'seeds-test-zalo' } }),
  '.starcistacks/production/secrets/seeds-test-owner.enc.yaml': sealedMember(['value']),
  '.starcistacks/production/secrets/seeds-test-zalo.enc.yaml': sealedMember(['APP_ID', 'SECRET']),
};

test('a production level declares one test account: its test identity and its sealed references are no finding', (t) => {
  assert.deepEqual(judge(t, { ...VALID, ...ACCOUNT }), []);
});

test('HFS_SEED_SECRET_REF: a reference to no seeds-<name> member, or to a member the environment does not seal; the shared level needs every environment', (t) => {
  const list = judge(t, {
    ...VALID, ...ACCOUNT,
    '.starcistacks/production/seeds/data/demo-account.json': JSON.stringify({ email: 'a@example.test', password: { secret: 'owner-password' }, zaloOa: { secret: 'seeds-test-gone' } }),
    '.starcistacks/seeds/data/modules/sales.json': JSON.stringify({ id: 'sales', key: { secret: 'seeds-catalogue' } }),
    '.starcistacks/dev/secrets/seeds-catalogue.enc.yaml': sealedMember(['TOKEN']),
  });
  assert.deepEqual(list.map((item) => `${item.code} ${item.message}`).filter((line) => line.startsWith('HFS_SEED_SECRET_REF')).map((line) => line.replace(/^.*? references /u, '')).sort(), [
    'seeds-catalogue, which .starcistacks/production/secrets/seeds-catalogue.enc.yaml does not hold; seal it with starci app secret set --env production',
    'seeds-test-gone, which .starcistacks/production/secrets/seeds-test-gone.enc.yaml does not hold; seal it with starci app secret set --env production',
    'the secret owner-password; a seed references a sealed member named seeds-<name> of its environment',
  ]);
});

test('a secret reference reads as its sealed keys for the schema, so a document off its schema still fails and a member without keys is empty', (t) => {
  const off = judge(t, { ...VALID, ...ACCOUNT, '.starcistacks/production/secrets/seeds-test-owner.enc.yaml': '{ not json' });
  assert.deepEqual(codes(off), ['HFS_SEED_DATA_SCHEMA .starcistacks/production/seeds/data/demo-account.json']);
});

test('the test account is no free pass: a marker in another production entry stays refused, and the shared level and a second account are refused', (t) => {
  const elsewhere = judge(t, { ...VALID, ...ACCOUNT, '.starcistacks/production/seeds/files/brand/test-banner.png': 'png' });
  assert.deepEqual(codes(elsewhere), ['HFS_SEED_TEST_DATA .starcistacks/production/seeds/files/brand/test-banner.png']);
  const twice = normalizeSeeds({ schema: 'starci/seeds@1', entries: [
    { id: 'a', kind: 'test-account', path: 'data/a.json', target: ['x'], schema: 's.json', mode: 'once', reason: 'one' },
    { id: 'b', kind: 'test-account', path: 'data/b.json', target: ['x'], schema: 's.json', mode: 'once' },
    { id: 'c', kind: 'data', path: 'data/c.json', target: ['x'], schema: 's.json', mode: 'once', reason: 'no' },
  ] }, tree(t, { 'data/a.json': '{}', 'data/b.json': '{}', 'data/c.json': '{}' }), null).problems.map((item) => `${item.at}: ${item.message}`).join('\n');
  for (const expected of [/a, b: the shared level declares no test account/u, /a, b: a level declares at most one test account/u, /entries\[1\]\.reason: must say why/u, /entries\[2\]\.reason: is a field of a test-account entry only/u]) assert.match(twice, expected);
});

test('the document helpers find, resolve and leave alone what is no reference', () => {
  const doc = { a: { secret: 'seeds-x' }, list: [{ secret: 'seeds-y' }, { secret: 'seeds-x' }], other: { secret: 'seeds-z', extra: 1 }, n: 1 };
  assert.deepEqual(secretReferences(doc), ['seeds-x', 'seeds-y']);
  assert.deepEqual(resolveSecrets(doc, (member) => `<${member}>`), { a: '<seeds-x>', list: ['<seeds-y>', '<seeds-x>'], other: { secret: 'seeds-z', extra: 1 }, n: 1 });
  assert.equal(secretReference(['seeds-x']), null);
});
