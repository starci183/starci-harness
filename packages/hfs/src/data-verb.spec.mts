/** `starci app data status|verify|sync` (PROJECT-STACKS-13): over a real git copy written by the git driver of @starci/seed, sealed with a throwaway age key,
 * and fake app stores served by a tiny node script over `serveStore` (protocol starci/data-entries@1). Skipped, with the reason, when sops or age-keygen
 * is not on PATH. No spec prints or asserts on a secret; the key file's text must never reach an output. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commandStore, exportOnce, memorySpool } from '@starci/seed';
import type { StoreAdapter } from '@starci/seed';
import { createGitDriver } from '@starci/seed/git';
import { memoryStore } from '@starci/seed/testing';
import type { MemorySets } from '@starci/seed/testing';
import { dataMain } from '../data/cli.mjs';
import type { DataDeps } from '../data/cli.mjs';
import { spawnRunner } from '../data/stores.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const have = (tool: string): boolean => spawnSync(tool, ['--version']).status === 0;
const skip = have('sops') && have('age-keygen') && have('git') ? false : 'sops, age-keygen and git must be on PATH';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const iso = (offsetMinutes: number): string => new Date(NOW + offsetMinutes * 60_000).toISOString();
const GIT = { GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@example.test', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@example.test' };
const slash = (file: string): string => file.replaceAll('\\', '/');
const SEED_INDEX = new URL('../../seed/dist/index.js', import.meta.url).href;
const SEED_TESTING = new URL('../../seed/dist/testing/index.js', import.meta.url).href;

/** The fake app store command: `node store.mjs <store id> <state file> <protocol args>`; its state is a JSON file, so an executed import persists across runs. */
const STORE_SCRIPT = `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { serveStore } from '${SEED_INDEX}';
import { memoryStore } from '${SEED_TESTING}';
const [id, file, ...args] = process.argv.slice(2);
const store = memoryStore({ id, sets: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}, format: id + '@1' });
const lines = (async function* () { for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) yield line; })();
process.exitCode = await serveStore(store, { args, lines, write: (line) => { process.stdout.write(line + '\\n'); } });
if (args[0] === 'import' && JSON.parse(args[1]).dryRun !== true) writeFileSync(file, JSON.stringify(store.snapshot()));
`;

const DB_SETS: MemorySets = { customers: { ada: { name: 'Ada' }, bob: { name: 'Bob' }, cyd: { name: 'Cyd' } }, orders: { o1: { total: 5 } } };
const DB_MORE: MemorySets = { ...DB_SETS, customers: { ...DB_SETS.customers, dee: { name: 'Dee' } } };
const OBJECTS: MemorySets = { avatars: { 'ada.png': { media: 'ada' } } };

interface Scenario {
  readonly app: string;
  readonly remote: string;
  readonly keyFile: string;
  readonly keyText: string;
  readonly otherKeyFile: string;
  /** Writes one snapshot into the production backup repository (or `into`); returns its commit. */
  copy(options: { takenAt: string; db?: MemorySets; environment?: string; into?: string }): Promise<string>;
  /** The state file of a target store. */
  state(store: string): string;
  /** Runs `starci app data` in the app and returns what it printed. */
  run(argv: string[], options?: { key?: string; deps?: DataDeps | 'default' }): Promise<{ code: number; out: string; err: string }>;
}

const age = (root: string, name: string): { file: string; recipient: string; text: string } => {
  const file = path.join(root, `${name}.txt`);
  assert.equal(spawnSync('age-keygen', ['-o', file]).status, 0);
  const text = fs.readFileSync(file, 'utf8');
  return { file, recipient: /# public key: (age1\S+)/u.exec(text)?.[1] ?? '', text };
};

const bare = (dir: string): string => {
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', '--bare', '-b', 'main', dir]).status, 0);
  return dir;
};

function scenario(t: TestContext): Scenario {
  const root = mkdtemp(t, 'starci-data-verb-');
  const app = path.join(root, 'app');
  const remotes = path.join(root, 'remotes');
  const stateDir = path.join(root, 'stores');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(stateDir);
  const script = path.join(root, 'store.mjs');
  fs.writeFileSync(script, STORE_SCRIPT);
  const key = age(root, 'owner');
  const other = age(root, 'other');
  const remote = bare(path.join(remotes, 'shop-seed-backup-prod'));
  bare(path.join(remotes, 'shop-seed-backup-dev'));
  bare(path.join(remotes, 'shop-seed-standard'));
  const state = (store: string): string => path.join(stateDir, `${store}.json`);
  const command = (store: string): string => `        command:\n          - '${slash(process.execPath)}'\n          - '${slash(script)}'\n          - '${store}'\n          - '${slash(state(store))}'\n`;
  fs.writeFileSync(path.join(app, 'hfs.json'), JSON.stringify({ project: 'shop' }));
  fs.mkdirSync(path.join(app, '.starcistacks'));
  fs.writeFileSync(path.join(app, '.starcistacks', 'application-stacks.yaml'), `environments:
  dev: {}
  production:
    short: prod
data:
  stores:
    - id: database
      kind: database
      level: logical
      component: db
      adapter:
        module: be/db.ts
${command('database')}    - id: storage
      kind: storage
      level: logical
      component: minio
      adapter:
        module: be/storage.ts
${command('storage')}  sets:
    - id: shop-backup
      purpose: seed-backup
      stores: [database, storage]
      environments: [production]
      to:
        - driver: git
          repository: '${slash(remotes)}/shop-seed-backup-{env}'
    - id: shop-backup-dev
      purpose: seed-backup
      stores: [database]
      environments: [dev]
      to:
        - driver: git
          repository: '${slash(remotes)}/shop-seed-backup-{env}'
    - id: shop-standard
      purpose: seed-standard
      stores: [database]
      environments: [dev, production]
      commit: 0123456789abcdef0123456789abcdef01234567
      to:
        - driver: git
          repository: '${slash(remotes)}/shop-seed-standard'
    - id: fixed
      purpose: seed-backup
      stores: [database]
      environments: [production, dev]
      to:
        - driver: git
          repository: '${slash(remotes)}/shop-seed-backup-dev'
`);
  const stores = (_ctx: unknown, _env: string, declared: readonly { id: string; kind: 'database' | 'storage'; level: 'logical' | 'physical'; command: readonly string[] | null }[]): readonly StoreAdapter[] =>
    declared.map((store) => commandStore({ id: store.id, kind: store.kind, level: store.level }, spawnRunner(store.id, { argv: store.command ?? [], cwd: app, env: process.env, platform: process.platform })));
  let writers = 0;
  return {
    app, remote, keyFile: key.file, keyText: key.text, otherKeyFile: other.file,
    state,
    async copy({ takenAt, db = DB_SETS, environment = 'production', into = remote }) {
      const format = 'shop-seed-backup@1';
      const source = await exportOnce([memoryStore({ id: 'database', sets: db, format }), memoryStore({ id: 'storage', kind: 'storage', sets: OBJECTS, format })], {}, memorySpool(),
        { format, purpose: 'seed-backup', takenAt, source: { project: 'shop', environment } });
      const driver = createGitDriver({ id: 'writer', checkout: path.join(root, 'writers', `w${String((writers += 1))}`), remote: into, env: GIT });
      return (await driver.write(source, { recipients: [key.recipient], dryRun: false })).ref.locator;
    },
    async run(argv, { key: identity = key.file, deps } = {}) {
      let out = '';
      let err = '';
      const env = { ...process.env, ...GIT, STARCI_LOCAL_ROOT: path.join(root, 'state'), SOPS_AGE_KEY_FILE: identity };
      const code = await dataMain(argv, { cwd: app, env, stackIo: { now: () => NOW }, stdout: (text) => { out += text; }, stderr: (text) => { err += text; } }, deps === 'default' ? {} : { stores, ...deps });
      return { code, out, err };
    },
  };
}

const refused = (result: { code: number; err: string }, code: string): void => {
  assert.equal(result.code, 2, result.err);
  assert.match(result.err, new RegExp(`${code}:`, 'u'));
};
const noSecret = (s: Scenario, ...outputs: string[]): void => {
  for (const line of s.keyText.split(/\r?\n/u).filter((text) => text.startsWith('AGE-SECRET-KEY'))) for (const output of outputs) assert.ok(!output.includes(line), 'the identity is never printed');
};

test('status lists the newest copies of the environment with takenAt, digest, per-store counts and the sealed bytes against the cap', { skip }, async (t) => {
  const s = scenario(t);
  const first = await s.copy({ takenAt: iso(-3000) });
  const second = await s.copy({ takenAt: iso(-30), db: DB_MORE });
  const result = await s.run(['status', '--env', 'production']);
  assert.equal(result.code, 1, 'the listing is red: the set `fixed` resolves to the repository of dev');
  assert.match(result.out, /set fixed: REFUSED .*DATA_SYNC_OTHER_ENVIRONMENT/, 'and its refusal is its own line, the other sets are still listed');
  assert.match(result.out, /set shop-backup \(seed-backup, production\) in shop-seed-backup-prod/);
  assert.ok(result.out.includes(second.slice(0, 12)) && result.out.includes(first.slice(0, 12)));
  assert.match(result.out, /taken 2026-11-15T11:30:00\.000Z/);
  assert.match(result.out, /sealed \d+\.\d{2} MiB of 500 MiB \(\d+\.\d%\)/);
  assert.match(result.out, /database: 5 items, storage: 1 items/);
  assert.match(result.out, /database: 4 items, storage: 1 items/);
  assert.match(result.out, /healthy/);
  assert.ok(!result.out.includes('shop-backup-dev'), 'only this environment\'s sets');
  noSecret(s, result.out, result.err);
  const json = await s.run(['status', '--env', 'production', '--set', 'shop-backup', '--json']);
  const parsed = JSON.parse(json.out) as { sets: { copies: { commit: string; sealedBytes: number; capBytes: number; healthy: boolean; items: Record<string, number> }[] }[] };
  assert.equal(parsed.sets[0]?.copies[0]?.commit, second);
  assert.equal(parsed.sets[0]?.copies[0]?.capBytes, 524_288_000);
  assert.ok((parsed.sets[0]?.copies[0]?.sealedBytes ?? 0) > 0 && parsed.sets[0]?.copies[0]?.healthy === true);
  assert.deepEqual(parsed.sets[0]?.copies[0]?.items, { database: 5, storage: 1 });
});

test('status of an environment with no backup set, a repository with no copy, and the refusals of its flags', { skip }, async (t) => {
  const s = scenario(t);
  assert.match((await s.run(['status', '--env', 'dev', '--set', 'shop-backup-dev'])).out, /no copy yet/);
  refused(await s.run(['status', '--env', 'production', '--set', 'shop-standard']), 'DATA_SYNC_PURPOSE');
  refused(await s.run(['status', '--env', 'production', '--set', 'nope']), 'DATA_USAGE');
  refused(await s.run(['status', '--env', 'qa']), 'DATA_USAGE');
  refused(await s.run(['status', '--env', 'production', '--from', 'abc']), 'DATA_USAGE');
  refused(await s.run(['status', '--env', 'production', '--execute']), 'DATA_USAGE');
  refused(await s.run(['status']), 'DATA_USAGE');
  refused(await s.run(['status', 'extra', '--env', 'production']), 'DATA_USAGE');
  refused(await s.run(['stat', '--env', 'production']), 'DATA_USAGE');
});

test('verify opens the copy with the identity and reports every check; a wrong identity is unhealthy', { skip }, async (t) => {
  const s = scenario(t);
  const commit = await s.copy({ takenAt: iso(-60) });
  const good = await s.run(['verify', '--env', 'production', '--set', 'shop-backup', '--from', commit.slice(0, 10)]);
  assert.equal(good.code, 0, good.err);
  assert.match(good.out, /healthy/);
  assert.match(good.out, /ok\s+digests: every set matches its digest and count/);
  const newest = await s.run(['verify', '--env', 'production', '--set', 'shop-backup']);
  assert.ok(newest.out.includes(commit.slice(0, 12)), 'no --from verifies the newest copy');
  const wrong = await s.run(['verify', '--env', 'production', '--set', 'shop-backup'], { key: s.otherKeyFile });
  assert.equal(wrong.code, 1);
  assert.match(wrong.out, /UNHEALTHY/);
  assert.match(wrong.out, /FAIL\s+digests/);
  refused(await s.run(['verify', '--env', 'production']), 'DATA_USAGE');
  refused(await s.run(['verify', '--env', 'production', '--set', 'shop-backup', '--execute']), 'DATA_USAGE');
  refused(await s.run(['verify', '--env', 'production', '--set', 'shop-backup', '--from', 'ffffffff']), 'DATA_SYNC_SNAPSHOT_MISSING');
  noSecret(s, good.out, good.err, wrong.out, wrong.err);
});

test('verify with no identity anywhere refuses DATA_IDENTITY_MISSING and names no value', { skip }, async (t) => {
  const s = scenario(t);
  await s.copy({ takenAt: iso(-60) });
  const home = mkdtemp(t, 'starci-data-noid-');
  let err = '';
  const code = await dataMain(['verify', '--env', 'production', '--set', 'shop-backup'], { cwd: s.app, env: { PATH: process.env.PATH, STARCI_LOCAL_ROOT: path.join(home, 'state'), APPDATA: home, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, ...GIT }, stdout: () => undefined, stderr: (text) => { err += text; } });
  assert.equal(code, 2, err);
  assert.match(err, /DATA_IDENTITY_MISSING:/);
});

test('sync is a dry run: it counts per store and set what an import would do and writes nothing; --execute applies it, and a non-empty target with no other backup is then refused', { skip }, async (t) => {
  const s = scenario(t);
  const commit = await s.copy({ takenAt: iso(-60) });
  const dry = await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', commit]);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /dry run, mode merge \(nothing is removed\)/);
  assert.match(dry.out, /database\/customers {2}created 3 {2}updated 0 {2}unchanged 0 {2}removed 0/);
  assert.match(dry.out, /database\/orders {2}created 1/);
  assert.match(dry.out, /storage\/avatars {2}created 1/);
  assert.match(dry.out, /dry run: nothing was written; add --execute to apply/);
  assert.match(dry.out, /receipt: data sync shop-backup into production from .* dry run .* outcome applied/);
  assert.ok(!fs.existsSync(s.state('database')) && !fs.existsSync(s.state('storage')), 'the dry run wrote nothing into the stores');
  const done = await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', commit, '--execute']);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /executing, mode merge/);
  assert.match(done.out, /database\/customers {2}created 3/);
  assert.match(done.out, /receipt: data sync shop-backup into production from .* executed 2026-11-15T12:00:00\.000Z outcome applied/);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.state('database'), 'utf8')), DB_SETS, 'the snapshot is in the target store');
  assert.deepEqual(JSON.parse(fs.readFileSync(s.state('storage'), 'utf8')), OBJECTS);
  // The target now holds data, and the snapshot being synced is the only copy: a second sync is refused, so it is not an overwrite by accident.
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', commit, '--execute']), 'DATA_SYNC_TARGET_UNPROTECTED');
  noSecret(s, dry.out, dry.err, done.out, done.err);
});

test('the reset rule: a target that holds data is synced only with a healthy copy of THIS environment younger than maxAgeMinutes other than the snapshot', { skip }, async (t) => {
  const s = scenario(t);
  const old = await s.copy({ takenAt: iso(-3 * 1440) });
  fs.writeFileSync(s.state('database'), JSON.stringify({ customers: { ada: { name: 'Ada, edited' }, zed: { name: 'Zed' } } }));
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', old]), 'DATA_SYNC_TARGET_UNPROTECTED');
  const newest = await s.copy({ takenAt: iso(-60), db: DB_MORE });
  const allowed = await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', old, '--execute']);
  assert.equal(allowed.code, 0, allowed.err);
  assert.match(allowed.out, /database\/customers {2}created 2 {2}updated 1 {2}unchanged 0 {2}removed 0/, 'merge: Zed is left, Ada is updated');
  assert.ok('zed' in (JSON.parse(fs.readFileSync(s.state('database'), 'utf8')) as { customers: object }).customers, 'a merge removes nothing');
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', newest]), 'DATA_SYNC_TARGET_UNPROTECTED');
});

test('a copy of another environment never protects: the snapshots of dev in this repository are refused and do not count', { skip }, async (t) => {
  const s = scenario(t);
  const mine = await s.copy({ takenAt: iso(-3 * 1440) });
  const dev = await s.copy({ takenAt: iso(-5), db: DB_MORE, environment: 'dev' });
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', dev]), 'DATA_SYNC_OTHER_ENVIRONMENT');
  refused(await s.run(['verify', '--env', 'production', '--set', 'shop-backup', '--from', dev]), 'DATA_SYNC_OTHER_ENVIRONMENT');
  fs.writeFileSync(s.state('database'), JSON.stringify({ customers: { zed: { name: 'Zed' } } }));
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', mine]), 'DATA_SYNC_TARGET_UNPROTECTED');
});

test('a repository that resolves to another environment name is refused whoever asks', { skip }, async (t) => {
  const s = scenario(t);
  const commit = await s.copy({ takenAt: iso(-60) });
  refused(await s.run(['sync', '--env', 'production', '--set', 'fixed', '--from', commit]), 'DATA_SYNC_OTHER_ENVIRONMENT');
  refused(await s.run(['status', '--env', 'production', '--set', 'fixed']), 'DATA_SYNC_OTHER_ENVIRONMENT');
  refused(await s.run(['verify', '--env', 'production', '--set', 'fixed', '--from', commit]), 'DATA_SYNC_OTHER_ENVIRONMENT');
});

test('a snapshot that is not in the repository, and the flags sync needs', { skip }, async (t) => {
  const s = scenario(t);
  const commit = await s.copy({ takenAt: iso(-60) });
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', 'deadbeef']), 'DATA_SYNC_SNAPSHOT_MISSING');
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', 'not-a-commit']), 'DATA_SYNC_SNAPSHOT_MISSING');
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup']), 'DATA_USAGE');
  refused(await s.run(['sync', '--env', 'production', '--from', commit]), 'DATA_USAGE');
  refused(await s.run(['sync', '--set', 'shop-backup', '--from', commit]), 'DATA_USAGE');
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', commit, '--mirror']), 'DATA_USAGE');
  const empty = await s.run(['verify', '--env', 'dev', '--set', 'shop-backup-dev']);
  refused(empty, 'DATA_SYNC_SNAPSHOT_MISSING');
});

test('a standard is never synced; a set of another environment is refused whoever asks', { skip }, async (t) => {
  const s = scenario(t);
  const commit = await s.copy({ takenAt: iso(-60) });
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-standard', '--from', commit]), 'DATA_SYNC_PURPOSE');
  refused(await s.run(['verify', '--env', 'dev', '--set', 'shop-standard']), 'DATA_SYNC_PURPOSE');
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup-dev', '--from', commit]), 'DATA_SYNC_OTHER_ENVIRONMENT');
  refused(await s.run(['sync', '--env', 'dev', '--set', 'shop-backup', '--from', commit]), 'DATA_SYNC_OTHER_ENVIRONMENT');
});

test('a copy that does not verify is refused DATA_SYNC_COPY_UNHEALTHY before any store is touched', { skip }, async (t) => {
  const s = scenario(t);
  const commit = await s.copy({ takenAt: iso(-60) });
  const wrong = await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', commit, '--execute'], { key: s.otherKeyFile });
  refused(wrong, 'DATA_SYNC_COPY_UNHEALTHY');
  assert.ok(!fs.existsSync(s.state('database')), 'no store was touched');
  noSecret(s, wrong.out, wrong.err);
});

test('the default store opener reaches a dev (docker-compose) environment only: a deployed one is refused DATA_SYNC_UNREACHABLE', { skip }, async (t) => {
  const s = scenario(t);
  const commit = await s.copy({ takenAt: iso(-60) });
  refused(await s.run(['sync', '--env', 'production', '--set', 'shop-backup', '--from', commit], { deps: 'default' }), 'DATA_SYNC_UNREACHABLE');
});
