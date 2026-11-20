/** The bring-up loads each pinned seed-standard once per pin through the app's seed doors (PROJECT-STACKS-13 "One path in", R435): a fake copy repository rendered by the git driver, the real pin reader, the real door over a fake app command speaking starci/data-entries@1. */
// proves: STACK_SEED_STANDARD_UNREADABLE
// proves: STACK_SEED_STANDARD_UNREADABLE
// proves: STACK_SEED_STANDARD_SCHEMA
// proves: STACK_SEED_STANDARD_SCHEMA
// proves: STACK_SEED_STORE_COMMAND
// proves: STACK_SEED_STORE_COMMAND
// proves: STACK_SEED_DOOR_REFUSED
// proves: STACK_SEED_DOOR_REFUSED
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { blobEntry, decodeEntry, recordEntry } from '@starci/seed';
import type { ImportOptions, ImportReport, StoredEntry } from '@starci/seed';
import { renderStandard } from '@starci/seed/git';
import type { RunResult, StackContext } from '../stack/context.mjs';
import type { DbTarget } from '../db/postgres.mjs';
import { seedStep } from '../stack/seeds.mjs';
import type { SeedStepInput } from '../stack/seeds.mjs';
import { pinnedStandardVerifier } from '../stack/standard-gate.mjs';
import type { PinVerifier } from '../stack/standard-gate.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@example.test', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@example.test' };
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', args, { cwd, env: gitEnv, windowsHide: true, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};

const lesson = (key: string, title: string): StoredEntry => ({ store: 'database', entry: recordEntry('lessons', key, { title }) });
const image = (key: string, bytes: string): StoredEntry => ({ store: 'storage', entry: blobEntry('lesson-images', key, new TextEncoder().encode(bytes), 'image/png') });

/** A fake copy repository: each commit is what renderStandard (the one git driver) writes for its entries. */
async function commitStandard(root: string, entries: readonly StoredEntry[], message: string): Promise<string> {
  await renderStandard({ format: 'shop-seed-standard@1', project: 'shop', entries }, root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** The app's stack: a database and a storage store, each with its seed door, and one seed-standard pinned by commit. */
function writeStack(app: string, repository: string, commit: string, extra = '', more = ''): void {
  fs.mkdirSync(path.join(app, '.starcistacks'), { recursive: true });
  fs.writeFileSync(path.join(app, '.starcistacks/application-stacks.yaml'), `environments:\n  dev: {}\n  production: {short: prod}\ndata:\n  stores:\n`
    + '    - {id: database, kind: database, level: logical, component: db, adapter: {module: be/database.adapter.ts, command: [node, cli.js, data, database]}}\n'
    + '    - {id: storage, kind: storage, level: logical, component: minio, adapter: {module: be/storage.adapter.ts, command: [node, cli.js, data, storage]}}\n'
    + `  sets:\n    - {id: lessons, purpose: seed-standard, stores: [database, storage], environments: [dev, production], to: [{driver: git, repository: ${JSON.stringify(repository)}}], commit: ${commit}${extra}}\n${more}`);
}

/** The app's stores as its door command keeps them: per store, set/key -> sha256; and what each import asked. */
interface Doors { held: Map<string, Map<string, string>>; calls: Array<{ store: string; options: ImportOptions }>; refuse: Set<string>; exit: number }

/** A fake app command serving its stores over starci/data-entries@1 (`import <options>`, entry lines on stdin, the report on the last line). */
function doorCommand(doors: Doors): (argv: readonly string[], input: string) => RunResult {
  return (argv, input) => {
    const [node, cli, verb, store, action, json] = argv;
    assert.deepEqual([node, cli, verb, action], ['node', 'cli.js', 'data', 'import'], 'the seed door is the store command with import <options>');
    const options = JSON.parse(String(json)) as ImportOptions;
    doors.calls.push({ store: String(store), options });
    if (doors.exit !== 0 && !options.dryRun) return { status: doors.exit, stdout: 'a value the harness must withhold\n', stderr: '' };
    const held = doors.held.get(String(store)) ?? new Map<string, string>();
    const sets = new Map<string, { set: string; created: number; updated: number; unchanged: number; removed: number; refused: Array<{ key: string; code: string }> }>();
    const seen = new Set<string>();
    for (const line of input.split('\n').filter((text) => text.trim() !== '')) {
      const entry = decodeEntry(line);
      const tally = sets.get(entry.set) ?? { set: entry.set, created: 0, updated: 0, unchanged: 0, removed: 0, refused: [] };
      sets.set(entry.set, tally);
      const id = `${entry.set}/${entry.key}`;
      seen.add(id);
      if (doors.refuse.has(entry.set)) { tally.refused.push({ key: entry.key, code: 'APP_DOOR_REFUSED' }); continue; }
      const before = held.get(id);
      if (before === entry.sha256) tally.unchanged += 1; else if (before === undefined) tally.created += 1; else tally.updated += 1;
      if (!options.dryRun) held.set(id, entry.sha256);
    }
    for (const id of held.keys()) {
      const [set] = id.split('/');
      const tally = sets.get(String(set));
      if (options.mode === 'mirror' && tally !== undefined && !seen.has(id)) tally.removed += 1;
    }
    if (!options.dryRun) doors.held.set(String(store), held);
    const list = [...sets.values()].sort((left, right) => (left.set < right.set ? -1 : 1));
    const report: ImportReport = { sets: list, outcome: list.some((item) => item.refused.length > 0) ? 'partial' : list.some((item) => item.created + item.updated > 0) ? 'applied' : 'unchanged' };
    return { status: 0, stdout: `importing\n${JSON.stringify(report)}\n`, stderr: '' };
  };
}

/** The seed receipts table as psql answers it: rows in the order they were written (an upsert replaces in place). */
function receiptsDatabase(): { rows: Array<{ scope: string; id: string; hash: string; outcome: string }>; spawn: (command: string, args: readonly string[]) => RunResult } {
  const state = { present: false, rows: [] as Array<{ scope: string; id: string; hash: string; outcome: string }> };
  const spawn = (_command: string, args: readonly string[]): RunResult => {
    const sql = args.filter((_, index) => args[index - 1] === '-c');
    if (!args.includes('-1')) return { status: 0, stdout: JSON.stringify(sql[0]?.includes('to_regclass') ? [{ present: state.present }] : state.rows.map((row) => ({ ...row, secrets: '' }))), stderr: '' };
    for (const statement of sql) {
      if (statement.startsWith('create table')) state.present = true;
      const values = /values \('([^']*)', '([^']*)', '([^']*)', '[^']*', '[^']*', '([^']*)'\)/u.exec(statement);
      if (!values) continue;
      const row = { scope: String(values[1]), id: String(values[2]), hash: String(values[3]), outcome: String(values[4]) };
      const at = state.rows.findIndex((item) => item.scope === row.scope && item.id === row.id);
      if (at === -1) state.rows.push(row); else state.rows[at] = row;
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { rows: state.rows, spawn };
}

interface World { app: string; repo: string; cache: string; doors: Doors; db: ReturnType<typeof receiptsDatabase>; run: (overrides?: Partial<SeedStepInput>) => Promise<string[]> }

async function world(t: TestContext): Promise<World & { a: string }> {
  const repo = mkdtemp(t, 'hfs-standard-load-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  const a = await commitStandard(repo, [lesson('01-welcome', 'Welcome'), lesson('02-basics', 'Basics'), image('lessons/welcome.png', 'png-a')], 'standard A');
  const app = mkdtemp(t, 'hfs-standard-load-app-');
  writeStack(app, repo, a);
  const cache = mkdtemp(t, 'hfs-standard-load-cache-');
  const doors: Doors = { held: new Map(), calls: [], refuse: new Set(), exit: 0 };
  const db = receiptsDatabase();
  // reason: the step reads only spawn of the context here: psql for the receipts, no entry of the levels opens a secret.
  const ctx = { env: {}, cwd: app, spawn: db.spawn } as unknown as StackContext;
  const target: DbTarget = { how: 'url', url: 'postgresql://owner@127.0.0.1:5432/app', env: {}, secrets: [] };
  const verify = pinnedStandardVerifier({ cache });
  const run = async (overrides: Partial<SeedStepInput> = {}): Promise<string[]> => (await seedStep({
    ctx, repoRoot: app, env: 'production', target, execute: true, command: doorCommand(doors), standards: verify, ...overrides,
  })).lines;
  return { app, repo, cache, doors, db, run, a };
}

const NO_ENTRY = "seed: no entry in .starcistacks/seeds or the environment's level";
const applied = (db: World['db']): string[] => db.rows.filter((row) => row.id.includes('@')).map((row) => `${row.id.split('@')[0] ?? ''}@${(row.id.split('@')[1] ?? '').slice(0, 7)} ${row.outcome}`);
const short = (commit: string): string => commit.slice(0, 12);

test('a pin at commit A applies its records once through the seed doors; a second run at A is skipped by its receipt', async (t) => {
  const { doors, db, run, a } = await world(t);
  const plan = await run({ execute: false });
  assert.match(plan[1] ?? '', new RegExp(`^plan seed standard/lessons: apply .*@${short(a)} through the seed doors of database, storage, an upsert by natural key$`, 'u'));
  assert.equal(doors.calls.length, 0, 'a dry run reads no pin and opens no door');

  const first = await run();
  assert.match(first[0] ?? '', /: no adapter, the committed standard stands/u);
  assert.match(first[1] ?? '', new RegExp(`^seed standard/lessons: applied .*@${short(a)} \\(lessons: 2 created, 0 updated, 0 unchanged; lesson-images: 1 created, 0 updated, 0 unchanged\\)$`, 'u'));
  assert.equal(first[2], NO_ENTRY);
  assert.deepEqual([...(doors.held.get('database')?.keys() ?? [])].sort(), ['lessons/01-welcome', 'lessons/02-basics']);
  assert.deepEqual([...(doors.held.get('storage')?.keys() ?? [])], ['lesson-images/lessons/welcome.png']);
  assert.deepEqual(doors.calls.map((call) => `${call.store} ${call.options.mode}${call.options.dryRun ? ' dry' : ''}`), ['database mirror dry', 'storage mirror dry', 'database merge', 'storage merge'], 'every door is tried dry (mirror counts what the standard no longer names) before any record applies, then applied as a merge');
  assert.deepEqual(applied(db), [`lessons@${a.slice(0, 7)} applied`], 'one receipt per (standard, commit)');

  doors.calls.length = 0;
  const again = await run();
  assert.match(again[0] ?? '', /: verified before \(.*, once per pin\)$/u);
  assert.match(again[1] ?? '', new RegExp(`^seed standard/lessons: kept \\(.*@${short(a)} applied before, once per pin\\)$`, 'u'));
  assert.equal(doors.calls.length, 0, 'a receipt already present skips the apply: no door runs');
  assert.deepEqual(applied(db), [`lessons@${a.slice(0, 7)} applied`]);
});

test('a new pin B is reported DATA_STANDARD_CHANGED and left; with force: true it applies once, writes a new receipt, and leaves what B no longer names', async (t) => {
  const { app, repo, doors, db, run, a } = await world(t);
  await run();
  const b = await commitStandard(repo, [lesson('01-welcome', 'Welcome back'), image('lessons/welcome.png', 'png-a')], 'standard B');
  writeStack(app, repo, b);
  const unforced = await run();
  assert.match(unforced[1] ?? '', new RegExp(`^seed standard/lessons: DATA_STANDARD_CHANGED: pinned .*@${short(b)}, applied ${short(a)}; not re-seeded: a changed pin applies only when the set declares force: true, once per pinned commit`, 'u'));
  assert.deepEqual(applied(db), [`lessons@${a.slice(0, 7)} applied`], 'a changed pin is never applied by itself');

  writeStack(app, repo, b, ', force: true');
  doors.calls.length = 0;
  const forced = await run();
  assert.match(forced[1] ?? '', new RegExp(`^seed standard/lessons: applied .*@${short(b)}, forced \\(DATA_STANDARD_CHANGED from ${short(a)}\\) \\(lessons: 0 created, 1 updated, 0 unchanged; lesson-images: 0 created, 0 updated, 1 unchanged; 1 key\\(s\\) the standard no longer names left in place\\)$`, 'u'));
  assert.ok(doors.held.get('database')?.has('lessons/02-basics'), 'an upsert by natural key: a key the standard no longer names is reported and left');
  assert.deepEqual(applied(db), [`lessons@${a.slice(0, 7)} applied`, `lessons@${b.slice(0, 7)} forced applied`]);

  doors.calls.length = 0;
  assert.match((await run())[1] ?? '', /: kept \(.* applied before, once per pin\)$/u, 'force re-seeds once per pinned commit: the same stack text never re-seeds twice');
  assert.equal(doors.calls.length, 0);
});

test('a drifting adapter at B is refused before any record of B applies, and writes no receipt for B', async (t) => {
  const { app, repo, doors, db, run, a } = await world(t);
  await run();
  const before = JSON.stringify([...(doors.held.get('database') ?? new Map())]);
  const b = await commitStandard(repo, [lesson('01-welcome', 'Drifted')], 'standard B');
  writeStack(app, repo, b, ', force: true');
  doors.calls.length = 0;
  // The real verifier over a drifting adapter commit is proved by data-adapter.spec.mts; here the gate's verdict for B is a drift finding.
  const drifting: PinVerifier = (pin) => ({ adapter: true, findings: pin.commit === b ? [{ code: 'HFS_DATA_ADAPTER_DRIFT', level: 'error', path: 'data/database/lessons/all.json', message: 'data/database/lessons/all.json differs from what the adapter writes from raw/' }] : [] });
  await assert.rejects(run({ standards: drifting }), (error: Error & { code?: string }) => error.code === 'STACK_SEED_ADAPTER_DRIFT');
  assert.equal(doors.calls.length, 0, 'no door opened');
  assert.equal(JSON.stringify([...(doors.held.get('database') ?? new Map())]), before, 'no record of B applied');
  assert.deepEqual(applied(db), [`lessons@${a.slice(0, 7)} applied`], 'no receipt for B');
});

test('a door refusal leaves no receipt: a refused key stops the pin in the dry run before any record applies; a door that fails mid-apply writes none either', async (t) => {
  const { doors, db, run } = await world(t);
  doors.refuse.add('lesson-images');
  await assert.rejects(run(), (error: Error & { code?: string }) => error.code === 'STACK_SEED_DOOR_REFUSED' && /the seed door refused lesson-images: 1 key\(s\) refused \(APP_DOOR_REFUSED\); nothing of the pin was applied/u.test(error.message));
  assert.equal(doors.held.size, 0, 'the dry run through every door refused first: nothing applied');
  assert.deepEqual(applied(db), [], 'no receipt');

  doors.refuse.clear();
  doors.exit = 3;
  await assert.rejects(run(), (error: Error & { code?: string }) => error.code === 'STACK_SEED_DOOR_REFUSED' && /the door of the store database exited 3; its output is withheld; no receipt was written/u.test(error.message) && !error.message.includes('withhold\n') && !error.message.includes('a value'));
  assert.deepEqual(applied(db), [], 'no half-applied receipt');
  doors.exit = 0;
  assert.match((await run())[1] ?? '', /^seed standard\/lessons: applied /u, 'the next bring-up applies the pin again');
});

test('an unreadable pin, a copy that is no healthy standard, a store the set does not list and a store with no door each refuse the pin before any record applies', async (t) => {
  const { app, repo, doors, db, run, a } = await world(t);
  const clean: PinVerifier = () => ({ adapter: false, findings: [] });
  writeStack(app, repo, 'f'.repeat(40));
  await assert.rejects(run({ standards: clean }), (error: Error & { code?: string }) => error.code === 'STACK_SEED_STANDARD_UNREADABLE' && /cannot be read at its pin \(DATA_COPY_MISSING\): nothing of it was applied/u.test(error.message));

  fs.writeFileSync(path.join(repo, 'data/database/lessons/all.json'), '{\n"01-welcome":{"title":"edited by hand"}\n}\n');
  git(repo, 'commit', '-q', '-am', 'a hand edit');
  writeStack(app, repo, git(repo, 'rev-parse', 'HEAD'));
  await assert.rejects(run({ standards: clean }), (error: Error & { code?: string }) => error.code === 'STACK_SEED_STANDARD_SCHEMA' && /is no healthy starci\/data-manifest@1 copy \(.*digests: differ: database\/lessons/u.test(error.message));

  writeStack(app, repo, a);
  fs.writeFileSync(path.join(app, '.starcistacks/application-stacks.yaml'), fs.readFileSync(path.join(app, '.starcistacks/application-stacks.yaml'), 'utf8').replace('stores: [database, storage], environments', 'stores: [database], environments'));
  await assert.rejects(run(), (error: Error & { code?: string }) => error.code === 'STACK_SEED_STANDARD_SCHEMA' && /carries the store storage, which the set lessons does not list/u.test(error.message));

  writeStack(app, repo, a);
  fs.writeFileSync(path.join(app, '.starcistacks/application-stacks.yaml'), fs.readFileSync(path.join(app, '.starcistacks/application-stacks.yaml'), 'utf8').replace(', command: [node, cli.js, data, storage]', ''));
  await assert.rejects(run(), (error: Error & { code?: string }) => error.code === 'STACK_SEED_STORE_COMMAND' && /the store storage declares no adapter\.command/u.test(error.message));
  assert.equal(doors.calls.length, 0, 'no door opened for any refused pin');
  assert.deepEqual(applied(db), []);
});

test('a seed-standard a project kind judges (completeness: ext:) is named and left to the project: nothing is read or applied', async (t) => {
  const { app, repo, doors, db, run, a } = await world(t);
  writeStack(app, repo, a, ', completeness: "ext:catalogue"');
  const reader = async (): Promise<never> => assert.fail('a project kind is never read by the loader');
  const lines = await run({ standards: () => assert.fail('nor verified by the gate'), standardReader: reader });
  assert.deepEqual(lines, ['seed standard/lessons: left to the project (completeness ext:catalogue: its own check judges the copy and it reads it through pinRepository)', NO_ENTRY]);
  assert.equal(doors.calls.length, 0);
  assert.deepEqual(db.rows, []);
});
