/** A seed-standard with raw/ and an adapter/ is the adapter's output, byte for byte (PROJECT-STACKS-13, R434): the commit hook and CI judge the index, the bring-up's seed step judges the pinned commit. */
// proves: HFS_DATA_ADAPTER_DRIFT@lite
// proves: HFS_DATA_ADAPTER_DRIFT@full
// proves: HFS_DATA_ADAPTER_UNGUARDED@lite
// proves: HFS_DATA_ADAPTER_UNGUARDED@full
// proves: STACK_SEED_ADAPTER_DRIFT@lite
// proves: STACK_SEED_ADAPTER_DRIFT@full
// proves: STACK_SEED_ADAPTER_INSTALL@lite
// proves: STACK_SEED_ADAPTER_INSTALL@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ADAPTER_ENTRY, STANDARD_GUARD, STANDARD_HOOK, STANDARD_WORKFLOW, adapterDriftFindings, adapterGuardFindings, blobId, isAdapterOutput, renderAdapter, stripTypesFlags,
} from '../runtime/scripts/hfs/rules/data-adapter.mjs';
import type { Rendered } from '../runtime/scripts/hfs/rules/data-adapter.mjs';
import { judge } from '../sync/hygiene.mjs';
import { pinnedStandardVerifier, standardGate, standardPins } from '../stack/standard-gate.mjs';
import type { PinVerifier, StandardPin } from '../stack/standard-gate.mjs';
import type { RunResult, StackContext } from '../stack/context.mjs';
import type { DbTarget } from '../db/postgres.mjs';
import { seedStep } from '../stack/seeds.mjs';
import { ManifestBuilder, memorySpool, spooledSource } from '@starci/seed';
import type { ExportSource } from '@starci/seed';
import { STANDARD_TAKEN_AT } from '@starci/seed/git';
import { mkdtemp } from './helpers/tmpdir.mjs';

const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_AUTHOR_NAME: 'spec', GIT_AUTHOR_EMAIL: 'spec@example.test', GIT_COMMITTER_NAME: 'spec', GIT_COMMITTER_EMAIL: 'spec@example.test' };
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', args, { cwd, env: gitEnv, windowsHide: true, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};

/**
 * A fixture adapter: plain TypeScript that node runs with types stripped and no dependency, writing the standard layout from raw/*.md. The
 * real one renders through @starci/seed's git driver (its own specs prove that); the check judges only what an adapter writes.
 */
const adapterSource = (stamp: string): string => `import fs from 'node:fs';
import path from 'node:path';
const argv: string[] = process.argv.slice(2);
const raw: string = argv[argv.indexOf('--raw') + 1] ?? 'raw';
const out: string = argv[argv.indexOf('--out') + 1] ?? '.';
const names = fs.readdirSync(raw).filter((name) => name.endsWith('.md') && name !== 'README.md').sort();
const records = Object.fromEntries(names.map((name) => [name.slice(0, -3), { body: fs.readFileSync(path.join(raw, name), 'utf8') }]));
const shard = JSON.stringify(records) + '\\n';
fs.mkdirSync(path.join(out, 'data/database/articles'), { recursive: true });
fs.writeFileSync(path.join(out, 'data/database/articles/all.json'), shard);
const manifest = { schema: 'starci/data-manifest@1', format: 'shop-seed-standard@1', purpose: 'seed-standard', takenAt: ${stamp}, source: { project: 'shop', environment: 'standard' }, sets: [], exportDigest: '', sealing: 'none', recipients: [], shards: {}, files: { 'data/database/articles/all.json': { plain: '', bytes: shard.length } } };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\\n');
`;
const DETERMINISTIC = adapterSource("'1970-01-01T00:00:00.000Z'");
const CLOCKED = adapterSource("(await import('node:crypto')).randomUUID()");

const HOOK = `#!/bin/sh\nexec ${STANDARD_GUARD}\n`;
const WORKFLOW = `name: seed-standard\non: [push, pull_request]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx --yes --package starci-harness starci app check --staged\n`;
const PACKAGE = '{"name":"fixture-adapter","version":"0.0.0","private":true,"type":"module"}\n';
const LOCK = '{"name":"fixture-adapter","version":"0.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture-adapter","version":"0.0.0"}}}\n';

/** An adapter repository staged in a fresh git repository: raw/, adapter/, the hook and the workflow, and the adapter's output rendered and staged. */
function standardRepository(t: TestContext, source = DETERMINISTIC): string {
  const root = mkdtemp(t, 'hfs-data-adapter-');
  git(root, 'init', '-q', '-b', 'main');
  const files: Record<string, string> = {
    '.gitattributes': '* -text\n',
    'raw/README.md': '# raw\n',
    'raw/welcome.md': '# Welcome\n',
    'raw/about.md': '# About\n',
    [ADAPTER_ENTRY]: source,
    'adapter/package.json': PACKAGE,
    'adapter/package-lock.json': LOCK,
    [STANDARD_HOOK]: HOOK,
    [STANDARD_WORKFLOW]: WORKFLOW,
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const ran = spawnSync(process.execPath, [...stripTypesFlags(), ADAPTER_ENTRY], { cwd: root, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  git(root, 'add', '-A');
  return root;
}

const guard = (root: string): string[] => judge(root, []).findings.filter((finding) => finding.code.startsWith('HFS_DATA_')).map((finding) => `${finding.code} ${finding.file}`);

test('R434 the commit hook: an adapter repository whose committed output is the adapter\'s over raw/ is green', (t) => {
  const root = standardRepository(t);
  assert.deepEqual(guard(root), [], 'the output matches, the hook and the workflow run the guard');
});

test('R434 a hand edit of data/ in an adapter repository is refused, so is raw/ committed without its output', (t) => {
  const root = standardRepository(t);
  fs.writeFileSync(path.join(root, 'data/database/articles/all.json'), '{"welcome":{"body":"edited by hand"}}\n');
  git(root, 'add', '-A');
  assert.deepEqual(guard(root), ['HFS_DATA_ADAPTER_DRIFT data/database/articles/all.json']);
  const message = judge(root, []).findings.find((finding) => finding.code === 'HFS_DATA_ADAPTER_DRIFT')?.message ?? '';
  assert.match(message, /never edited by hand/u);

  const raw = standardRepository(t);
  fs.writeFileSync(path.join(raw, 'raw/contact.md'), '# Contact\n');
  git(raw, 'add', '-A');
  assert.deepEqual(guard(raw), ['HFS_DATA_ADAPTER_DRIFT data/database/articles/all.json', 'HFS_DATA_ADAPTER_DRIFT manifest.json'], 'a raw/ change commits with the output it makes');
});

test('R434 the hook judges raw/ as the index holds it, and refuses an adapter/ the index does not hold', (t) => {
  const root = standardRepository(t);
  fs.writeFileSync(path.join(root, 'raw/contact.md'), '# Contact\n');
  assert.deepEqual(guard(root), [], 'an unstaged raw/ file is not part of the commit');
  fs.appendFileSync(path.join(root, ADAPTER_ENTRY), '// a change not staged\n');
  assert.deepEqual(guard(root), ['HFS_DATA_ADAPTER_DRIFT adapter/']);
});

test('R434 a non-deterministic adapter is refused: two runs over the same raw/ differ', (t) => {
  const root = standardRepository(t, CLOCKED);
  const findings = judge(root, []).findings.filter((finding) => finding.code === 'HFS_DATA_ADAPTER_DRIFT');
  assert.deepEqual(findings.map((finding) => finding.file), ['manifest.json']);
  assert.match(findings[0]?.message ?? '', /not deterministic/u);
});

test('R434 with R400 over raw/: a sealed file in raw/ and an oversize raw/ file are refused', (t) => {
  const root = standardRepository(t);
  fs.writeFileSync(path.join(root, 'raw/credentials.enc.yaml'), 'token: ENC[AES256_GCM,data:AA==,type:str]\nsops:\n  age: []\n');
  fs.writeFileSync(path.join(root, 'raw/huge.bin'), Buffer.alloc(4 * 1024 * 1024 + 1));
  git(root, 'add', '-A');
  assert.deepEqual(guard(root).sort(), ['HFS_DATA_FILE_SIZE raw/huge.bin', 'HFS_DATA_STANDARD_SEALED raw/credentials.enc.yaml']);
});

test('R434 HFS_DATA_ADAPTER_UNGUARDED: an adapter repository keeps its entry, its package, the hook and the CI workflow, each running the guard', () => {
  const files = ['adapter/main.ts', 'adapter/package.json', STANDARD_HOOK, STANDARD_WORKFLOW, 'raw/a.md'];
  const texts: Record<string, string> = { [STANDARD_HOOK]: HOOK, [STANDARD_WORKFLOW]: WORKFLOW };
  const read = (file: string): string | null => texts[file] ?? null;
  assert.deepEqual(adapterGuardFindings({ files, read }), []);
  assert.deepEqual(adapterGuardFindings({ files: ['raw/a.md', 'manifest.json'], read }), [], 'a standard without adapter/ is judged by R400 alone');
  const bare = adapterGuardFindings({ files: ['adapter/convert.ts'], read });
  assert.deepEqual(bare.map((finding) => finding.path), ['adapter/main.ts', 'adapter/package.json', STANDARD_HOOK, STANDARD_WORKFLOW]);
  assert.ok(bare.every((finding) => finding.code === 'HFS_DATA_ADAPTER_UNGUARDED'));
  const silent = adapterGuardFindings({ files, read: (file) => (file === STANDARD_HOOK ? '#!/bin/sh\nexit 0\n' : read(file)) });
  assert.deepEqual(silent.map((finding) => finding.path), [STANDARD_HOOK]);
  assert.match(silent[0]?.message ?? '', /does not run `starci app check --staged`/u);
});

test('R434 the comparison: a run that fails, two runs that differ, a file missing from either side', () => {
  const files = (entries: Record<string, string>): Rendered => ({ ok: true, files: new Map(Object.entries(entries)) });
  const committed = new Map([['manifest.json', 'a'], ['data/x/all.json', 'b']]);
  assert.deepEqual(adapterDriftFindings({ committed, first: files({ 'manifest.json': 'a', 'data/x/all.json': 'b' }), second: files({ 'manifest.json': 'a', 'data/x/all.json': 'b' }) }), []);
  const failed = adapterDriftFindings({ committed, first: { ok: false, reason: 'node adapter/main.ts exited 1' }, second: files({}) });
  assert.deepEqual(failed.map((finding) => finding.path), [ADAPTER_ENTRY]);
  assert.match(failed[0]?.message ?? '', /did not run over raw\/: node adapter\/main\.ts exited 1/u);
  const extra = adapterDriftFindings({ committed, first: files({ 'manifest.json': 'a', 'blobs/y/aa/1.bin': 'c' }), second: files({ 'manifest.json': 'a', 'blobs/y/aa/1.bin': 'c' }) });
  assert.deepEqual(extra.map((finding) => finding.path), ['data/x/all.json', 'blobs/y/aa/1.bin']);
  assert.equal(blobId(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a', 'the id git gives the same bytes');
  assert.equal(isAdapterOutput('raw/a.md'), false);
  assert.equal(isAdapterOutput('index/x.json'), true);
  assert.deepEqual(stripTypesFlags({ typescript: 'strip' }), []);
  assert.deepEqual(stripTypesFlags({}), ['--experimental-strip-types']);
});

test('R434 an adapter that fails names its error, and a missing dependency names the install', (t) => {
  const root = mkdtemp(t, 'hfs-data-adapter-run-');
  fs.mkdirSync(path.join(root, 'adapter'), { recursive: true });
  assert.deepEqual(renderAdapter(root, path.join(root, 'raw'), path.join(root, 'out')), { ok: false, reason: 'adapter/main.ts is missing' });
  fs.writeFileSync(path.join(root, ADAPTER_ENTRY), "import '@starci/seed/git';\n");
  const missing = renderAdapter(root, path.join(root, 'raw'), path.join(root, 'out'));
  assert.equal(missing.ok, false);
  assert.match((missing as { reason: string }).reason, /exited 1: .*npm ci --prefix adapter/u);
  const stuck = renderAdapter(root, 'raw', path.join(root, 'out'), () => ({ status: null, error: new Error('spawn failed') }));
  assert.deepEqual(stuck, { ok: false, reason: 'node adapter/main.ts could not run' });
});

const PIN_A = 'a'.repeat(40);
const stack = (sets: string): string => `environments:\n  dev: {}\n  production: {short: prod}\ndata:\n  stores:\n    - {id: database, kind: database, level: logical, component: db}\n  sets:\n${sets}`;
const standardSet = (extra = ''): string => `    - {id: articles, purpose: seed-standard, stores: [database], environments: [dev, production], to: [{driver: git, repository: https://github.com/example/shop-seed-standard}], commit: ${PIN_A}${extra}}\n`;

test('R434 the bring-up reads the pins of the environment: a git seed-standard pinned by commit, never a backup or a project kind', (t) => {
  const root = mkdtemp(t, 'hfs-standard-pins-');
  fs.mkdirSync(path.join(root, '.starcistacks'));
  fs.writeFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), stack(`${standardSet()}${standardSet(', completeness: "ext:core"').replace('articles', 'core')}    - {id: backup, purpose: seed-backup, stores: [database], environments: [dev], to: [{driver: git, repository: "https://github.com/example/shop-seed-backup-{env}"}]}\n    - {id: loose, purpose: seed-standard, stores: [database], environments: [dev], to: [{driver: s3}], commit: ${PIN_A}}\n    - {id: unpinned, purpose: seed-standard, stores: [database], environments: [dev], to: [{driver: git, repository: https://github.com/example/x-seed-standard}]}\n`));
  assert.deepEqual(standardPins(root, 'dev'), [{ set: 'articles', repository: 'https://github.com/example/shop-seed-standard', name: 'shop-seed-standard', commit: PIN_A, stores: ['database'], force: false }]);
  assert.deepEqual(standardPins(root, 'staging'), []);
  assert.deepEqual(standardPins(mkdtemp(t, 'hfs-standard-none-'), 'dev'), [], 'an app with no stack declaration loads no standard');
});

test('R434 STACK_SEED_ADAPTER_DRIFT: the gate verifies each pin once, refuses a drifting or unreadable pin, and plans in a dry run', () => {
  const pin: StandardPin = { set: 'articles', repository: 'https://github.com/example/shop-seed-standard', name: 'shop-seed-standard', commit: PIN_A, stores: ['database'], force: false };
  const clean: PinVerifier = () => ({ adapter: true, findings: [] });
  assert.deepEqual(standardGate({ pins: [pin], receipts: [], execute: true, verify: clean }), { lines: ['seed standard/articles: the adapter output matches the committed standard (shop-seed-standard@aaaaaaaaaaaa)'], verified: [pin] });
  assert.deepEqual(standardGate({ pins: [pin], receipts: [], execute: true, verify: () => ({ adapter: false, findings: [] }) }).lines, ['seed standard/articles: no adapter, the committed standard stands (shop-seed-standard@aaaaaaaaaaaa)']);
  assert.deepEqual(standardGate({ pins: [pin], receipts: [{ scope: 'standard', id: 'articles', hash: PIN_A }], execute: true, verify: () => assert.fail('a verified pin is not judged again') }), { lines: ['seed standard/articles: verified before (shop-seed-standard@aaaaaaaaaaaa, once per pin)'], verified: [] });
  assert.match(standardGate({ pins: [pin], receipts: [], execute: false, verify: () => assert.fail('a dry run verifies nothing') }).lines[0] ?? '', /^plan seed standard\/articles: verify shop-seed-standard@aaaaaaaaaaaa/u);
  const drifting: PinVerifier = () => ({ adapter: true, findings: [{ code: 'HFS_DATA_ADAPTER_DRIFT', level: 'error', path: 'data/x.json', message: 'data/x.json differs from what the adapter writes from raw/' }] });
  assert.throws(() => standardGate({ pins: [pin], receipts: [], execute: true, verify: drifting }), (error: Error & { code?: string }) => error.code === 'STACK_SEED_ADAPTER_DRIFT' && /drifts from the committed standard .*data\/x\.json differs/u.test(error.message));
  const unreadable: PinVerifier = () => { throw Object.assign(new Error('no such commit'), { code: 'DATA_COPY_MISSING' }); };
  assert.throws(() => standardGate({ pins: [pin], receipts: [], execute: true, verify: unreadable }), (error: Error & { code?: string }) => error.code === 'STACK_SEED_ADAPTER_DRIFT' && /cannot be read at its pin \(DATA_COPY_MISSING\)/u.test(error.message));
  assert.throws(() => standardGate({ pins: [pin], receipts: [], execute: true, verify: () => { throw new Error('boom'); } }), /cannot be read at its pin: a standard/u);
});

test('R434 STACK_SEED_ADAPTER_INSTALL: an npm ci of the adapter that fails is named as such, never as drift; a failed checkout is unreadable', () => {
  const pin: StandardPin = { set: 'articles', repository: 'https://github.com/example/shop-seed-standard', name: 'shop-seed-standard', commit: PIN_A, stores: ['database'], force: false };
  const npm: PinVerifier = () => { throw Object.assign(new Error('npm ci failed: npm error notarget No matching version found for starci-harness@1.1.0-alpha.137'), { code: 'NPM_FAILED' }); };
  assert.throws(() => standardGate({ pins: [pin], receipts: [], execute: true, verify: npm }), (error: Error & { code?: string }) => error.code === 'STACK_SEED_ADAPTER_INSTALL' && /npm ci of its adapter\/ failed \(npm error notarget No matching version found for starci-harness@1\.1\.0-alpha\.137\)/u.test(error.message));
  const git: PinVerifier = () => { throw Object.assign(new Error('git checkout failed'), { code: 'GIT_FAILED' }); };
  assert.throws(() => standardGate({ pins: [pin], receipts: [], execute: true, verify: git }), (error: Error & { code?: string }) => error.code === 'STACK_SEED_STANDARD_UNREADABLE');
});

test('R434 the real verifier: a pinned commit is checked out, its adapter installed from its lockfile and run; a drifting commit is named', (t) => {
  const root = standardRepository(t);
  git(root, 'commit', '-q', '-m', 'standard');
  const good = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'data/database/articles/all.json'), '{"edited":{"body":"by hand"}}\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'a hand edit');
  const bad = git(root, 'rev-parse', 'HEAD');
  const cache = mkdtemp(t, 'hfs-standard-cache-');
  const verify = pinnedStandardVerifier({ cache });
  const pin = (commit: string): StandardPin => ({ set: 'articles', repository: root, name: 'shop-seed-standard', commit, stores: ['database'], force: false });
  assert.deepEqual(verify(pin(good)), { adapter: true, findings: [] });
  const drift = verify(pin(bad));
  assert.deepEqual(drift.findings.map((finding) => `${finding.code} ${finding.path}`), ['HFS_DATA_ADAPTER_DRIFT data/database/articles/all.json']);

  const plain = mkdtemp(t, 'hfs-standard-plain-');
  git(plain, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(plain, 'manifest.json'), '{}\n');
  git(plain, 'add', '-A');
  git(plain, 'commit', '-q', '-m', 'no adapter');
  assert.deepEqual(verify({ set: 'plain', repository: plain, name: 'plain-seed-standard', commit: git(plain, 'rev-parse', 'HEAD'), stores: [], force: false }), { adapter: false, findings: [] });
  const failing = pinnedStandardVerifier({ cache, spawn: () => ({ status: 1 }) });
  assert.throws(() => failing(pin(good)), (error: Error & { code?: string }) => error.code === 'GIT_FAILED');
});

const NO_ENTRY = "seed: no entry in .starcistacks/seeds or the environment's level";

test('R434 the seed step runs the gate before any entry: a drifting pin refuses the step, a verified pin writes its receipt once', async (t) => {
  const root = mkdtemp(t, 'hfs-standard-step-');
  fs.mkdirSync(path.join(root, '.starcistacks'));
  fs.writeFileSync(path.join(root, '.starcistacks/application-stacks.yaml'), stack(standardSet()));
  const state = { present: false, rows: [] as Array<{ scope: string; id: string; hash: string }> };
  const psql = (args: readonly string[]): RunResult => {
    const sql = args.filter((_, index) => args[index - 1] === '-c');
    if (!args.includes('-1')) return { status: 0, stdout: JSON.stringify(sql[0]?.includes('to_regclass') ? [{ present: state.present }] : state.rows.map((row) => ({ ...row, secrets: '' }))), stderr: '' };
    for (const statement of sql) {
      if (statement.startsWith('create table')) state.present = true;
      const values = /values \('([^']*)', '([^']*)', '([^']*)'/u.exec(statement);
      if (values) state.rows.push({ scope: String(values[1]), id: String(values[2]), hash: String(values[3]) });
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  // reason: the step reads only spawn of the context here: no entry opens a secret.
  const ctx = { env: {}, cwd: root, spawn: (_command: string, args: readonly string[]) => psql(args) } as unknown as StackContext;
  const target: DbTarget = { how: 'url', url: 'postgresql://owner@127.0.0.1:5432/app', env: {}, secrets: [] };
  // The loader after the gate reads an empty standard here (standard-load.spec.mts proves the read and the doors): no store is filled, no door runs.
  const empty = async (): Promise<ExportSource> => spooledSource(new ManifestBuilder().build({ format: 'shop-seed-standard@1', purpose: 'seed-standard', takenAt: STANDARD_TAKEN_AT, source: { project: 'shop', environment: 'standard' } }), memorySpool());
  const input = (standards: PinVerifier, execute = true) => ({ ctx, repoRoot: root, env: 'production', target, execute, command: () => assert.fail('no entry runs'), standards, standardReader: empty });
  await assert.rejects(seedStep(input(() => ({ adapter: true, findings: [{ code: 'HFS_DATA_ADAPTER_DRIFT', level: 'error', path: 'manifest.json', message: 'manifest.json differs' }] }))), /STACK_SEED_ADAPTER_DRIFT|drifts from the committed standard/u);
  assert.equal(state.rows.length, 0, 'a refused pin writes no receipt');
  assert.deepEqual((await seedStep(input(() => ({ adapter: true, findings: [] })))).lines, ['seed standard/articles: the adapter output matches the committed standard (shop-seed-standard@aaaaaaaaaaaa)', 'seed standard/articles: unchanged shop-seed-standard@aaaaaaaaaaaa (no set)', NO_ENTRY]);
  assert.deepEqual(state.rows.map((row) => `${row.id} ${row.hash.slice(0, 12)}`), ['articles aaaaaaaaaaaa', `articles@${PIN_A} ${state.rows[1]?.hash.slice(0, 12) ?? ''}`]);
  assert.deepEqual((await seedStep(input(() => assert.fail('verified once per pin')))).lines, ['seed standard/articles: verified before (shop-seed-standard@aaaaaaaaaaaa, once per pin)', 'seed standard/articles: kept (shop-seed-standard@aaaaaaaaaaaa applied before, once per pin)', NO_ENTRY]);
});

/** An adapter that, like renderStandard of @starci/seed, commits its output in a scratch git copy before it writes: git inherits its environment. */
const SCRATCH_GIT_ADAPTER = DETERMINISTIC.replace("import path from 'node:path';", `import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-render-'));
const scratchGit = (...args: string[]) => spawnSync('git', ['-c', 'user.name=render', '-c', 'user.email=render@example.test', '-C', scratch, ...args], { encoding: 'utf8' });
scratchGit('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(scratch, 'rendered.json'), '{}');
scratchGit('add', '-A');
scratchGit('commit', '-q', '-m', 'the scratch render commit');
fs.rmSync(scratch, { recursive: true, force: true });`);

test('R434 under a real pre-commit hook the adapter runs without the hook\'s GIT_* environment: the branch keeps only the user\'s commit and the index is untouched', (t) => {
  const root = standardRepository(t, SCRATCH_GIT_ADAPTER);
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  const judgeUrl = new URL('../sync/hygiene.mjs', import.meta.url).href;
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'guard.mjs'), `import { judge } from ${JSON.stringify(judgeUrl)};\nconst found = judge(process.cwd(), []).findings.filter((finding) => finding.code.startsWith('HFS_DATA_'));\nfor (const finding of found) console.error(finding.code + ' ' + finding.file);\nprocess.exitCode = found.length === 0 ? 0 : 1;\n`);
  fs.writeFileSync(hook, `#!/bin/sh\nexec ${JSON.stringify(process.execPath.split(path.sep).join('/'))} .git/hooks/guard.mjs\n`, { mode: 0o755 });
  const staged = git(root, 'ls-files', '-s');
  // A commit driven with GIT_DIR and GIT_WORK_TREE set (a worktree, an IDE, a hook manager): git hands them, with GIT_INDEX_FILE, to the hook.
  const committed = spawnSync('git', ['commit', '-q', '-m', 'the user commit'], { cwd: root, env: { ...gitEnv, GIT_DIR: path.join(root, '.git'), GIT_WORK_TREE: root }, windowsHide: true, encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.deepEqual(git(root, 'log', '--format=%s').split('\n'), ['the user commit'], 'no scratch render commit lands on the user\'s branch');
  assert.equal(git(root, 'ls-files', '-s'), staged, 'the index holds exactly what the user staged');
  assert.equal(git(root, 'status', '--porcelain'), '', 'nothing left staged or changed by the hook');
});
