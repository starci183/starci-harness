// The seed step (PROJECT-STACKS-12) against a fake psql and a fake sops seam: it plans without writing, applies the shared level and then
// the environment's in order with one receipt per entry in public.starci_seed_receipts, a rerun with nothing changed applies nothing, an
// upsert reruns on a changed file or a rotated secret while a once entry never reruns, the opened secret values reach the app command on
// stdin only (never a line, argv or receipt), a files entry is validated only, and every failure leaves no receipt.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DbTarget } from '../db/postgres.mjs';
import type { RunResult, StackContext } from '../stack/context.mjs';
import { SEED_RECEIPTS, seedStep } from '../stack/seeds.mjs';
import type { SeedStepInput } from '../stack/seeds.mjs';

const manifest = (entries: string[]): string => `schema: starci/seeds@1\nentries:\n${entries.map((entry) => `  - ${entry}\n`).join('')}`;
const sealedMember = (keys: string[]): string => `${keys.map((key) => `${key}: ENC[AES256_GCM,data:eA==,iv:aXY=,tag:dGc=,type:str]`).join('\n')}\nsops:\n  age:\n    - recipient: age1fake\n`;
const SCHEMA = JSON.stringify({ type: 'object', required: ['email'], properties: { email: { type: 'string' }, password: { type: 'object', properties: { value: { type: 'string' } } } } });

/** A throwaway value a test seals: never a real credential, new for every run. */
const throwaway = (): string => crypto.randomBytes(12).toString('hex');

function app(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stack-seeds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'be/schemas/account.schema.json': SCHEMA,
    '.starcistacks/seeds/seeds.yaml': manifest([
      '{id: plans, kind: sql, path: sql/010-plans.sql, target: primary, mode: upsert}',
      '{id: banner, kind: files, path: files/banner.png, target: media, mode: once}',
    ]),
    '.starcistacks/seeds/sql/010-plans.sql': "insert into plans values ('free') on conflict do nothing;\n",
    '.starcistacks/seeds/files/banner.png': 'png',
    '.starcistacks/production/seeds/seeds.yaml': manifest([
      '{id: first-run, kind: sql, path: sql/first.sql, target: primary, mode: once, after: [plans]}',
      '{id: owner, kind: test-account, path: data/owner.json, target: [node, cli.js, accounts, seed], schema: be/schemas/account.schema.json, mode: upsert, reason: "the one test account of production"}',
    ]),
    '.starcistacks/production/seeds/sql/first.sql': 'insert into settings values (1) on conflict do nothing;\n',
    '.starcistacks/production/seeds/data/owner.json': JSON.stringify({ email: 'owner-test@example.test', password: { secret: 'seeds-test-owner' } }),
    '.starcistacks/production/secrets/seeds-test-owner.enc.yaml': sealedMember(['value']),
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

/** A database whose psql understands the step's statements: the receipts table, its rows, and the seed files a transaction runs. */
function database() {
  const state = { present: false, rows: [] as Array<{ scope: string; id: string; hash: string; secrets: string }>, files: [] as string[], fail: '' };
  const psql = (args: readonly string[]): RunResult => {
    const sql = args.filter((_, index) => args[index - 1] === '-c');
    if (!args.includes('-1')) {
      const [query = ''] = sql;
      const rows = query.includes('to_regclass') ? [{ present: state.present }] : state.rows;
      return { status: 0, stdout: JSON.stringify(rows), stderr: '' };
    }
    const files = args.filter((_, index) => args[index - 1] === '-f');
    if (files.some((file) => fs.readFileSync(file, 'utf8').includes(state.fail || '\0'))) return { status: 1, stdout: '', stderr: 'ERROR: boom' };
    for (const statement of sql) {
      if (statement.startsWith('create table')) state.present = true;
      const values = /values \('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)/u.exec(statement);
      if (values) {
        const [, scope = '', id = '', hash = '', secrets = ''] = values;
        state.rows = [...state.rows.filter((row) => row.scope !== scope || row.id !== id), { scope, id, hash, secrets }];
      }
    }
    state.files.push(...files.map((file) => path.basename(file)));
    return { status: 0, stdout: '', stderr: '' };
  };
  return { state, psql };
}

/** The step's input over the fake database, a fake sops seam holding `secrets`, and an app command that records its stdin. */
function step(root: string, db: ReturnType<typeof database>, secrets: Map<string, Record<string, string>>, { execute = true, exit = 0 } = {}) {
  const inputs: Array<{ argv: readonly string[]; input: string }> = [];
  // reason: the step reads only spawn and sops of the context.
  const ctx = {
    env: {}, cwd: root,
    spawn: (command: string, args: readonly string[]) => { assert.equal(command, 'psql'); return db.psql(args); },
    sops: { decrypt: (file: string) => secrets.get(path.basename(file, '.enc.yaml')) ?? assert.fail(`no fixture for ${file}`), decryptBinary: () => '' },
  } as unknown as StackContext;
  const target: DbTarget = { how: 'url', url: 'postgresql://owner@127.0.0.1:5432/app', env: {}, secrets: [] };
  const input: SeedStepInput = { ctx, repoRoot: root, env: 'production', target, execute, command: (argv, text) => { inputs.push({ argv, input: text }); return { status: exit, stdout: '', stderr: exit ? 'leaked?' : '' }; } };
  return { input, inputs };
}

test('a dry run plans every entry from the receipts it reads and writes nothing, opening no secret', (t) => {
  const root = app(t);
  const db = database();
  const { input, inputs } = step(root, db, new Map(), { execute: false });
  const result = seedStep(input);
  assert.deepEqual(result.lines, [
    'plan seed shared/plans: apply (sql, upsert)',
    'seed shared/banner: validated, not uploaded (files: the harness has no object-storage client; the app uploads them to media)',
    'plan seed production/first-run: apply (sql, once)',
    'plan seed production/owner: apply (test-account, upsert, secrets seeds-test-owner)',
  ]);
  assert.deepEqual([db.state.present, db.state.files, inputs], [false, [], []]);
});

test('armed, it applies the shared level then the environment\'s with a receipt each; the secret reaches the command on stdin only; a rerun is a no-op', (t) => {
  const root = app(t);
  const db = database();
  const password = throwaway();
  const secrets = new Map([['seeds-test-owner', { value: password }]]);
  const first = step(root, db, secrets);
  const result = seedStep(first.input);
  assert.deepEqual(result.lines, [
    'seed shared/plans: applied (sql, upsert, 1 file)',
    'seed shared/banner: validated, not uploaded (files: the harness has no object-storage client; the app uploads them to media)',
    'seed production/first-run: applied (sql, once, 1 file)',
    'seed production/owner: applied (test-account, upsert, secrets seeds-test-owner)',
  ]);
  assert.deepEqual(db.state.files, ['010-plans.sql', 'first.sql']);
  assert.deepEqual(db.state.rows.map((row) => `${row.scope}/${row.id}`), ['shared/plans', 'production/first-run', 'production/owner']);
  const [call] = first.inputs;
  assert.deepEqual(call?.argv, ['node', 'cli.js', 'accounts', 'seed']);
  assert.deepEqual(JSON.parse(call?.input ?? '{}'), { env: 'production', scope: 'production', entry: 'owner', kind: 'test-account', documents: [{ path: 'data/owner.json', document: { email: 'owner-test@example.test', password: { value: password } } }] });
  const visible = JSON.stringify([result, db.state.rows, first.inputs.map((item) => item.argv)]);
  assert.equal(visible.includes(password), false, 'the opened value is in no line, receipt or argv');
  assert.match(db.state.rows.find((row) => row.id === 'owner')?.secrets ?? '', /^seeds-test-owner:[0-9a-f]{16}$/u);

  const again = step(root, db, secrets);
  assert.deepEqual(seedStep(again.input).lines, [
    'seed shared/plans: unchanged (upsert)',
    'seed shared/banner: validated, not uploaded (files: the harness has no object-storage client; the app uploads them to media)',
    'seed production/first-run: kept (once, applied before)',
    'seed production/owner: unchanged (upsert)',
  ]);
  assert.deepEqual([db.state.files.length, again.inputs.length], [2, 0], 'nothing ran twice');
  assert.deepEqual(seedStep(step(root, db, secrets, { execute: false }).input).lines.filter((line) => line.startsWith('plan')), ['plan seed production/owner: apply when a referenced secret changed (test-account, upsert, secrets seeds-test-owner)']);
});

test('an upsert reruns on a changed file or a rotated secret; a once entry never reruns', (t) => {
  const root = app(t);
  const db = database();
  const secrets = new Map([['seeds-test-owner', { value: throwaway() }]]);
  seedStep(step(root, db, secrets).input);
  fs.writeFileSync(path.join(root, '.starcistacks/seeds/sql/010-plans.sql'), "insert into plans values ('pro') on conflict do nothing;\n");
  fs.writeFileSync(path.join(root, '.starcistacks/production/seeds/sql/first.sql'), 'insert into settings values (2) on conflict do nothing;\n');
  secrets.set('seeds-test-owner', { value: throwaway() });
  const rotated = step(root, db, secrets);
  const lines = seedStep(rotated.input).lines;
  assert.deepEqual(lines.filter((line) => !line.includes('banner')), [
    'seed shared/plans: applied (sql, upsert, 1 file)',
    'seed production/first-run: kept (once, applied before)',
    'seed production/owner: applied (test-account, upsert, secrets seeds-test-owner)',
  ]);
  assert.equal(rotated.inputs.length, 1);
});

test('a failing SQL file or app command writes no receipt and names no output; a missing member, a bad document and a bad manifest refuse', (t) => {
  const root = app(t);
  const db = database();
  db.state.fail = "'free'";
  assert.throws(() => seedStep(step(root, db, new Map([['seeds-test-owner', { value: throwaway() }]])).input), /STACK_SEED_SQL|psql failed/u);
  assert.deepEqual(db.state.rows, []);
  db.state.fail = '';
  const failing = step(root, db, new Map([['seeds-test-owner', { value: throwaway() }]]), { exit: 3 });
  assert.throws(() => seedStep(failing.input), (error: Error) => /production\/owner: node cli\.js accounts seed exited 3; its output is withheld/u.test(error.message) && !error.message.includes('leaked'));
  assert.equal(db.state.rows.some((row) => row.id === 'owner'), false);
  fs.rmSync(path.join(root, '.starcistacks/production/secrets/seeds-test-owner.enc.yaml'));
  assert.throws(() => seedStep(step(root, database(), new Map(), { execute: false }).input), /seeds-test-owner\.enc\.yaml is not sealed/u);
  fs.writeFileSync(path.join(root, '.starcistacks/production/seeds/data/owner.json'), JSON.stringify({ name: 'no email' }));
  assert.throws(() => seedStep(step(root, database(), new Map()).input), /owner: data\/owner\.json does not validate against be\/schemas\/account\.schema\.json/u);
  fs.writeFileSync(path.join(root, '.starcistacks/production/seeds/data/owner.json'), '{ not json');
  assert.throws(() => seedStep(step(root, database(), new Map()).input), /owner: data\/owner\.json does not parse/u);
  fs.writeFileSync(path.join(root, '.starcistacks/seeds/seeds.yaml'), 'schema: nope\n');
  assert.throws(() => seedStep(step(root, database(), new Map()).input), /STACK_SEED_MANIFEST|seeds\.yaml schema: must be starci\/seeds@1/u);
});

test('an app without seed entries says so and creates no table; the receipts table is the harness\'s own', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stack-seeds-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = database();
  assert.deepEqual(seedStep(step(root, db, new Map()).input).lines, ['seed: no entry in .starcistacks/seeds or the level of the environment']);
  assert.equal(db.state.present, false);
  assert.equal(SEED_RECEIPTS, 'public.starci_seed_receipts');
});
