// proves: BE_PERSISTENCE_NO_RAW_SQL@lite
// R334's database functions: the canon lists the pg built-ins bare and every other function schema-qualified, an app lists
// its own schema-qualified, the lite skeleton's platform/database/database.client.ts calls only those shapes, and its call
// statement stays readable to R268's recurring-work scanner (HFS_SCHEDULE_UNDECLARED).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dbFunctionsOk } from '../runtime/scripts/hfs/rule-params-shape.mjs';
import { scheduleIssues } from '../runtime/scripts/hfs/rules/stacks-release.mjs';
import { loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(PACKAGE, 'templates');
const CLIENT = path.join(TEMPLATES, 'be', 'skeleton-lite', 'src', 'modules', 'platform', 'database', 'database.client.ts');
const CLIENT_AT = 'be/src/modules/platform/database/database.client.ts';
const canonList = () => loadSlotManifest().ruleParams.be.dbFunctions;
const entries = (...names) => names.map((name) => ({ name, reason: 'a reason' }));

/** Every template file under `dir`, recursively. */
const templateFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? templateFiles(full) : [full];
});

test('the canon list names each pg built-in bare and every other function schema-qualified, and passes its own shape', () => {
  const list = canonList();
  assert.equal(dbFunctionsOk(list, { bare: true }), true);
  for (const { name } of list) assert.match(name, /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/, name);
  assert.ok(list.some(({ name }) => name === 'public.job_claim'));
  assert.ok(list.some(({ name }) => name === 'gen_random_uuid'));
});

test('an app lists its functions schema-qualified: a bare name, pg_catalog and a third part are refused', () => {
  assert.equal(dbFunctionsOk(entries('public.job_enqueue', 'be_access.chat_target_member')), true);
  for (const name of ['job_enqueue', 'pg_catalog.pg_terminate_backend', 'db.public.job_enqueue', 'Public.job_enqueue', 'public.']) {
    assert.equal(dbFunctionsOk(entries(name)), false, name);
  }
  assert.equal(dbFunctionsOk(entries('pg_notify'), { bare: true }), true);
  assert.equal(dbFunctionsOk(entries('pg_catalog.pg_notify'), { bare: true }), false);
});

/** A lite app declaration whose be side lists `names` as its database functions. */
const appWith = (names) => ({ hfs: 3, kind: 'app', project: 'fixture', edition: 'lite',
  sides: { be: { apps: [{ name: 'core', kind: 'api' }], dbFunctions: entries(...names) }, fe: { apps: [{ name: 'web', kind: 'next' }] } } });

test('an app names a bare function only when it is a pg built-in the canon lists (gen_random_uuid), anything else schema-qualified', () => {
  const manifest = loadSlotManifest();
  assert.doesNotThrow(() => resolveRepoDeclaration(manifest, appWith(['public.job_enqueue', 'be_access.chat_target_member', 'gen_random_uuid'])));
  for (const name of ['job_enqueue', 'pg_terminate_backend', 'pg_catalog.gen_random_uuid']) {
    assert.throws(() => resolveRepoDeclaration(manifest, appWith([name])), (error) => error.code === 'HFS_DECLARATION_INVALID', name);
  }
});

test('the client calls in pg_catalog exactly the built-ins the canon lists bare', () => {
  const declared = /const PG_BUILTINS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(fs.readFileSync(CLIENT, 'utf8'));
  assert.ok(declared, 'database.client.ts declares PG_BUILTINS');
  const builtins = [...declared[1].matchAll(/"([a-z_0-9]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(builtins, canonList().map(({ name }) => name).filter((name) => !name.includes('.')).sort());
});

test('every literal function a template source (its specs aside) hands callDbFunction is on the canon list: schema-qualified, or a bare built-in', () => {
  const listed = new Set(canonList().map(({ name }) => name));
  const called = templateFiles(TEMPLATES).filter((file) => !/.spec.ts(?:.tpl)?$/.test(file)).flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/callDbFunction(?:<[^>]*>)?\([^,]+,\s*"([^"]+)"/g)].map((match) => match[1]));
  assert.ok(called.length > 0);
  for (const name of called) assert.ok(listed.has(name), `${name} is not on ruleParams.be.dbFunctions`);
  assert.ok(called.includes('public.job_claim'));
});

/** The schedule findings of a scratch repository holding `text` at the client's path. */
function scheduleFindings(t, text) {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-call-')));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(path.join(repoRoot, CLIENT_AT)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, CLIENT_AT), text);
  return scheduleIssues({ doc: {}, repoRoot, files: [CLIENT_AT] }).filter((issue) => issue.code === 'HFS_SCHEDULE_UNDECLARED');
}

test('R268 reads the client call statement as no recurring work, and still flags a statement it cannot parse', (t) => {
  assert.deepEqual(scheduleFindings(t, fs.readFileSync(CLIENT, 'utf8')), []);
  const unparsable = 'declare const manager: { query(text: string): unknown }\ndeclare const name: string\nmanager.query(`SELECT * FROM ${name}()`)\n';
  assert.equal(scheduleFindings(t, unparsable).length, 1);
});
