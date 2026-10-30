// The `--types` family of the app check cache: a program's key is reused while nothing it reads changed, a change re-runs that program alone, the `.tsbuildinfo` lives in the
// untracked tool cache and never in the app, and a tsc that did not complete stores nothing. The last test runs the real TypeScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeSession } from '../cache/fake-session.mjs';
import { TSC_STEP, TYPES_FOLDER, createTscRunner, parseTscOutput, programKey, readsOf, relativise, runTypesFamily, tsBuildInfoPath } from '../cache/types-family.mjs';
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
  return { ran: [], outcomes: { be: { status: 0, output: '' }, 'fe/apps/web': { status: 0, output: '' } }, buildInfos: [] };
}

function runOnce(h: Harness, tree: Record<string, string>, stored: readonly CacheRecord[], options: { mode?: 'full' | 'diff'; programs?: readonly TypesProgram[]; during?: (session: ReturnType<typeof createFakeSession>) => void } = {}) {
  const session = createFakeSession({ files: tree, records: { [TYPES_FOLDER]: stored }, mode: options.mode ?? 'diff' });
  const result = runTypesFamily({
    session,
    programs: options.programs ?? [BE, WEB],
    toolCacheDir: path.join(os.tmpdir(), 'starci-cache-test', 'app-check'),
    run: (program, buildInfo) => {
      h.ran.push(program.name);
      h.buildInfos.push(buildInfo);
      options.during?.(session);
      return h.outcomes[program.name] ?? { status: 0, output: '' };
    },
  });
  return { session, result, records: [...(session.replaced.get(TYPES_FOLDER) ?? [])] };
}

test('the first run runs every program and records its diagnostics under the program key; an unchanged key reuses them', () => {
  const h = harness();
  h.outcomes['be'] = { status: 2, output: ERROR('be/src/a.ts') };
  const first = runOnce(h, files(), []);
  assert.deepEqual(h.ran, ['be', 'fe/apps/web']);
  assert.deepEqual(first.records.map((record) => [record.path, record.step, record.findings.length]), [['be', TSC_STEP, 1], ['fe/apps/web', TSC_STEP, 0]]);
  assert.deepEqual(first.records[0]?.findings[0], { path: 'be/src/a.ts', line: 3, column: 7, rule: 'TS2322', message: "Type 'string' is not assignable to type 'number'.\nThe expected type comes from property 'n'." });
  assert.equal(first.result.ok, false);
  assert.equal(first.session.reports[0]?.newFindings, 1);

  h.ran = [];
  const warm = runOnce(h, files(), first.records);
  assert.deepEqual(h.ran, [], 'tsc key reuse: nothing it reads changed');
  assert.deepEqual(warm.result.reused, ['be', 'fe/apps/web']);
  assert.deepEqual(warm.result.findings, first.result.findings, 'a reused program still reports what is wrong');
  assert.equal(warm.session.reports[0]?.knownFindings, 1);
  assert.equal(warm.session.reports[0]?.newFindings, 0);
  assert.deepEqual(warm.records, first.records);
});

test('a change re-runs the program that reads it and no other; a file outside both programs re-runs neither', () => {
  const h = harness();
  const first = runOnce(h, files(), []);
  h.ran = [];
  runOnce(h, { ...files(), 'README.md': 'changed docs\n' }, first.records);
  assert.deepEqual(h.ran, []);
  runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 2;\n' }, first.records);
  assert.deepEqual(h.ran, ['be']);
  h.ran = [];
  runOnce(h, { ...files(), 'fe/apps/web/src/page.ts': 'export const page = 2;\n' }, first.records);
  assert.deepEqual(h.ran, ['fe/apps/web']);
  h.ran = [];
  const added = { ...files(), 'be/src/b.ts': 'export const b = 1;\n' };
  runOnce(h, added, first.records);
  assert.deepEqual(h.ran, ['be'], 'an added file changes the key too');
  h.ran = [];
  const removed = files();
  delete removed['be/src/a.ts'];
  runOnce(h, removed, first.records);
  assert.deepEqual(h.ran, ['be'], 'and a deleted one');
});

test('a program also keys on the staged entries and the untracked files its TypeScript reads', () => {
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

test('the .tsbuildinfo goes to the untracked tool cache, one file per program, and never inside the committed cache', () => {
  const h = harness();
  runOnce(h, files(), []);
  const toolCache = path.join(os.tmpdir(), 'starci-cache-test', 'app-check');
  assert.deepEqual(h.buildInfos, [path.join(toolCache, 'tsbuildinfo', 'be.tsbuildinfo'), path.join(toolCache, 'tsbuildinfo', 'fe__apps__web.tsbuildinfo')]);
  assert.throws(() => tsBuildInfoPath(path.join('/work/app', '.starcistacks', 'cache', 'x'), '/work/app', BE), /never committed/u);
  assert.doesNotThrow(() => tsBuildInfoPath('/home/cache/app-check', '/work/app', BE));
});

test('a tsc that did not complete stores nothing, a program whose files changed during the run stores nothing, and --full ignores the records', () => {
  const h = harness();
  const first = runOnce(h, files(), []);
  h.outcomes['be'] = { status: 1, output: 'Segmentation fault\n' };
  const crashed = runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 3;\n' }, first.records);
  assert.deepEqual(crashed.result.incomplete, ['be']);
  assert.deepEqual(crashed.records.map((record) => record.path), ['fe/apps/web']);
  assert.equal(crashed.result.ok, false);

  h.outcomes['be'] = { status: 0, output: '' };
  const edited = runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 4;\n' }, [], { during: (session) => session.setFile('be/src/a.ts', 'export const a = 5;\n') });
  assert.deepEqual(edited.records.map((record) => record.path), ['fe/apps/web'], 'the edit during the run touched be only: be stores nothing, the other program is unaffected');
  assert.deepEqual(edited.result.incomplete, ['be']);

  h.ran = [];
  const full = runOnce(h, files(), first.records, { mode: 'full' });
  assert.deepEqual(h.ran, ['be', 'fe/apps/web']);
  assert.equal(full.session.reports[0]?.mode, 'full');
});

test('fixed findings are counted against the records, new ones against none', () => {
  const h = harness();
  h.outcomes['be'] = { status: 2, output: ERROR('be/src/a.ts') };
  const first = runOnce(h, files(), []);
  h.outcomes['be'] = { status: 0, output: '' };
  const fixed = runOnce(h, { ...files(), 'be/src/a.ts': 'export const a = 7;\n' }, first.records);
  assert.equal(fixed.session.reports[0]?.fixedFindings, 1);
  assert.equal(fixed.session.reports[0]?.newFindings, 0);
  assert.equal(fixed.result.ok, true);
});

test('tsc output parses into sorted findings with app-relative posix paths and no host path', () => {
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

test('with the real TypeScript: a clean program, an error, a reuse and a fix', { timeout: 120000 }, () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'types-real-'));
  const toolCache = fs.mkdtempSync(path.join(os.tmpdir(), 'types-real-cache-'));
  try {
    fs.mkdirSync(path.join(app, 'be', 'src'), { recursive: true });
    fs.writeFileSync(path.join(app, 'be', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'commonjs', types: [], noEmit: true }, include: ['src'] }));
    const write = (text: string): void => fs.writeFileSync(path.join(app, 'be', 'src', 'a.ts'), text);
    const tree = (): Record<string, string> => ({ 'be/tsconfig.json': fs.readFileSync(path.join(app, 'be', 'tsconfig.json'), 'utf8'), 'be/src/a.ts': fs.readFileSync(path.join(app, 'be', 'src', 'a.ts'), 'utf8') });
    const typescriptFrom = path.join(path.resolve(import.meta.dirname, '..'), 'package.json');
    const runner = createTscRunner({ appRoot: app, typescriptFrom });
    let runs = 0;
    const pass = (stored: readonly CacheRecord[]) => {
      const session = createFakeSession({ files: tree(), records: { [TYPES_FOLDER]: stored } });
      const result = runTypesFamily({ session: { ...session, root: app }, programs: [BE], toolCacheDir: toolCache, run: (program, buildInfo) => { runs += 1; return runner(program, buildInfo); } });
      return { result, records: [...(session.replaced.get(TYPES_FOLDER) ?? [])] };
    };
    write('export const a: number = "text";\n');
    const first = pass([]);
    assert.equal(first.result.ok, false);
    assert.deepEqual(first.result.findings.map((finding) => [finding.path, finding.line, finding.rule]), [['be/src/a.ts', 1, 'TS2322']]);
    assert.ok(fs.existsSync(path.join(toolCache, 'tsbuildinfo', 'be.tsbuildinfo')), 'the build info is in the tool cache');
    assert.ok(!fs.existsSync(path.join(app, 'be', 'tsconfig.tsbuildinfo')) && fs.readdirSync(path.join(app, 'be')).every((name) => !name.endsWith('.tsbuildinfo')), 'and not in the app');
    const warm = pass(first.records);
    assert.equal(runs, 1, 'the second pass reused the record');
    assert.deepEqual(warm.result.findings, first.result.findings);
    write('export const a: number = 1;\n');
    const fixed = pass(first.records);
    assert.equal(runs, 2);
    assert.equal(fixed.result.ok, true);
    assert.equal(fixed.records[0]?.findings.length, 0);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(toolCache, { recursive: true, force: true });
  }
});
