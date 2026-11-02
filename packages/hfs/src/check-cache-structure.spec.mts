// The result cache of the structure pass (`--gate hfs`) and of the secrets family: contexts/project/check-cache.md "Which step reuses what". Every test runs the real pass
// (the content rules, the managed files, the unused-symbol analysis) over a small two-sided app in a temp git repository, with the architecture machine and the contract emit
// as doubles that count their runs. The app has a git-ignored generated input the fe program includes, the case that never reused its whole-program steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../cache/git.mjs';
import { HFS_FOLDER } from '../cache/hfs-family.mjs';
import { trackedFiles } from '../runtime/scripts/hfs/check.mjs';
import { FAKE_KEY, FILES, PORTABLE, appRepo, changed, hashes, runPass, write } from './check-cache-structure-support.mjs';

const WHOLE_PROGRAM = (side: string): string[] => [`${side} machine`, `${side} unused-symbol`];
const FILE_RULES = (files: readonly string[]): string[] => files.map((file) => `${file} file-rules`);
const sorted = (list: readonly string[]): string[] => [...list].sort();
/** The records a run rewrote other than the always-run rules' own findings (step `hfs`). */
const steps = (keys: readonly string[]): string[] => keys.filter((key) => !key.endsWith(' hfs'));

test('S2 a tracked file edited during the run gets no per-file record, the files nobody touched keep theirs', async (t) => {
  const root = appRepo(t);
  const during = (side: string): void => { if (side === 'be') write(root, 'be/src/notes.ts', 'export const notes = "edited during the run";\n'); };
  const { hfs } = await runPass(root, { during });
  const keys = new Set(hfs.map((record) => `${record.path} ${record.step}`));
  assert.ok(!keys.has('be/src/notes.ts file-rules'), 'the edited file has no per-file record');
  assert.ok(keys.has('be/src/other.ts file-rules') && keys.has('fe/src/page.ts file-rules'), 'the files nobody touched keep theirs');
  const next = await runPass(root);
  assert.ok(next.hfs.some((record) => record.path === 'be/src/notes.ts' && record.step === 'file-rules'), 'the next run judges the edited file and records it');
});

test("S2 a one-file edit re-runs that file's per-file rules and the side's whole-program steps, nothing else of the files", async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  write(root, 'fe/src/list.ts', 'export const list = 3;\n');
  const next = await runPass(root);
  assert.deepEqual(next.calls, ['fe']);
  assert.deepEqual(steps(changed(cold.hfs, next.hfs)).filter((key) => !key.includes(' rule:')), sorted([...FILE_RULES(['fe/src/list.ts']), ...WHOLE_PROGRAM('fe')]));
});

test('S2 a deleted file drops its records and an added file gets its own; the files nobody touched keep theirs', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  git(root, ['rm', '-q', 'be/src/other.ts']);
  write(root, 'be/src/third.ts', 'export const third = 3;\n');
  git(root, ['add', 'be/src/third.ts']);
  const next = await runPass(root);
  assert.deepEqual(next.calls, ['be']);
  const rewritten = steps(changed(cold.hfs, next.hfs));
  assert.ok(rewritten.includes('be/src/other.ts file-rules'), 'the deleted file\'s record is gone');
  assert.ok(rewritten.includes('be/src/third.ts file-rules'), 'the added file is judged');
  assert.ok(!rewritten.includes('fe/src/page.ts file-rules') && !rewritten.some((key) => key.startsWith('fe ') && !key.startsWith('fe rule:')), 'the other side and its files are untouched');
  const keys = new Set(next.hfs.map((record) => `${record.path} ${record.step}`));
  assert.ok(!keys.has('be/src/other.ts file-rules') && keys.has('be/src/third.ts file-rules'));
});

test('S3 secrets: a warm run reuses every file, a new secret in an edited file is found, a removed one disappears', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root, { hfs: false, secrets: true });
  const total = trackedFiles(root).filter((file) => !file.startsWith('.starcistacks/cache/')).length;
  assert.equal(cold.pass.secretsReport?.mode, 'full');
  assert.equal(cold.pass.secretsReport?.checked, total);
  const warm = await runPass(root, { hfs: false, secrets: true });
  assert.equal(warm.pass.secretsReport?.mode, 'diff');
  assert.equal(warm.pass.secretsReport?.checked, 0);
  assert.equal(warm.pass.secretsReport?.reused, total);
  assert.deepEqual(warm.calls, [], 'the secrets family runs no machine');
  write(root, 'be/src/notes.ts', `export const notes = '${FAKE_KEY}';\n`);
  const leaked = await runPass(root, { hfs: false, secrets: true });
  assert.equal(leaked.pass.secretsReport?.checked, 1);
  assert.equal(leaked.pass.secretsReport?.reused, total - 1);
  assert.equal(leaked.pass.secretsReport?.newFindings, 1);
  const plaintext = (run: Awaited<ReturnType<typeof runPass>>): (string | undefined)[] => run.pass.result.findings.filter((finding) => finding.code === 'HFS_PLAINTEXT_SECRET').map((finding) => finding.path);
  assert.deepEqual(plaintext(leaked), ['be/src/notes.ts']);
  const again = await runPass(root, { hfs: false, secrets: true });
  assert.equal(again.pass.secretsReport?.checked, 0, 'the finding is itself reused');
  assert.equal(again.pass.secretsReport?.knownFindings, 1);
  assert.deepEqual(plaintext(again), ['be/src/notes.ts']);
  write(root, 'be/src/notes.ts', 'export const notes = 1;\n');
  const fixed = await runPass(root, { hfs: false, secrets: true });
  assert.equal(fixed.pass.secretsReport?.checked, 1);
  assert.equal(fixed.pass.secretsReport?.fixedFindings, 1);
  assert.deepEqual(plaintext(fixed), []);
});

test('S3 a README\'s secret findings are keyed on the stack manifest beside it', async (t) => {
  const root = appRepo(t, { ...FILES, 'docs/README.md': '# docs\n' });
  const cold = await runPass(root, { hfs: false, secrets: true });
  write(root, 'docs/.starcistacks/application-stacks.yaml', 'x: 1\n');
  const next = await runPass(root, { hfs: false, secrets: true });
  assert.equal(cold.pass.secretsReport?.mode, 'full');
  assert.equal(next.pass.secretsReport?.mode, 'diff');
  assert.equal(next.pass.secretsReport?.checked, 1, 'only the README beside the new manifest is judged again');
  assert.notEqual(hashes(cold.hfs).get('docs/README.md\0file-rules'), hashes(next.hfs).get('docs/README.md\0file-rules'));
});

test('S3 a secrets-only run keeps the structure family\'s whole-program records, and an hfs run reuses what it recorded', async (t) => {
  const root = appRepo(t);
  await runPass(root);
  const alone = await runPass(root, { hfs: false, secrets: true });
  assert.deepEqual(alone.calls, []);
  assert.ok(alone.hfs.some((record) => record.path === 'fe' && record.step === 'machine'), 'the fe machine record survived');
  const next = await runPass(root);
  assert.deepEqual(next.calls, [], 'the structure family still reuses both sides');
  assert.equal(next.pass.report?.checked, 0);
});

test('a family that runs in full (a changed fingerprint) judges everything and reuses nothing', async (t) => {
  const root = appRepo(t);
  await runPass(root, { secrets: true });
  const other = { ...PORTABLE, parts: [{ name: 'hfs', sha256: 'h2' }] };
  const full = await runPass(root, { secrets: true, fingerprint: other });
  assert.equal(full.pass.report?.mode, 'full');
  assert.equal(full.pass.secretsReport?.mode, 'full');
  assert.equal(full.pass.report?.reused, 0);
  assert.equal(full.pass.secretsReport?.reused, 0);
  assert.deepEqual(sorted(full.calls), ['be', 'fe']);
});

test('the cache folder it writes is byte-stable: a second identical run rewrites nothing', async (t) => {
  const root = appRepo(t);
  await runPass(root);
  await runPass(root);
  const folder = path.join(root, '.starcistacks/cache', ...HFS_FOLDER.split('/'));
  const snapshot = (): string => JSON.stringify(fs.readdirSync(folder, { recursive: true }).map(String).sort().map((entry) => [entry, fs.statSync(path.join(folder, entry)).isFile() ? fs.readFileSync(path.join(folder, entry), 'utf8') : null]));
  const before = snapshot();
  await runPass(root);
  assert.equal(snapshot(), before);
});

test('the committed cache folder is judged live and never keyed: a tracked cache does not make a warm run re-judge anything', async (t) => {
  const root = appRepo(t);
  await runPass(root, { secrets: true });
  git(root, ['add', '-A', '-f', '.starcistacks']);
  git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'cache']);
  await runPass(root, { secrets: true });
  const warm = await runPass(root, { secrets: true });
  assert.equal(warm.pass.report?.checked, 0);
  assert.equal(warm.pass.secretsReport?.checked, 0);
  assert.ok(!warm.hfs.some((record) => record.path.startsWith('.starcistacks/cache/') && record.step === 'file-rules'), 'no record of the cache folder\'s own files');
});
