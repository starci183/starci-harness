// `cachedLinters`, the ESLint and stylelint entry of `starci app check --gate lint`, through the result cache: the second run over one tree judges nothing, a change sends only its files, `--side` reads and writes its side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import type { TestContext } from 'node:test';
import { createFakeSession } from '../cache/fake-session.mjs';
import type { CacheRecord } from '../cache/types.mjs';
import { cachedLinters, runLinter, type LinterRunner } from '../lint/run.mjs';

interface Fixture { root: string; files: Record<string, string[]> }
interface Call { side: string; files: string[] }

function installedPackage(root: string, name: string, source: string): void {
  const directory = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(directory, 'index.mjs'), source);
}

function fixture(context: TestContext, canon: { crossFileInputs: boolean } = { crossFileInputs: true }): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lint-cache-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', sides: {
    be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] },
  } }));
  // the app's own TypeScript, as the cache resolves it from the side folder
  const typescript = path.join(root, 'node_modules', 'typescript');
  fs.mkdirSync(typescript, { recursive: true });
  fs.writeFileSync(path.join(typescript, 'package.json'), '{"name":"typescript","main":"index.js"}');
  fs.writeFileSync(path.join(typescript, 'index.js'), `module.exports = require(${JSON.stringify(createRequire(import.meta.url).resolve('typescript'))});\n`);
  const files: Record<string, string[]> = { be: ['src/backend.ts'], fe: ['src/universal.ts', 'src/family.tsx'] };
  for (const side of ['be', 'fe']) {
    const cwd = path.join(root, side);
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve' } }));
    for (const file of files[side] as string[]) fs.writeFileSync(path.join(cwd, file), 'export const value = 1;\n');
    const factory = side === 'be' ? 'starciBeConfig' : 'starciFeConfig';
    installedPackage(root, `@starci/eslint-canon-${side}`, [
      "import fs from 'node:fs';", "import path from 'node:path';", "import { fileURLToPath } from 'node:url';",
      `export const loadHfs = url => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(url)), '../hfs.json'), 'utf8')).sides.${side};`,
      `export const ${factory} = () => [{ files: ['src/**/*.ts', 'src/**/*.tsx'] }];`,
      ...(canon.crossFileInputs ? ['export const crossFileInputs = [];'] : []),
      ...(side === 'be' ? ['export const projectGraph = () => ({ byFile: {} });'] : []),
    ].join('\n'));
    fs.writeFileSync(path.join(cwd, 'eslint.config.mjs'), [
      `import { loadHfs, ${factory} } from '@starci/eslint-canon-${side}';`, 'const hfs = loadHfs(import.meta.url);', `export default [...${factory}({ hfs })];`,
    ].join('\n'));
  }
  installedPackage(root, '@starci/eslint-grammar-core', "export const coreGrammarConfig = () => [{ files: ['src/**/*.tsx'] }];\nexport const crossFileInputs = [];\n");
  return { root, files };
}

/** The tree as a fake session sees it: every file below the app, app-relative. */
function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (folder: string): void => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const rel = folder === '' ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) visit(rel);
      else out[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
    }
  };
  visit('');
  return out;
}

/** A linter that answers one finding per file named `bad.ts`, and records what it was asked. */
function linter(calls: Call[]): LinterRunner {
  return async ({ cwd, pkg, args, list }) => {
    assert.equal(pkg, 'eslint');
    const side = path.basename(cwd);
    const requested = list === undefined ? args.slice(2) : [...list];
    const files = requested[0] === '.' ? fs.readdirSync(path.join(cwd, 'src')).map((name) => `src/${name}`) : requested;
    calls.push({ side, files });
    return { results: files.map((file) => ({ filePath: path.join(cwd, file), messages: fs.readFileSync(path.join(cwd, file), 'utf8').includes('BAD') ? [{ ruleId: 'fake/no-bad', message: `BAD in ${file}`, line: 1, column: 1 }] : [] })) };
  };
}

/** One cached lint of `app` against `records`, as `app check` makes it; `side` limits it to one side. */
async function lint(app: Fixture, side: string | undefined, records: Record<string, readonly CacheRecord[]>, calls: Call[], mode: 'diff' | 'full' = 'diff', run: LinterRunner = linter(calls)) {
  const session = createFakeSession({ files: treeOf(app.root), records, mode });
  const answer = await cachedLinters({ repoRoot: app.root, app: readRepoDeclaration(loadSlotManifest(), app.root), side, run, session });
  return { ...answer, session };
}

const recordsOf = (session: { replaced: ReadonlyMap<string, readonly CacheRecord[]> }): Record<string, readonly CacheRecord[]> => Object.fromEntries(session.replaced);

test('the first lint judges both sides and writes their records; the second judges nothing and reports the same findings', async (context) => {
  const app = fixture(context);
  fs.writeFileSync(path.join(app.root, 'fe/src/universal.ts'), 'export const value = "BAD";\n');
  const calls: Call[] = [];
  const first = await lint(app, undefined, {}, calls);
  assert.deepEqual(calls.map((call) => call.side), ['be', 'fe']);
  assert.deepEqual([...first.session.replaced.keys()].sort(), ['lint/be', 'lint/fe']);
  assert.equal(first.eslint.findings.length, 1);
  assert.equal(first.session.reports.length, 1);
  assert.equal(first.session.reports[0]?.family, 'lint');
  assert.equal(first.session.reports[0]?.checked, 3);
  calls.length = 0;
  const second = await lint(app, undefined, recordsOf(first.session), calls);
  assert.deepEqual(calls, []);
  assert.deepEqual(second.eslint.findings, first.eslint.findings);
  assert.equal(second.session.reports[0]?.reused, 3);
  assert.equal(second.session.replaced.size, 0, 'nothing to rewrite when nothing changed');
  assert.deepEqual(second.eslint.errors, first.eslint.errors);
});

test('a changed file is the only one sent to the linter, through the same launcher as a full run', async (context) => {
  const app = fixture(context);
  const calls: Call[] = [];
  const first = await lint(app, undefined, {}, calls);
  calls.length = 0;
  fs.writeFileSync(path.join(app.root, 'be/src/backend.ts'), 'export const value = "BAD";\n');
  const second = await lint(app, undefined, recordsOf(first.session), calls);
  assert.deepEqual(calls, [{ side: 'be', files: ['src/backend.ts'] }]);
  assert.deepEqual(second.eslint.findings.map((finding) => finding.path), ['be/src/backend.ts']);
});

test('a diff names the whole side to the liveness budget of its child, whose typed program and project graph are those of the side', async (context) => {
  const app = fixture(context);
  for (const name of ['other', 'third']) fs.writeFileSync(path.join(app.root, `be/src/${name}.ts`), 'export const value = 1;\n');
  const first = await lint(app, 'be', {}, []);
  fs.writeFileSync(path.join(app.root, 'be/src/backend.ts'), 'export const value = 3;\n');
  const asked: { list: readonly string[] | undefined; files: number | undefined }[] = [];
  const answering = linter([]);
  await lint(app, 'be', recordsOf(first.session), [], 'diff', async (spec) => { asked.push({ list: spec.list, files: spec.files }); return answering(spec); });
  assert.deepEqual(asked, [{ list: ['src/backend.ts'], files: 3 }]);
});

test('a side limits the lint to that side and its records', async (context) => {
  const app = fixture(context);
  const calls: Call[] = [];
  const side = await lint(app, 'fe', {}, calls);
  assert.deepEqual(calls.map((call) => call.side), ['fe']);
  assert.deepEqual([...side.session.replaced.keys()], ['lint/fe']);
  assert.deepEqual(Object.keys(side.eslint.engine.sides), ['fe']);
  calls.length = 0;
  fs.writeFileSync(path.join(app.root, 'be/src/backend.ts'), 'export const value = "BAD";\n');
  const again = await lint(app, 'fe', recordsOf(side.session), calls);
  assert.deepEqual(calls, [], 'a change on the other side is not judged');
  assert.equal(again.session.replaced.size, 0);
});

test('a full decision of the session (fingerprint, no cache) judges everything and writes', async (context) => {
  const app = fixture(context);
  const calls: Call[] = [];
  const first = await lint(app, undefined, {}, calls);
  calls.length = 0;
  const second = await lint(app, undefined, recordsOf(first.session), calls, 'full');
  assert.deepEqual(calls.map((call) => call.side), ['be', 'fe']);
  assert.equal(second.session.reports[0]?.mode, 'full');
  assert.deepEqual([...second.session.replaced.keys()].sort(), ['lint/be', 'lint/fe']);
});

test('an installed canon without crossFileInputs makes a change a whole-side lint', async (context) => {
  const app = fixture(context, { crossFileInputs: false });
  const calls: Call[] = [];
  const first = await lint(app, 'be', {}, calls);
  calls.length = 0;
  fs.writeFileSync(path.join(app.root, 'be/src/backend.ts'), 'export const value = 2;\n');
  const second = await lint(app, 'be', recordsOf(first.session), calls);
  assert.deepEqual(calls, [{ side: 'be', files: ['src/backend.ts'] }]);
  assert.equal(second.session.reports[0]?.mode, 'full');
  assert.match(second.session.reports[0]?.reason ?? '', /declares no crossFileInputs/);
});

test('a tool error stores nothing', async (context) => {
  const app = fixture(context);
  const out = await lint(app, undefined, {}, [], 'diff', async () => ({ error: 'eslint did not start' }));
  assert.ok(out.eslint.errors.length > 0);
  assert.equal(out.session.replaced.size, 0);
});

test('an eslint child killed during a diff stores no record and the failure is surfaced', async (context) => {
  const app = fixture(context);
  installedPackage(app.root, 'eslint', '');
  fs.writeFileSync(path.join(app.root, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', version: '0.0.0', bin: { eslint: 'index.mjs' } }));
  const calls: Call[] = [];
  const first = await lint(app, undefined, {}, calls);
  fs.writeFileSync(path.join(app.root, 'be/src/backend.ts'), 'export const value = 2;' + String.fromCharCode(10));
  const session = createFakeSession({ files: treeOf(app.root), records: recordsOf(first.session) });
  const killed = (spec: Parameters<LinterRunner>[0]) => runLinter(spec, async () => ({ status: null, signal: 'SIGKILL' as const, stdout: '[]', stderr: '' }));
  const answer = await cachedLinters({ repoRoot: app.root, app: readRepoDeclaration(loadSlotManifest(), app.root), run: killed, session });
  assert.deepEqual(answer.eslint.errors, ['eslint did not complete in be/: eslint in be/ (1 file(s)) did not complete: killed by SIGKILL with no message of its own: most often the out-of-memory killer of the host or a deadline of the runner'], 'the changed side is a tool error that names its child and cause, and the unchanged one needs no child');
  assert.equal(session.replaced.size, 0);
});

/** The root packages of the fixture app: the managed root config and one package whose source carries a finding. */
function withPackages(app: Fixture): void {
  fs.writeFileSync(path.join(app.root, 'eslint.config.mjs'), "export default [{ files: ['packages/*/src/**/*.ts'] }];\n");
  fs.mkdirSync(path.join(app.root, 'packages', 'sdk', 'src'), { recursive: true });
  fs.writeFileSync(path.join(app.root, 'packages', 'sdk', 'src', 'pick.ts'), 'export const value = "BAD";\n');
}

/** A linter whose be child is ended by its liveness budget (`failure`); fe and the root packages answer one finding per BAD file. */
function failingBe(failure: Error): LinterRunner {
  const sides = linter([]);
  return async (spec) => {
    if (path.basename(spec.cwd) === 'be') throw failure;
    if (path.basename(spec.cwd) === 'fe') return sides(spec);
    const files = (spec.list ?? ['packages/sdk/src/pick.ts']).map((file) => path.join(spec.cwd, file));
    return { results: files.map((file) => ({ filePath: file, messages: fs.readFileSync(file, 'utf8').includes('BAD') ? [{ ruleId: 'fake/no-bad', message: 'BAD', line: 1, column: 1 }] : [] })) };
  };
}

test('a side whose child does not complete is a tool error of that side, and the next side and the root packages are still judged and reported', async (context) => {
  const app = fixture(context);
  withPackages(app);
  const out = await lint(app, undefined, {}, [], 'diff', failingBe(Object.assign(new Error('eslint did not complete'), { code: 'HFS_NODE_INCOMPLETE' })));
  assert.deepEqual(out.eslint.errors, ['eslint did not complete in be/: eslint did not complete']);
  assert.deepEqual(out.eslint.engine.sides['be'], { files: 0 });
  assert.equal(out.eslint.engine.sides['packages']?.files, 1);
  assert.deepEqual(out.eslint.findings.map((finding) => finding.path), ['packages/sdk/src/pick.ts']);
  assert.deepEqual([...out.session.replaced.keys()], ['lint/fe'], 'the failed side records nothing, the judged one does');
});

test('a hold of the host still ends the lint run: no scope would be admitted', async (context) => {
  const app = fixture(context);
  withPackages(app);
  for (const code of ['HOST_HELD', 'HEAVY_DEFERRED']) {
    await assert.rejects(lint(app, undefined, {}, [], 'diff', failingBe(Object.assign(new Error('held'), { code, exitCode: 75 }))), { code });
  }
});

test('--side packages lints the root packages alone, and a packages child that does not complete is their own tool error', async (context) => {
  const app = fixture(context);
  withPackages(app);
  const calls: Call[] = [];
  const out = await lint(app, 'packages', {}, calls, 'diff', failingBe(new Error('be is never asked')));
  assert.deepEqual(Object.keys(out.eslint.engine.sides), ['packages']);
  assert.deepEqual(out.eslint.findings.map((finding) => finding.path), ['packages/sdk/src/pick.ts']);
  const failed = await lint(app, 'packages', {}, [], 'diff', async () => { throw Object.assign(new Error('child capture did not complete (overflow)'), { code: 'CLI_TOOL_INCOMPLETE' }); });
  assert.deepEqual(failed.eslint.errors, ['eslint did not complete in packages/: child capture did not complete (overflow)']);
  assert.deepEqual(failed.eslint.engine.sides['packages'], { files: 0 });
});

test('the cached lint asks the child of each side for the project graph of the installed canon and writes its graph records from the answer', async (context) => {
  const app = fixture(context);
  const asked: { side: string; graph: { name: string; entry: string }[] | undefined }[] = [];
  const finding = { rule: 'starci-be/duplicate-code', code: 'HFS_DUPLICATE_CODE', line: 3, column: 1, message: 'copy of src/other.ts' };
  const answering: LinterRunner = async (spec) => {
    const side = path.basename(spec.cwd);
    asked.push({ side, graph: spec.graph === undefined ? undefined : [...spec.graph] });
    const files = fs.readdirSync(path.join(spec.cwd, 'src')).map((name) => `src/${name}`);
    return { results: files.map((file) => ({ filePath: path.join(spec.cwd, file), messages: [] })), ...(side === 'be' ? { graph: { '@starci/eslint-canon-be': { byFile: { 'src/backend.ts': [finding] } } } } : {}) };
  };
  const first = await lint(app, undefined, {}, [], 'diff', answering);
  assert.deepEqual(asked.map((entry) => entry.side), ['be', 'fe']);
  for (const entry of asked) {
    assert.equal(entry.graph?.length, 1);
    assert.equal(entry.graph?.[0]?.name, `@starci/eslint-canon-${entry.side}`);
    assert.equal(fs.realpathSync(entry.graph?.[0]?.entry ?? ''), fs.realpathSync(path.join(app.root, 'node_modules', '@starci', `eslint-canon-${entry.side}`, 'index.mjs')));
  }
  const graphRecords = (first.session.replaced.get('lint/be') ?? []).filter((record) => record.step === 'graph');
  assert.deepEqual(graphRecords.map((record) => [record.path, record.findings.map((entry) => [entry.rule, entry.line, entry.column])]), [['src/backend.ts', [['HFS_DUPLICATE_CODE', 3, 1]]]]);
});
