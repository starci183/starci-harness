// The `--types` family of the app check cache: a program's key is reused while nothing it reads changed, a change re-runs that program alone, a package bump re-runs
// only the programs whose `tsc` listed the package, the `.tsbuildinfo` lives in the untracked tool cache and never in the app, and a tsc that did not complete stores
// nothing. The last tests run the real TypeScript.
import test from 'node:test';
import { nativeTestNode } from './fixtures/heavy-node.mts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeSession } from '../cache/fake-session.mjs';
import { TSC_STEP, TYPES_FOLDER, createTscRunner, parseTscOutput, programKey, readsOf, relativise, runTypesFamily, splitListedFiles, tsBuildInfoPath } from '../cache/types-family.mjs';
import type { TscOutcome, TypesProgram } from '../cache/types-family.mjs';
import type { CacheRecord } from '../cache/types.mjs';

const BE: TypesProgram = { name: 'be', tsconfig: 'be/tsconfig.json' };
const WEB: TypesProgram = { name: 'fe/apps/web', tsconfig: 'fe/apps/web/tsconfig.json' };
const ERROR = (file: string): string => `${file}(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n  The expected type comes from property 'n'.\n`;

const files = (): Record<string, string> => ({
  'be/tsconfig.json': '{}\n',
  'be/src/a.ts': 'export const a = 1;\n',
  'fe/apps/web/tsconfig.json': '{}\n',
  'fe/apps/web/src/page.ts': 'export const page = 1;\n',
  'README.md': 'docs\n',
});

interface Harness { ran: string[]; outcomes: Record<string, TscOutcome>; buildInfos: string[] }

function harness(): Harness {
  return { ran: [], outcomes: { be: { status: 0, output: '', files: [] }, 'fe/apps/web': { status: 0, output: '', files: [] } }, buildInfos: [] };
}

async function runOnce(h: Harness, tree: Record<string, string>, stored: readonly CacheRecord[], options: { mode?: 'full' | 'diff'; programs?: readonly TypesProgram[]; root?: string; during?: (session: ReturnType<typeof createFakeSession>) => void } = {}) {
  const session = createFakeSession({ files: tree, records: { [TYPES_FOLDER]: stored }, mode: options.mode ?? 'diff', ...(options.root === undefined ? {} : { root: options.root }) });
  const result = await runTypesFamily({
    session,
    programs: options.programs ?? [BE, WEB],
    toolCacheDir: path.join(os.tmpdir(), 'starci-cache-test', 'app-check'),
    run: (program, buildInfo) => {
      h.ran.push(program.name);
      h.buildInfos.push(buildInfo);
      options.during?.(session);
      return h.outcomes[program.name] ?? { status: 0, output: '', files: [] };
    },
  });
  return { session, result, records: [...(session.replaced.get(TYPES_FOLDER) ?? [])] };
}

test('the first run runs every program and records its diagnostics under the program key; an unchanged key reuses them', async () => {
  const h = harness();
  h.outcomes['be'] = { status: 2, output: ERROR('be/src/a.ts'), files: [] };
  const first = await runOnce(h, files(), []);
  assert.deepEqual(h.ran, ['be', 'fe/apps/web']);
  assert.deepEqual(first.records.map((record) => [record.path, record.step, record.findings.length]), [['be', TSC_STEP, 1], ['fe/apps/web', TSC_STEP, 0]]);
  assert.deepEqual(first.records[0]?.findings[0], { path: 'be/src/a.ts', line: 3, column: 7, rule: 'TS2322', message: "Type 'string' is not assignable to type 'number'.\nThe expected type comes from property 'n'." });
  assert.equal(first.result.ok, false);
  assert.equal(first.session.reports[0]?.newFindings, 1);

  h.ran = [];
  const warm = await runOnce(h, files(), first.records);
  assert.deepEqual(h.ran, [], 'tsc key reuse: nothing it reads changed');
  assert.deepEqual(warm.result.reused, ['be', 'fe/apps/web']);
  assert.deepEqual(warm.result.findings, first.result.findings, 'a reused program still reports what is wrong');
  assert.equal(warm.session.reports[0]?.knownFindings, 1);
  assert.equal(warm.session.reports[0]?.newFindings, 0);
  assert.deepEqual(warm.records, first.records);
});

test('a change re-runs the program that reads it and no other; a file outside both programs re-runs neither', async () => {
  const h = harness();
  const first = await runOnce(h, files(), []);
  h.ran = [];
  await runOnce(h, { ...files(), 'README.md': 'changed docs\n' }, first.records);
  assert.deepEqual(h.ran, []);
  await runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 2;\n' }, first.records);
  assert.deepEqual(h.ran, ['be']);
  h.ran = [];
  await runOnce(h, { ...files(), 'fe/apps/web/src/page.ts': 'export const page = 2;\n' }, first.records);
  assert.deepEqual(h.ran, ['fe/apps/web']);
  h.ran = [];
  const added = { ...files(), 'be/src/b.ts': 'export const b = 1;\n' };
  await runOnce(h, added, first.records);
  assert.deepEqual(h.ran, ['be'], 'an added file changes the key too');
  h.ran = [];
  const removed = files();
  delete removed['be/src/a.ts'];
  await runOnce(h, removed, first.records);
  assert.deepEqual(h.ran, ['be'], 'and a deleted one');
});

/** An app root holding only a lockfile with `versions` (install path to version). */
function lockRoot(t: { after(fn: () => void): void }, versions: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'types-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, ...Object.fromEntries(Object.entries(versions).map(([key, version]) => [key, { version, integrity: `sha512-${version}` }])) } }));
  return root;
}

test('a package bump re-runs only the programs whose tsc listed the package; TypeScript itself re-runs every program that read its lib', async (t) => {
  const versions = { 'node_modules/typescript': '5.9.3', 'node_modules/@types/node': '24.0.0', 'node_modules/@nestjs/common': '11.0.0', 'node_modules/react': '19.0.0', 'node_modules/@starci/hfs': '6.1.1' };
  const listed = (root: string): Record<string, string[]> => ({
    be: [`${root}/node_modules/typescript/lib/lib.es2022.d.ts`, `${root}/node_modules/@types/node/index.d.ts`, `${root}/node_modules/@nestjs/common/index.d.ts`, `${root}/be/src/a.ts`],
    'fe/apps/web': [`${root}/node_modules/typescript/lib/lib.dom.d.ts`, `${root}/node_modules/react/index.d.ts`, `${root}/fe/apps/web/src/page.ts`],
  });
  const runAt = async (bumped: Record<string, string>, stored: readonly CacheRecord[]) => {
    const root = lockRoot(t, { ...versions, ...bumped });
    const h = harness();
    for (const [name, list] of Object.entries(listed(root))) h.outcomes[name] = { status: 0, output: '', files: list };
    return { h, run: await runOnce(h, files(), stored, { root }) };
  };
  const first = await runAt({}, []);
  assert.deepEqual(first.run.records.map((record) => (record.data as { reads: { packages: string[] } }).reads.packages), [
    ['node_modules/@nestjs/common', 'node_modules/@types/node', 'node_modules/typescript'],
    ['node_modules/react', 'node_modules/typescript'],
  ], 'each program keeps the installs it listed; its own folder is in its key already');
  assert.deepEqual((await runAt({ 'node_modules/@starci/hfs': '6.2.0' }, first.run.records)).h.ran, [], 'an hfs bump re-runs no program');
  assert.deepEqual((await runAt({ 'node_modules/@nestjs/common': '11.1.0' }, first.run.records)).h.ran, ['be'], 'a back-end library re-runs the back end alone');
  assert.deepEqual((await runAt({ 'node_modules/@types/node': '24.1.0' }, first.run.records)).h.ran, ['be'], 'an @types package re-runs the program that read it');
  assert.deepEqual((await runAt({ 'node_modules/typescript': '5.9.4' }, first.run.records)).h.ran, ['be', 'fe/apps/web'], 'the compiler re-runs every program');
});

test('a program keys on an app file it read outside its own folder (a workspace package by its real path)', async (t) => {
  const root = lockRoot(t, {});
  const tree = { ...files(), 'fe/packages/ui/src/button.ts': 'export const button = 1;\n' };
  const write = (text: string): void => {
    fs.mkdirSync(path.join(root, 'fe', 'packages', 'ui', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fe', 'packages', 'ui', 'src', 'button.ts'), text);
  };
  write('export const button = 1;\n');
  const h = harness();
  h.outcomes['fe/apps/web'] = { status: 0, output: '', files: [`${root}/fe/apps/web/src/page.ts`, `${root}/fe/packages/ui/src/button.ts`] };
  const first = await runOnce(h, tree, [], { root });
  assert.deepEqual((first.records[1]?.data as { reads: { files: string[] } }).reads.files, ['fe/packages/ui/src/button.ts']);
  h.ran = [];
  write('export const button = 2;\n');
  await runOnce(h, { ...tree, 'fe/packages/ui/src/button.ts': 'export const button = 2;\n' }, first.records, { root });
  assert.deepEqual(h.ran, ['fe/apps/web'], 'the package the web app reads re-runs it, and not the back end');
});

test('tsc --listFiles output splits into the listed absolute paths and the diagnostics', () => {
  const root = path.resolve(os.tmpdir(), 'some-app');
  const listedFile = path.join(root, 'node_modules', 'typescript', 'lib', 'lib.d.ts');
  const split = splitListedFiles([ERROR('be/src/a.ts').trimEnd(), listedFile, `${root}${path.sep}be${path.sep}src${path.sep}a.ts(1,1): error TS1005: ';' expected.`, ''].join('\n'));
  assert.deepEqual(split.files, [listedFile]);
  assert.equal(parseTscOutput(split.output, root, 'be/tsconfig.json').length, 2);
});

test('a program also keys on the staged entries and the untracked files its TypeScript reads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'types-key-'));
  try {
    fs.mkdirSync(path.join(root, 'be', 'generated'), { recursive: true });
    fs.writeFileSync(path.join(root, 'be', 'generated', 'schema.ts'), 'export type T = 1;\n');
    const session = { ...createFakeSession({ files: files() }), root };
    const base = programKey(BE, session);
    assert.equal(programKey(BE, session), base);
    assert.notEqual(programKey(BE, session, { staged: ['be/src/a.ts:abc123'] }), base);
    const generated = programKey(BE, session, { untracked: ['be/generated/schema.ts'] });
    assert.notEqual(generated, base);
    fs.writeFileSync(path.join(root, 'be', 'generated', 'schema.ts'), 'export type T = 2;\n');
    assert.notEqual(programKey(BE, session, { untracked: ['be/generated/schema.ts'] }), generated);
    assert.notEqual(programKey(BE, session, { untracked: ['be/generated/missing.ts'] }), base, 'a generated file that is gone is absent, not ignored');
    assert.deepEqual(readsOf({ name: 'x', tsconfig: 'fe/x/tsconfig.json', reads: ['fe/x', 'contract'] }), ['fe/x', 'contract']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the .tsbuildinfo goes to the untracked tool cache, one file per program, and never inside the committed cache', async () => {
  const h = harness();
  await runOnce(h, files(), []);
  const toolCache = path.join(os.tmpdir(), 'starci-cache-test', 'app-check');
  assert.deepEqual(h.buildInfos, [path.join(toolCache, 'tsbuildinfo', 'be.tsbuildinfo'), path.join(toolCache, 'tsbuildinfo', 'fe__apps__web.tsbuildinfo')]);
  assert.throws(() => tsBuildInfoPath(path.join('/work/app', '.starcistacks', 'cache', 'x'), '/work/app', BE), /never committed/u);
  assert.doesNotThrow(() => tsBuildInfoPath('/home/cache/app-check', '/work/app', BE));
});

test('a tsc that did not complete stores nothing, a program whose files changed during the run stores nothing, and --full ignores the records', async () => {
  const h = harness();
  const first = await runOnce(h, files(), []);
  h.outcomes['be'] = { status: 1, output: 'Segmentation fault\n', files: [] };
  const crashed = await runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 3;\n' }, first.records);
  assert.deepEqual(crashed.result.incomplete, ['be']);
  assert.deepEqual(crashed.records.map((record) => record.path), ['fe/apps/web']);
  assert.equal(crashed.result.ok, false);

  h.outcomes['be'] = { status: 0, output: '', files: [] };
  const edited = await runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 4;\n' }, [], { during: (session) => session.setFile('be/src/a.ts', 'export const a = 5;\n') });
  assert.deepEqual(edited.records.map((record) => record.path), ['fe/apps/web'], 'the edit during the run touched be only: be stores nothing, the other program is unaffected');
  assert.deepEqual(edited.result.incomplete, ['be']);

  h.ran = [];
  const full = await runOnce(h, files(), first.records, { mode: 'full' });
  assert.deepEqual(h.ran, ['be', 'fe/apps/web']);
  assert.equal(full.session.reports[0]?.mode, 'full');
});

test('fixed findings are counted against the records, new ones against none', async () => {
  const h = harness();
  h.outcomes['be'] = { status: 2, output: ERROR('be/src/a.ts'), files: [] };
  const first = await runOnce(h, files(), []);
  h.outcomes['be'] = { status: 0, output: '', files: [] };
  const fixed = await runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 7;\n' }, first.records);
  assert.equal(fixed.session.reports[0]?.fixedFindings, 1);
  assert.equal(fixed.session.reports[0]?.newFindings, 0);
  assert.equal(fixed.result.ok, true);
});

test('tsc output parses into sorted findings with app-relative posix paths and no host path', async () => {
  const root = path.resolve(os.tmpdir(), 'some-app');
  const output = [
    `${root.split(path.sep).join('/')}/be/src/z.ts(9,1): error TS2304: Cannot find name 'x' in ${root}${path.sep}be.`,
    'be\\src\\a.ts(2,5): error TS1005: \';\' expected.',
    'error TS5083: Cannot read file \'be/tsconfig.json\'.',
    '',
  ].join('\n');
  const findings = parseTscOutput(output, root, 'be/tsconfig.json');
  assert.deepEqual(findings.map((finding) => [finding.path, finding.line, finding.rule]), [['be/tsconfig.json', 1, 'TS5083'], ['be/src/a.ts', 2, 'TS1005'], ['be/src/z.ts', 9, 'TS2304']]);
  assert.ok(!findings.some((finding) => finding.message.includes(root)), findings[2]?.message);
  assert.equal(relativise(`at ${root}/x`, root), 'at x');
});

test('with the real TypeScript: a clean program, an error, a reuse and a fix', { timeout: 120000 }, async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'types-real-'));
  const toolCache = fs.mkdtempSync(path.join(os.tmpdir(), 'types-real-cache-'));
  try {
    fs.mkdirSync(path.join(app, 'be', 'src'), { recursive: true });
    fs.writeFileSync(path.join(app, 'be', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'commonjs', types: [], noEmit: true }, include: ['src'] }));
    const write = (text: string): void => fs.writeFileSync(path.join(app, 'be', 'src', 'a.ts'), text);
    const tree = (): Record<string, string> => ({ 'be/tsconfig.json': fs.readFileSync(path.join(app, 'be', 'tsconfig.json'), 'utf8'), 'be/src/a.ts': fs.readFileSync(path.join(app, 'be', 'src', 'a.ts'), 'utf8') });
    const typescriptFrom = path.join(path.resolve(import.meta.dirname, '..'), 'package.json');
    const runner = createTscRunner({ appRoot: app, typescriptFrom, execute: nativeTestNode });
    let runs = 0;
    const pass = async (stored: readonly CacheRecord[]) => {
      const session = createFakeSession({ files: tree(), records: { [TYPES_FOLDER]: stored } });
      const result = await runTypesFamily({ session: { ...session, root: app }, programs: [BE], toolCacheDir: toolCache, run: (program, buildInfo) => { runs += 1; return runner(program, buildInfo); } });
      return { result, records: [...(session.replaced.get(TYPES_FOLDER) ?? [])] };
    };
    write('export const a: number = "text";\n');
    const first = await pass([]);
    assert.equal(first.result.ok, false);
    assert.deepEqual(first.result.findings.map((finding) => [finding.path, finding.line, finding.rule]), [['be/src/a.ts', 1, 'TS2322']]);
    assert.ok(fs.existsSync(path.join(toolCache, 'tsbuildinfo', 'be.tsbuildinfo')), 'the build info is in the tool cache');
    assert.ok(!fs.existsSync(path.join(app, 'be', 'tsconfig.tsbuildinfo')) && fs.readdirSync(path.join(app, 'be')).every((name) => !name.endsWith('.tsbuildinfo')), 'and not in the app');
    const warm = await pass(first.records);
    assert.equal(runs, 1, 'the second pass reused the record');
    assert.deepEqual(warm.result.findings, first.result.findings);
    write('export const a: number = 1;\n');
    const fixed = await pass(first.records);
    assert.equal(runs, 2);
    assert.equal(fixed.result.ok, true);
    assert.equal(fixed.records[0]?.findings.length, 0);
    assert.ok((fixed.records[0]?.data as { reads: { files: string[] } }).reads.files.length === 0, 'the program read nothing of the app outside be/');
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(toolCache, { recursive: true, force: true });
  }
});


test('the native compiler requests its own tsc slot and rejects partial diagnostics before recording them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'types-admission-'));
  try {
    const session = { ...createFakeSession({ files: files() }), root };
    const runner = createTscRunner({ appRoot: root, typescriptFrom: path.resolve(import.meta.dirname, '..', 'package.json'), execute: async request => {
      assert.equal(request.kind, 'tsc');
      assert.ok(request.args.includes('--noEmit'));
      assert.equal(request.cwd, root);
      return { status: null, signal: null, stdout: ERROR('be/src/a.ts'), stderr: '', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) };
    } });
    await assert.rejects(runTypesFamily({ session, programs: [BE], run: runner, toolCacheDir: path.join(root, 'tools') }), /did not complete/u);
    assert.equal(session.replaced.has(TYPES_FOLDER), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
