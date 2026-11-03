// The ESLint child of a diff: one process for the whole dirty list, the list outside the command line, the file count named for the budget, and a
// child that did not complete reaching no verdict (nothing stored, the failure surfaced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { nativeTestNode } from './fixtures/heavy-node.mts';
import type { HeavyNodeRequest, HeavyNodeResult, HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { runLinter } from '../lint/run.mjs';

/** A side folder whose installed `eslint` exists (the launcher resolves it) and is never started by the specs that fake the child. */
function side(context: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lint-list-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'node_modules', 'eslint');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"side","private":true}');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'eslint', version: '0.0.0', bin: { eslint: 'bin/eslint.js' } }));
  fs.writeFileSync(path.join(pkg, 'bin', 'eslint.js'), '');
  return root;
}

const longPath = (index: number): string => `src/${'deep-folder-'.repeat(8)}/component-${String(index).padStart(4, '0')}.tsx`;

test('600 long paths are ONE eslint child, and none of them is on its command line', async (context) => {
  const cwd = side(context);
  const files = Array.from({ length: 600 }, (_, index) => longPath(index));
  const requests: HeavyNodeRequest[] = [];
  const jobs: { files: string[]; fix: boolean }[] = [];
  const execute: HeavyNodeRun = async (request) => {
    requests.push(request);
    const job = JSON.parse(fs.readFileSync(String(request.args.at(-1)), 'utf8')) as { files: string[]; fix: boolean };
    jobs.push(job);
    return { status: 0, signal: null, stdout: JSON.stringify(job.files.map((file) => ({ filePath: path.join(cwd, file), messages: [] }))), stderr: '' };
  };
  const linted = await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json'], list: files }, execute);
  assert.equal(requests.length, 1);
  assert.equal(linted.error, undefined);
  assert.equal(linted.results?.length, 600);
  assert.deepEqual(jobs[0]?.files, files);
  const commandLine = ['node', ...(requests[0]?.args ?? [])].join(' ');
  assert.ok(commandLine.length < 1_000, `the command line is ${commandLine.length} characters`);
  assert.equal(commandLine.includes('component-'), false);
  assert.equal(fs.existsSync(String(requests[0]?.args.at(-1))), false, 'the job file is removed when the child is done');
  assert.equal(requests[0]?.kind, 'eslint');
});

test('the eslint request names the number of files it judges: a list its own length, a whole side the files of its scope', async (context) => {
  const cwd = side(context);
  const counts: (number | undefined)[] = [];
  const execute: HeavyNodeRun = async (request) => {
    counts.push(request.files);
    return { status: 0, signal: null, stdout: '[]', stderr: '' };
  };
  await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json'], list: [longPath(1), longPath(2), longPath(3)] }, execute);
  await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'], files: 11_126 }, execute);
  assert.deepEqual(counts, [3, 11_126]);
});

test('an eslint child that was killed reaches no verdict: the failure is surfaced and no result is returned', async (context) => {
  const cwd = side(context);
  const killed: HeavyNodeRun = async (): Promise<HeavyNodeResult> => ({ status: null, signal: 'SIGKILL', stdout: '[]', stderr: '' });
  await assert.rejects(runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json'], list: [longPath(1)] }, killed), { code: 'HFS_NODE_INCOMPLETE', message: /eslint did not complete/ });
  const timedOut: HeavyNodeRun = async (): Promise<HeavyNodeResult> => ({ status: null, signal: null, stdout: '[]', stderr: '', error: Object.assign(new Error('child deadline reached'), { code: 'ETIMEDOUT' }) });
  await assert.rejects(runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'], files: 10 }, timedOut), { code: 'HFS_NODE_INCOMPLETE' });
});

test('the list runner lints the list with the ESLint of the side in one process and prints the json of the CLI', async (context) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lint-list-real-'));
  context.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  // the side resolves ESLint from its own node_modules: this package's install stands in for the app's
  fs.symlinkSync(path.join(import.meta.dirname, '..', 'node_modules'), path.join(cwd, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"side","private":true}');
  fs.writeFileSync(path.join(cwd, 'eslint.config.mjs'), "export default [{ files: ['**/*.js'], rules: { 'no-debugger': 'error' } }];\n");
  fs.mkdirSync(path.join(cwd, 'with space'));
  fs.writeFileSync(path.join(cwd, 'with space', 'bad.js'), 'debugger;\n');
  fs.writeFileSync(path.join(cwd, 'good.js'), 'export const good = 1;\n');
  fs.writeFileSync(path.join(cwd, 'unlisted.js'), 'debugger;\n');
  const linted = await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json'], list: ['with space/bad.js', 'good.js'] }, nativeTestNode);
  assert.equal(linted.error, undefined);
  const byName = new Map((linted.results ?? []).map((result) => [path.basename(result.filePath), result.messages.map((message: { ruleId: string }) => message.ruleId)]));
  assert.deepEqual([...byName.keys()].sort(), ['bad.js', 'good.js']);
  assert.deepEqual(byName.get('bad.js'), ['no-debugger']);
  assert.deepEqual(byName.get('good.js'), []);
});

const SNAPSHOT = { files: 3, byFile: { 'src/a.ts': [{ rule: 'starci-fe/duplicate-code', code: 'HFS_DUPLICATE_CODE', line: 2, column: 1, message: 'copy of src/b.ts' }] } };

test('a run that asks for the project graph goes through the list runner, a whole side as the list `.`, and returns the snapshot the child wrote', async (context) => {
  const cwd = side(context);
  const requests: HeavyNodeRequest[] = [];
  const jobs: { files: string[]; fix: boolean; graph?: { out: string; canons: { name: string; entry: string }[] } }[] = [];
  const execute: HeavyNodeRun = async (request) => {
    requests.push(request);
    if (!String(request.args.at(-1)).endsWith('job.json')) return { status: 0, signal: null, stdout: '[]', stderr: '' };
    const job = JSON.parse(fs.readFileSync(String(request.args.at(-1)), 'utf8')) as (typeof jobs)[number];
    jobs.push(job);
    if (job.graph !== undefined) fs.writeFileSync(job.graph.out, JSON.stringify({ snapshots: { '@starci/eslint-canon-fe': SNAPSHOT } }));
    return { status: 0, signal: null, stdout: '[]', stderr: '' };
  };
  const canons = [{ name: '@starci/eslint-canon-fe', entry: path.join(cwd, 'canon.mjs') }];
  const whole = await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'], files: 11_126, graph: canons }, execute);
  assert.deepEqual(jobs[0]?.files, ['.']);
  assert.deepEqual(jobs[0]?.graph?.canons, canons);
  assert.deepEqual(whole.graph, { '@starci/eslint-canon-fe': SNAPSHOT });
  assert.equal(requests[0]?.files, 11_126, 'the heavy budget still counts the files of the scope');
  assert.ok(requests[0]?.args.some((arg) => String(arg).endsWith('eslint-list.cjs')));
  const listed = await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json'], list: [longPath(1)], graph: canons }, execute);
  assert.deepEqual(jobs[1]?.files, [longPath(1)]);
  assert.deepEqual(listed.graph, { '@starci/eslint-canon-fe': SNAPSHOT });
  assert.equal(fs.existsSync(String(jobs[1]?.graph?.out)), false, 'the snapshot file goes with the job file');
  const plain = await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'], files: 3 }, execute);
  assert.equal(jobs.length, 2, 'a run that asks for no graph is still the eslint binary itself');
  assert.equal(plain.graph, undefined);
});

test('a child that wrote no snapshot, a malformed one, or did not complete hands out nothing: the cache builds the graph itself', async (context) => {
  const cwd = side(context);
  const canons = [{ name: '@starci/eslint-canon-fe', entry: path.join(cwd, 'canon.mjs') }];
  const answer = (written: string | null): HeavyNodeRun => async (request) => {
    const job = JSON.parse(fs.readFileSync(String(request.args.at(-1)), 'utf8')) as { graph: { out: string } };
    if (written !== null) fs.writeFileSync(job.graph.out, written);
    return { status: 0, signal: null, stdout: '[]', stderr: '' };
  };
  for (const written of [null, '{', '{"snapshots": []}', '{"snapshots": {"a": {"byFile": {"x": 1}}}}']) {
    const run = await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'], files: 1, graph: canons }, answer(written));
    assert.equal(run.error, undefined);
    assert.equal(run.graph, undefined, String(written));
  }
});

test('the list runner hands the snapshot of each named canon out after the lint, and a canon that cannot answer is left out', async (context) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lint-graph-real-'));
  context.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.symlinkSync(path.join(import.meta.dirname, '..', 'node_modules'), path.join(cwd, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"side","private":true}');
  fs.writeFileSync(path.join(cwd, 'eslint.config.mjs'), "export default [{ files: ['**/*.js'], rules: { 'no-debugger': 'error' } }];\n");
  fs.writeFileSync(path.join(cwd, 'good.js'), 'export const good = 1;\n');
  // the first canon builds its graph once per process, as the real canon does
  fs.writeFileSync(path.join(cwd, 'canon.mjs'), "let built = 0; export const projectGraphSnapshot = ({ repoRoot }) => ({ files: 1, byFile: { 'good.js': [{ rule: 'r', code: 'C', line: 1, column: 1, message: `built ${++built} in ${repoRoot === process.cwd()}` }] } });\n");
  fs.writeFileSync(path.join(cwd, 'broken.mjs'), "export const projectGraphSnapshot = () => { throw new Error('the graph cannot be built'); };\n");
  const graph = [{ name: 'canon', entry: path.join(cwd, 'canon.mjs') }, { name: 'broken', entry: path.join(cwd, 'broken.mjs') }, { name: 'absent', entry: path.join(cwd, 'absent.mjs') }];
  const linted = await runLinter({ cwd, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'], files: 1, graph }, nativeTestNode);
  assert.equal(linted.error, undefined);
  assert.ok(linted.results?.some((result) => path.basename(result.filePath) === 'good.js'));
  assert.deepEqual(Object.keys(linted.graph ?? {}), ['canon']);
  assert.deepEqual(linted.graph?.['canon'], { files: 1, byFile: { 'good.js': [{ rule: 'r', code: 'C', line: 1, column: 1, message: 'built 1 in true' }] } });
});
